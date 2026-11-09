"""Controlled comparison of sign classifiers and feature ablations (same data, same split, same budget).

Train : TSL-51 (experts + web clips) + TSL-ONE (24 signers)
Test  : signers never seen in training -> TSL-ONE signers 04/09/15/21/27 (666 clips)
        and the TSL-51 user_sign signer (547 clips)
Every model gets the same epochs, optimiser, sampler and augmentation. Results -> docs/experiments.json

  python ml/experiments.py
"""
import json
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from torch import nn

import train_combined as tc
from features import T
from train_tsl import SignNet, augment

EPOCHS = 25        # held-out accuracy of the main model plateaus around epoch 25-30 (see docs/EXPERIMENTS.md)
OUT = Path(__file__).resolve().parent.parent / 'docs' / 'experiments.json'
# Feature layout after dropping the face (266 values per frame):
COLS = {'hand_xy': slice(0, 84), 'arm_xy': slice(84, 96), 'hand_shape': slice(96, 180), 'presence': slice(180, 182), 'velocity': slice(182, 266)}


class GRUNet(nn.Module):        # recurrent baseline (LSTM/GRU is the common choice in Thai SLR projects)
    def __init__(self, f, c, h=160):
        super().__init__()
        self.inp = nn.Sequential(nn.Linear(f, h), nn.LayerNorm(h), nn.GELU())
        self.rnn = nn.GRU(h, h, num_layers=2, batch_first=True, bidirectional=True, dropout=0.1)
        self.head = nn.Sequential(nn.LayerNorm(4 * h), nn.Dropout(0.3), nn.Linear(4 * h, c))

    def forward(self, x):
        o, _ = self.rnn(self.inp(x))
        return self.head(torch.cat([o.mean(1), o.amax(1)], 1))


class TransformerNet(nn.Module):  # same as ours without the convolution blocks
    def __init__(self, f, c, d=192):
        super().__init__()
        self.inp = nn.Sequential(nn.Linear(f, d), nn.LayerNorm(d), nn.GELU())
        self.pos = nn.Parameter(torch.zeros(1, T, d))
        self.enc = nn.TransformerEncoder(nn.TransformerEncoderLayer(d, 4, 2 * d, 0.1, batch_first=True, norm_first=True), 2)
        self.head = nn.Sequential(nn.LayerNorm(2 * d), nn.Dropout(0.3), nn.Linear(2 * d, c))

    def forward(self, x):
        h = self.enc(self.inp(x) + self.pos)
        return self.head(torch.cat([h.mean(1), h.amax(1)], 1))


class MLPNet(nn.Module):        # no temporal model: summary statistics of the whole clip
    def __init__(self, f, c):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(3 * f, 512), nn.GELU(), nn.Dropout(0.3), nn.Linear(512, 256), nn.GELU(), nn.Dropout(0.3), nn.Linear(256, c))

    def forward(self, x):
        return self.net(torch.cat([x.mean(1), x.std(1), x.amax(1)], 1))


def params(model):
    return sum(p.numel() for p in model.parameters())


def main():
    torch.manual_seed(tc.SEED); np.random.seed(tc.SEED)
    A, ay, U, uy = tc.load_tsl51()
    B, by, Bt, bty = tc.load_tslone()
    labels = sorted(set(ay) | set(uy) | set(by) | set(bty))
    index = {s: i for i, s in enumerate(labels)}
    to_idx = lambda a: np.array([index[s] for s in a], np.int64)
    X = np.concatenate([A, B]); y = np.concatenate([to_idx(ay), to_idx(by)])
    del A, B
    total = np.zeros(X.shape[-1]); total2 = np.zeros(X.shape[-1])
    for i in range(0, len(X), 4096):  # chunked: a float32 copy of X would need ~1.5 GB
        c = X[i:i + 4096].astype(np.float64); total += c.sum((0, 1)); total2 += (c ** 2).sum((0, 1))
    n = len(X) * T
    mean = (total / n).astype(np.float32); std = (np.sqrt(np.maximum(total2 / n - (total / n) ** 2, 0)) + 1e-4).astype(np.float32)
    exclude = set(json.load(open(Path(__file__).with_name('vocab_exclude.json'), encoding='utf-8'))['exclude'])
    keep = np.array([l.split('_')[0] not in exclude for l in labels])
    tests = {'tslone_heldout': (Bt, to_idx(bty)), 'tsl51_user': (U, to_idx(uy))}
    print(f'train {len(X)}  classes {len(labels)}  tests ' + ', '.join(f'{k} {len(v[1])}' for k, v in tests.items()), flush=True)
    device = 'cuda'

    def run(name, make, cols=None, seed=tc.SEED):
        torch.manual_seed(seed); np.random.seed(seed)
        sel = np.ones(X.shape[-1], bool)
        for c in cols or []:
            sel[COLS[c]] = False
        m_t = torch.from_numpy(mean[sel]).to(device); s_t = torch.from_numpy(std[sel]).to(device)
        model = make(int(sel.sum()), len(labels)).to(device)
        counts = Counter(y.tolist())
        sampler = torch.utils.data.WeightedRandomSampler(np.array([1.0 / counts[c] for c in y]), len(y), replacement=True)
        loader = torch.utils.data.DataLoader(torch.utils.data.TensorDataset(torch.from_numpy(X), torch.from_numpy(y)), batch_size=256, sampler=sampler)
        opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=0.05)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=EPOCHS * len(loader))
        loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)
        t0 = time.time()
        for _ in range(EPOCHS):
            model.train()
            for xb, yb in loader:
                xb = (xb.to(device).float()[..., torch.from_numpy(sel).to(device)] - m_t) / s_t
                opt.zero_grad(); loss_fn(model(augment(xb)), yb.to(device)).backward(); opt.step(); sched.step()
        train_min = (time.time() - t0) / 60
        model.eval()
        row = {'model': name, 'removed_features': cols or [], 'seed': seed, 'params': params(model), 'train_minutes': round(train_min, 1)}
        with torch.no_grad():
            for key, (Xe, ye) in tests.items():
                xe = (torch.from_numpy(Xe.astype(np.float32)[..., sel]).to(device) - m_t) / s_t
                lg = torch.cat([model(xe[i:i + 512]) for i in range(0, len(xe), 512)]).cpu().numpy()
                row[f'{key}_top1'] = float((lg.argmax(1) == ye).mean())
                row[f'{key}_top5'] = float((np.argsort(-lg, 1)[:, :5] == ye[:, None]).any(1).mean())
                lg[:, ~keep] = -1e9
                row[f'{key}_everyday_top1'] = float((lg.argmax(1) == ye).mean())
            cpu = model.cpu(); one = torch.from_numpy(((tests['tsl51_user'][0][:1].astype(np.float32)[..., sel]) - mean[sel]) / std[sel])
            for _ in range(5): cpu(one)
            t = time.perf_counter()
            for _ in range(50): cpu(one)
            row['cpu_ms_per_clip'] = round((time.perf_counter() - t) / 50 * 1000, 2)
        print(json.dumps(row), flush=True)
        return row

    rows = []
    rows.append(run('1D-CNN+Transformer (ours)', SignNet))
    rows.append(run('1D-CNN+Transformer (ours)', SignNet, seed=12))
    rows.append(run('BiGRU', GRUNet))
    rows.append(run('Transformer only', TransformerNet))
    rows.append(run('MLP (clip statistics)', MLPNet))
    rows.append(run('1D-CNN+Transformer (ours)', SignNet, cols=['velocity']))
    rows.append(run('1D-CNN+Transformer (ours)', SignNet, cols=['hand_shape']))
    rows.append(run('1D-CNN+Transformer (ours)', SignNet, cols=['arm_xy']))

    # k-NN on clip statistics (the approach of KNN/DTW template matchers), no training
    feats = lambda a: np.concatenate([a.mean(1), a.std(1), a.max(1)], 1)
    tr = torch.from_numpy(np.concatenate([feats((X[i:i + 4096].astype(np.float32) - mean) / std) for i in range(0, len(X), 4096)]))
    tr = torch.nn.functional.normalize(tr, dim=1).to(device)
    knn = {'model': 'k-NN (k=5, cosine)', 'removed_features': [], 'seed': None, 'params': 0, 'train_minutes': 0}
    for key, (Xe, ye) in tests.items():
        q = torch.nn.functional.normalize(torch.from_numpy(feats((Xe.astype(np.float32) - mean) / std)), dim=1).to(device)
        votes = y[torch.topk(q @ tr.T, 5, dim=1).indices.cpu().numpy()]
        pred = np.array([np.bincount(v, minlength=len(labels)).argmax() for v in votes])
        knn[f'{key}_top1'] = float((pred == ye).mean())
    print(json.dumps(knn), flush=True)
    rows.append(knn)

    OUT.parent.mkdir(exist_ok=True)
    json.dump({'epochs': EPOCHS, 'train_clips': int(len(X)), 'classes': len(labels), 'rows': rows}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('saved', OUT)


if __name__ == '__main__':
    main()
