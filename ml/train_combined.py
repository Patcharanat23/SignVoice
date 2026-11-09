"""Train one Thai sign model on TSL-51 (3 signers, 51 signs) + TSL-ONE (29 signers, 184 signs).

Both datasets share hands + shoulders/elbows/wrists (TSL-ONE has no face points, so the face
columns are dropped). Signer-independent check: TSL-ONE signers in TEST_SIGNERS and the
TSL-51 user_sign signer are held out.

  python ml/train_combined.py            # held-out run -> models/tsl_combined_si (report.json)
  python ml/train_combined.py --deploy   # all signers  -> models/tsl51 (the model the app loads)
"""
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn

from features import T, prepare, tsl_points_from_tslone, without_face
from finetune_user import augment_raw
from paths import HOME
from train_tsl import CACHE, SignNet, augment

SEED = 11
TEST_SIGNERS = {'04', '09', '15', '21', '27'}
ONE = HOME / 'tsl_one'
WORDS = json.load(open(Path(__file__).with_name('tsl_one_words.json'), encoding='utf-8'))
DEPLOY = '--deploy' in sys.argv
OUT = HOME / 'models' / ('tsl51' if DEPLOY else 'tsl_combined_si')
AUG_COPIES = 8          # TSL-ONE training clips get this many jittered copies
TSL51_PER_ORIGINAL = 12  # keep at most this many of TSL-51's own augmentations per source video


def load_tsl51():
    d = np.load(CACHE, allow_pickle=True)
    y, groups = d['y'], d['groups']
    rng = np.random.default_rng(SEED)
    keep = []
    for g in np.unique(groups):
        idx = np.flatnonzero(groups == g)
        keep.extend(rng.choice(idx, min(TSL51_PER_ORIGINAL, len(idx)), replace=False))
    keep = np.sort(np.array(keep))
    X = d['X']
    Xk = without_face(X[keep]).astype(np.float16)
    del X
    return Xk, y[keep], without_face(d['UX']).astype(np.float16), d['uy']


def load_tslone():
    meta = json.load(open(ONE / 'tsl_one_s_dataset.json', encoding='utf-8'))
    rng = np.random.default_rng(SEED)
    tr_X, tr_y, te_X, te_y = [], [], [], []
    for gloss in meta:
        label = f"{WORDS[gloss['gloss']]}_tslone"
        for inst in gloss['instances']:
            path = ONE / 'pose' / 'TSL-ONE-Pose' / f"{inst['video_id']}.npy"
            if not path.exists():
                continue
            pts = tsl_points_from_tslone(np.load(path, allow_pickle=False))
            held_out = not DEPLOY and inst['video_id'][:2] in TEST_SIGNERS
            if held_out:
                te_X.append(prepare(pts, use_face=False)); te_y.append(label)
                continue
            tr_X.append(prepare(pts, use_face=False)); tr_y.append(label)
            for _ in range(AUG_COPIES):
                tr_X.append(prepare(augment_raw(pts, rng), use_face=False)); tr_y.append(label)
    f16 = lambda a: np.stack(a).astype(np.float16) if a else np.zeros((0, T, 266), np.float16)
    return f16(tr_X), np.array(tr_y), f16(te_X), np.array(te_y)


def main():
    random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
    A, ay, U, uy = load_tsl51()
    print('TSL-51 clips', len(A), 'user signer', len(U), flush=True)
    B, by, Bt, bty = load_tslone()
    print('TSL-ONE train', len(B), 'held-out', len(Bt), flush=True)

    labels = sorted(set(ay) | set(uy) | set(by) | set(bty))
    index = {s: i for i, s in enumerate(labels)}
    to_idx = lambda arr: np.array([index[s] for s in arr], np.int64)
    parts = [(A, to_idx(ay)), (B, to_idx(by))]
    if DEPLOY:
        parts.append((U, to_idx(uy)))
    X = np.concatenate([p[0] for p in parts]); y = np.concatenate([p[1] for p in parts])
    del A, B, parts
    total = np.zeros(X.shape[-1]); total2 = np.zeros(X.shape[-1])
    for i in range(0, len(X), 4096):
        c = X[i:i + 4096].astype(np.float64)
        total += c.sum((0, 1)); total2 += (c ** 2).sum((0, 1))
    n = len(X) * T
    mean = (total / n).astype(np.float32)
    std = (np.sqrt(np.maximum(total2 / n - (total / n) ** 2, 0)) + 1e-4).astype(np.float32)
    print(f'train {len(X)} clips, {len(labels)} classes', flush=True)

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    m_t, s_t = torch.from_numpy(mean).to(device), torch.from_numpy(std).to(device)
    model = SignNet(X.shape[-1], len(labels)).to(device)
    counts = Counter(y.tolist())
    sampler = torch.utils.data.WeightedRandomSampler(np.array([1.0 / counts[c] for c in y]), num_samples=len(y), replacement=True)
    loader = torch.utils.data.DataLoader(torch.utils.data.TensorDataset(torch.from_numpy(X), torch.from_numpy(y)), batch_size=256, sampler=sampler)
    epochs = 40
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=0.05)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=epochs * len(loader))
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)

    def evaluate(Xe, ye):
        if not len(Xe):
            return None, None, None
        model.eval()
        with torch.no_grad():
            xe = (torch.from_numpy(Xe.astype(np.float32)).to(device) - m_t) / s_t
            p = torch.cat([model(xe[i:i + 512]) for i in range(0, len(xe), 512)]).softmax(-1).cpu().numpy()
        t = to_idx(ye)
        return float((p.argmax(1) == t).mean()), float((np.argsort(-p, 1)[:, :5] == t[:, None]).any(1).mean()), p.argmax(1)

    for epoch in range(epochs):
        model.train()
        for xb, yb in loader:
            xb = (xb.to(device).float() - m_t) / s_t
            xb, yb = augment(xb), yb.to(device)
            opt.zero_grad()
            loss = loss_fn(model(xb), yb)
            loss.backward(); opt.step(); sched.step()
        if not DEPLOY and (epoch + 1) % 5 == 0:
            one, one5, _ = evaluate(Bt, bty); u, u5, _ = evaluate(U, uy)
            print(f'epoch {epoch + 1} loss {loss.item():.3f}  held-out TSL-ONE signers top1 {one:.3f} top5 {one5:.3f}  TSL-51 user signer top1 {u:.3f} top5 {u5:.3f}', flush=True)

    report = {'classes': len(labels), 'train_clips': int(len(X)), 'deploy': DEPLOY, 'test_signers_tslone': sorted(TEST_SIGNERS)}
    if not DEPLOY:
        one, one5, pred = evaluate(Bt, bty); u, u5, _ = evaluate(U, uy)
        wrong = Counter((t, labels[p]) for t, p in zip(bty, pred) if t != labels[p]).most_common(15)
        report |= {'tslone_heldout_clips': int(len(Bt)), 'tslone_heldout_top1': one, 'tslone_heldout_top5': one5,
                   'tsl51_user_top1': u, 'tsl51_user_top5': u5, 'tslone_top_confusions': [f'{a} -> {b}: {n}' for (a, b), n in wrong]}
    OUT.mkdir(parents=True, exist_ok=True)
    model.cpu().eval()
    torch.save(model.state_dict(), OUT / 'tsl51.pt')
    torch.onnx.export(model, torch.zeros(1, T, X.shape[-1]), OUT / 'tsl51.onnx', input_names=['x'], output_names=['logits'],
                      dynamic_axes={'x': {0: 'batch'}, 'logits': {0: 'batch'}}, opset_version=17, dynamo=False)
    english = {f'{th}_tslone': en for en, th in WORDS.items()}
    json.dump({'labels': labels, 'mean': mean.tolist(), 'std': std.tolist(), 'frames': T, 'use_face': False, 'english': english},
              open(OUT / 'labels.json', 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(report, open(OUT / 'report.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
