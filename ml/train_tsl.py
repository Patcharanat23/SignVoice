"""Train a Thai Sign Language (TSL-51) classifier on landmark sequences and export ONNX.

Train: expert interpreters + web-scraped clips (with the dataset's own augmentations).
Test:  user_sign clips from a different signer, never seen in training (signer-independent).

  python ml/train_tsl.py                 # signer-independent run: report.json measures an unseen signer
  python ml/train_tsl.py --include-user  # deployment model: also learns from the user_sign signer
                                         # (its user-test score is no longer an unseen-signer measurement)
"""
import io
import json
import random
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn

from features import T, prepare, tsl_points_from_csv
from paths import HOME

DATA = HOME / 'tsl51'
OUT = HOME / 'models' / 'tsl51'
CACHE = DATA / 'prepared.npz'
SEED = 7


def load_split():
    if CACHE.exists():
        d = np.load(CACHE, allow_pickle=True)
        return {k: d[k] for k in d.files}
    meta = pd.read_csv(DATA / 'metadata' / 'expert_metadata.csv', encoding='utf-8-sig')
    meta = meta[meta.extraction_status == 'ok']
    by_name = {Path(p).name: (s, o) for p, s, o in zip(meta.landmark_path, meta.sign_id, meta.original_video_id)}
    X, y, groups = [], [], []
    for zpath in sorted((DATA / 'zips').glob('*.zip')):
        with zipfile.ZipFile(zpath) as z:
            for name in z.namelist():
                key = Path(name).name
                if key not in by_name:
                    continue
                sign, original = by_name[key]
                pts = tsl_points_from_csv(pd.read_csv(io.BytesIO(z.read(name)), encoding='utf-8-sig'))
                X.append(prepare(pts)); y.append(sign); groups.append(original)
        print(zpath.name, len(X), flush=True)
    user = pd.read_csv(DATA / 'metadata' / 'user_sign_metadata.csv', encoding='utf-8-sig')
    UX, uy = [], []
    for path, sign in zip(user.landmark_path, user.sign_id):
        file = DATA / path
        if file.exists():
            UX.append(prepare(tsl_points_from_csv(pd.read_csv(file, encoding='utf-8-sig')))); uy.append(sign)
    d = dict(X=np.stack(X), y=np.array(y), groups=np.array(groups), UX=np.stack(UX), uy=np.array(uy))
    np.savez_compressed(CACHE, **d)
    return d


class SignNet(nn.Module):
    def __init__(self, dim_in, classes, dim=192):
        super().__init__()
        self.inp = nn.Sequential(nn.Linear(dim_in, dim), nn.LayerNorm(dim), nn.GELU())
        self.convs = nn.ModuleList([nn.Sequential(
            nn.Conv1d(dim, dim, 5, padding=2, groups=dim), nn.Conv1d(dim, dim, 1), nn.BatchNorm1d(dim), nn.GELU(), nn.Dropout(0.1)
        ) for _ in range(3)])
        layer = nn.TransformerEncoderLayer(dim, 4, dim * 2, dropout=0.1, batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, 2)
        self.pos = nn.Parameter(torch.zeros(1, T, dim))
        self.head = nn.Sequential(nn.LayerNorm(dim * 2), nn.Dropout(0.3), nn.Linear(dim * 2, classes))

    def forward(self, x):
        h = self.inp(x).transpose(1, 2)
        for conv in self.convs:
            h = h + conv(h)
        h = self.encoder(h.transpose(1, 2) + self.pos)
        return self.head(torch.cat([h.mean(1), h.amax(1)], dim=1))


def augment(x):
    """Small time shifts and feature noise; the dataset already includes spatial/speed augmentation."""
    shift = torch.randint(-2, 3, (1,)).item()
    x = torch.roll(x, shift, dims=1)
    return x + torch.randn_like(x) * 0.02


def evaluate(model, X, y, device):
    model.eval()
    with torch.no_grad():
        logits = torch.cat([model(torch.from_numpy(X[i:i + 512]).to(device)).cpu() for i in range(0, len(X), 512)])
    probs = logits.softmax(-1).numpy()
    pred = probs.argmax(1)
    top5 = (np.argsort(-probs, 1)[:, :5] == y[:, None]).any(1)
    return float((pred == y).mean()), float(top5.mean()), pred


def main():
    random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
    d = load_split()
    labels = sorted(set(d['y']) | set(d['uy']))
    index = {s: i for i, s in enumerate(labels)}
    X, y = d['X'], np.array([index[s] for s in d['y']])
    UX, uy = d['UX'], np.array([index[s] for s in d['uy']])
    originals = sorted(set(d['groups']))
    random.shuffle(originals)
    val_groups = set(originals[: len(originals) // 10])
    val = np.array([g in val_groups for g in d['groups']])
    # Normalise in place and index into X instead of copying it (X is ~1.4 GB).
    tr_idx, va_idx = np.flatnonzero(~val), np.flatnonzero(val)
    total, total2 = np.zeros(X.shape[-1]), np.zeros(X.shape[-1])
    for i in range(0, len(tr_idx), 4096):
        chunk = X[tr_idx[i:i + 4096]].astype(np.float64)
        total += chunk.sum((0, 1)); total2 += (chunk ** 2).sum((0, 1))
    count = len(tr_idx) * X.shape[1]
    mean = (total / count).astype(np.float32)
    std = (np.sqrt(np.maximum(total2 / count - (total / count) ** 2, 0)) + 1e-4).astype(np.float32)
    X -= mean; X /= std
    UXn = ((UX - mean) / std).astype(np.float32)
    Xva, yva, ytr = X[va_idx], y[va_idx], y[tr_idx]
    train_set = torch.utils.data.Subset(torch.utils.data.TensorDataset(torch.from_numpy(X), torch.from_numpy(y)), tr_idx)
    include_user = '--include-user' in sys.argv
    if include_user:  # a third signer makes the model more robust to new people
        train_set = torch.utils.data.ConcatDataset([train_set, torch.utils.data.TensorDataset(torch.from_numpy(UXn), torch.from_numpy(uy))])
        ytr = np.concatenate([ytr, uy])
    print(f'train {len(ytr)}  val {len(Xva)} ({len(val_groups)} original videos)  user-test {len(UXn)}  classes {len(labels)}')

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = SignNet(X.shape[-1], len(labels)).to(device)
    # Weight classes so web-scraped words with many augmentations do not dominate.
    counts = Counter(ytr.tolist())
    sample_w = np.array([1.0 / counts[c] for c in ytr])
    sampler = torch.utils.data.WeightedRandomSampler(sample_w, num_samples=len(ytr), replacement=True)
    loader = torch.utils.data.DataLoader(train_set, batch_size=256, sampler=sampler)
    epochs = 40
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=0.05)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=epochs * len(loader))
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)
    best, best_state = -1, None
    for epoch in range(epochs):
        model.train()
        for xb, yb in loader:
            xb, yb = augment(xb.to(device)), yb.to(device)
            opt.zero_grad()
            loss = loss_fn(model(xb), yb)
            loss.backward()
            opt.step(); sched.step()
        va, _, _ = evaluate(model, Xva, yva, device)
        ua, u5, _ = evaluate(model, UXn, uy, device)
        print(f'epoch {epoch + 1:2d} loss {loss.item():.3f} val {va:.3f} user-test top1 {ua:.3f} top5 {u5:.3f}', flush=True)
        if va > best:  # select on expert validation only; user-test stays unseen
            best, best_state = va, {k: v.detach().clone() for k, v in model.state_dict().items()}
    model.load_state_dict(best_state)
    va, v5, _ = evaluate(model, Xva, yva, device)
    ua, u5, upred = evaluate(model, UXn, uy, device)
    per_class = defaultdict(lambda: [0, 0])
    for t, p in zip(uy, upred):
        per_class[labels[t]][1] += 1
        per_class[labels[t]][0] += int(t == p)
    confusions = Counter((labels[t], labels[p]) for t, p in zip(uy, upred) if t != p).most_common(15)

    OUT.mkdir(parents=True, exist_ok=True)
    model.cpu().eval()
    # PyTorch weights let ml/finetune_user.py continue training on the user's own signing.
    torch.save(model.state_dict(), OUT / 'tsl51.pt')
    dummy = torch.zeros(1, T, X.shape[-1])
    torch.onnx.export(model, dummy, OUT / 'tsl51.onnx', input_names=['x'], output_names=['logits'],
                      dynamic_axes={'x': {0: 'batch'}, 'logits': {0: 'batch'}}, opset_version=17, dynamo=False)
    json.dump({'labels': labels, 'mean': mean.tolist(), 'std': std.tolist(), 'frames': T}, open(OUT / 'labels.json', 'w', encoding='utf-8'), ensure_ascii=False)
    report = {
        'include_user': include_user,
        'classes': len(labels), 'train_clips': int(len(ytr)), 'val_clips': int(len(Xva)), 'user_test_clips': int(len(UXn)),
        'expert_val_top1': va, 'expert_val_top5': v5, 'user_test_top1': ua, 'user_test_top5': u5,
        'user_test_per_class': {k: f'{a}/{n}' for k, (a, n) in sorted(per_class.items())},
        'user_test_top_confusions': [f'{a} -> {b}: {n}' for (a, b), n in confusions],
    }
    json.dump(report, open(OUT / 'report.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in report.items() if not isinstance(v, (dict, list))}, indent=2))


if __name__ == '__main__':
    main()
