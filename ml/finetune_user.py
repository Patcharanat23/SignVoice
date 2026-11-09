"""Fine-tune the TSL model on the user's own recorded signs (personal calibration).

Samples come from the web app ("สอนท่า"), saved by ml/service.py as
~/.signvoice/user_samples/<label>/<time>.npy  (frames x 543 x 3, float16).
Starts from models/tsl51/tsl51.pt, mixes in a small replay set of the base training data so
other signs are not forgotten, and writes models/tsl51/user/{tsl51.onnx,labels.json,report.json}.
"""
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from features import T, mirror_points, prepare, tsl_points_from_543, tsl_points_from_tslone, without_face
from paths import HOME
from train_tsl import CACHE, SignNet

BASE = HOME / 'models' / 'tsl51'
OUT = BASE / 'user'
SAMPLES = HOME / 'user_samples'
REPLAY = BASE / 'replay.npz'
REPLAY_MIRROR = BASE / 'replay_mirror.npz'


def load_samples():
    import db  # samples live in SQLite (ml/db.py)
    return db.load_samples()


def replay_set(labels, use_face, dim, per_class=30):
    """A few clips per class from the base training data (raw features), cached once per model.
    Covers TSL-51 and, for the combined model, TSL-ONE, so fine-tuning does not forget them."""
    if REPLAY.exists():
        d = np.load(REPLAY)
        if d['X'].shape[-1] == dim and d['y'].max() < len(labels):
            return d['X'].astype(np.float32), d['y']
    index = {s: i for i, s in enumerate(labels)}
    rng = np.random.default_rng(0)
    d = np.load(CACHE, allow_pickle=True)
    X, y = d['X'], d['y']
    keep = np.concatenate([rng.choice(np.flatnonzero(y == s), min(per_class, int((y == s).sum())), replace=False) for s in labels if (y == s).any()])
    Xs = [X[keep] if use_face else without_face(X[keep])]
    ys = [np.array([index[s] for s in y[keep]])]
    del X
    if any(s.endswith('_tslone') for s in labels):
        words = json.load(open(Path(__file__).with_name('tsl_one_words.json'), encoding='utf-8'))
        one = HOME / 'tsl_one'
        for gloss in json.load(open(one / 'tsl_one_s_dataset.json', encoding='utf-8')):
            label = f"{words[gloss['gloss']]}_tslone"
            for inst in gloss['instances'][:per_class]:
                path = one / 'pose' / 'TSL-ONE-Pose' / f"{inst['video_id']}.npy"
                if path.exists():
                    Xs.append(prepare(tsl_points_from_tslone(np.load(path, allow_pickle=False)), use_face)[None])
                    ys.append(np.array([index[label]]))
    Xr, yr = np.concatenate(Xs).astype(np.float16), np.concatenate(ys)
    np.savez_compressed(REPLAY, X=Xr, y=yr)
    return Xr.astype(np.float32), yr


def raw_clips(labels, per_class=30, exclude_signers=()):
    """[(label, points T x 54 x 3)] for up to per_class clips of each label, read from the original
    landmark files (TSL-51 zips, TSL-ONE poses) because mirroring needs points, not features."""
    import io
    import zipfile
    import pandas as pd
    from features import tsl_points_from_csv
    want, rng, out = set(labels), random.Random(0), []
    data = HOME / 'tsl51'
    meta = pd.read_csv(data / 'metadata' / 'expert_metadata.csv', encoding='utf-8-sig')
    meta = meta[(meta.extraction_status == 'ok') & meta.sign_id.isin(want)]
    names = {}
    for path, sign in zip(meta.landmark_path, meta.sign_id):
        names.setdefault(sign, []).append(Path(path).name)
    pick = {n: sign for sign, ns in names.items() for n in rng.sample(ns, min(per_class, len(ns)))}
    for zpath in sorted((data / 'zips').glob('*.zip')):
        with zipfile.ZipFile(zpath) as z:
            for name in z.namelist():
                sign = pick.pop(Path(name).name, None)
                if sign:
                    out.append((sign, tsl_points_from_csv(pd.read_csv(io.BytesIO(z.read(name)), encoding='utf-8-sig'))))
    words = json.load(open(Path(__file__).with_name('tsl_one_words.json'), encoding='utf-8'))
    one = HOME / 'tsl_one'
    if (one / 'tsl_one_s_dataset.json').exists():
        for gloss in json.load(open(one / 'tsl_one_s_dataset.json', encoding='utf-8')):
            label = f"{words[gloss['gloss']]}_tslone"
            if label not in want:
                continue
            insts = [i for i in gloss['instances'] if i['video_id'][:2] not in exclude_signers]
            for inst in insts[:per_class]:
                path = one / 'pose' / 'TSL-ONE-Pose' / f"{inst['video_id']}.npy"
                if path.exists():
                    out.append((label, tsl_points_from_tslone(np.load(path, allow_pickle=False))))
    return out


def mirror_replay(labels, use_face, dim, per_class=30):
    """Left/right-mirrored copies of the replay data, so fine-tuning also teaches every base word
    signed with the left hand. Cached once per model like replay.npz."""
    if REPLAY_MIRROR.exists():
        d = np.load(REPLAY_MIRROR)
        if d['X'].shape[-1] == dim and d['y'].max() < len(labels):
            return d['X'].astype(np.float32), d['y']
    index = {s: i for i, s in enumerate(labels)}
    clips = raw_clips(labels, per_class)
    X = np.stack([prepare(mirror_points(p), use_face) for _, p in clips]).astype(np.float16)
    y = np.array([index[l] for l, _ in clips])
    np.savez_compressed(REPLAY_MIRROR, X=X, y=y)
    return X.astype(np.float32), y


def augment_raw(frames, rng):
    """Camera-style jitter on raw points: scale, shift, small rotation, temporal crop/speed."""
    f = frames.copy()
    n = len(f)
    if n > 8:
        a = rng.integers(0, max(1, n // 8)); b = n - rng.integers(0, max(1, n // 8))
        f = f[a:b]
    xy = f[..., :2]
    centre = np.nanmean(xy.reshape(-1, 2), axis=0)
    angle = rng.normal(0, 0.08)
    rot = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]], np.float32)
    xy = (xy - centre) @ rot.T * rng.uniform(0.85, 1.15) + centre + rng.normal(0, 0.03, 2)
    f[..., :2] = xy
    return f


def finetune(progress=lambda msg, frac: None, epochs=12, copies=30, mirror=True):
    meta = json.load(open(BASE / 'labels.json', encoding='utf-8'))
    base_labels, mean, std = meta['labels'], np.array(meta['mean'], np.float32), np.array(meta['std'], np.float32)
    samples = load_samples()
    # Words the user taught that the base model has never seen ("<word>_user") become new classes.
    new_words = sorted({label for label, _ in samples if label.endswith('_user') and label not in base_labels})
    labels = base_labels + new_words
    index = {s: i for i, s in enumerate(labels)}
    norm = lambda feats: ((feats - mean) / std).astype(np.float32)
    use_face = meta.get('use_face', True)
    rows = [(index[label], frames) for label, frames in samples if label in index]
    if not rows:
        raise ValueError('ยังไม่มีท่าที่บันทึกไว้')
    rng = np.random.default_rng(int(time.time()))
    # Hold out ~20% of samples per word (when a word has 4+) to measure the gain honestly.
    by_label = {}
    for li, frames in rows:
        by_label.setdefault(li, []).append(frames)
    train_rows, test_rows = [], []
    for li, clips in by_label.items():
        random.Random(li).shuffle(clips)
        k = len(clips) // 5 if len(clips) >= 4 else 0
        test_rows += [(li, c) for c in clips[:k]]
        train_rows += [(li, c) for c in clips[k:]]

    progress('เตรียมข้อมูล', 0.05)
    Xu, yu = [], []
    # 30 jittered copies per sample when there are few; fewer when many clips were imported,
    # so the augmented set stays near 3,000 clips (bounded RAM and ~1 minute of training).
    copies = max(3, min(copies, 3000 // max(1, len(train_rows))))
    for li, frames in train_rows:
        Xu.append(norm(prepare(tsl_points_from_543(frames), use_face))); yu.append(li)
        for _ in range(copies):
            Xu.append(norm(prepare(tsl_points_from_543(augment_raw(frames, rng)), use_face))); yu.append(li)
        if mirror:  # the same sign made with the other hand (left-handed users)
            Xu.append(norm(prepare(mirror_points(tsl_points_from_543(frames)), use_face))); yu.append(li)
            for _ in range(copies // 2):
                Xu.append(norm(prepare(mirror_points(tsl_points_from_543(augment_raw(frames, rng))), use_face))); yu.append(li)
    Xu, yu = np.stack(Xu), np.array(yu)
    Xr, yr = replay_set(base_labels, use_face, len(mean))
    if mirror:
        progress('เตรียมข้อมูลมือซ้าย', 0.08)
        Xm, ym = mirror_replay(base_labels, use_face, len(mean))
        Xr, yr = np.concatenate([Xr, Xm]), np.concatenate([yr, ym])
    Xr = norm(Xr)  # replay is stored as raw features, like the user's clips before norm()
    Xt = np.stack([norm(prepare(tsl_points_from_543(f), use_face)) for _, f in test_rows]) if test_rows else None
    Xtm = np.stack([norm(prepare(mirror_points(tsl_points_from_543(f)), use_face)) for _, f in test_rows]) if test_rows else None
    yt = np.array([li for li, _ in test_rows])

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = SignNet(len(mean), len(labels))
    base_state = torch.load(BASE / 'tsl51.pt', map_location='cpu')
    head_w, head_b = 'head.2.weight', 'head.2.bias'
    if new_words:  # keep every learned class, add fresh output rows for the new words
        state = model.state_dict()
        for k in (head_w, head_b):
            state[k][:len(base_labels)] = base_state[k]
            base_state[k] = state[k]
    model.load_state_dict(base_state)
    model.to(device)

    def accuracy(X, y):
        if X is None or not len(X):
            return None
        model.eval()
        with torch.no_grad():
            return float((model(torch.from_numpy(X).to(device)).argmax(1).cpu().numpy() == y).mean())

    before = accuracy(Xt, yt)
    X = torch.from_numpy(np.concatenate([Xu, Xr])); y = torch.from_numpy(np.concatenate([yu, yr]))
    loader = torch.utils.data.DataLoader(torch.utils.data.TensorDataset(X, y), batch_size=128, shuffle=True)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=0.05)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)
    for epoch in range(epochs):
        model.train()
        for xb, yb in loader:
            xb, yb = xb.to(device), yb.to(device)
            xb = xb + torch.randn_like(xb) * 0.02
            opt.zero_grad()
            loss_fn(model(xb), yb).backward()
            opt.step()
        progress(f'เทรนรอบ {epoch + 1}/{epochs}', 0.1 + 0.85 * (epoch + 1) / epochs)
    after = accuracy(Xt, yt)
    after_mirrored = accuracy(Xtm, yt)  # the held-out samples flipped left/right

    OUT.mkdir(parents=True, exist_ok=True)
    model.cpu().eval()
    torch.onnx.export(model, torch.zeros(1, T, len(mean)), OUT / 'tsl51.onnx', input_names=['x'], output_names=['logits'],
                      dynamic_axes={'x': {0: 'batch'}, 'logits': {0: 'batch'}}, opset_version=17, dynamo=False)
    json.dump(meta | {'labels': labels}, open(OUT / 'labels.json', 'w', encoding='utf-8'), ensure_ascii=False)
    report = {'copies_per_sample': copies, 'words': len(by_label), 'new_words': [w.split('_')[0] for w in new_words], 'train_samples': len(train_rows), 'heldout_samples': len(test_rows),
              'heldout_before': before, 'heldout_after': after, 'mirror': mirror, 'heldout_after_mirrored': after_mirrored, 'time': time.strftime('%Y-%m-%d %H:%M')}
    json.dump(report, open(OUT / 'report.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    progress('เสร็จ', 1.0)
    return report


if __name__ == '__main__':
    print(json.dumps(finetune(lambda m, f: print(f'{f:.0%} {m}', flush=True)), ensure_ascii=False, indent=2))
