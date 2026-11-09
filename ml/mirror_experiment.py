"""Does mirrored training data let left-handed signers use the model without hurting right-handed ones?

Starts from the signer-independent model (models/tsl_combined_si), fine-tunes it the same way the
app's personal fine-tune does (12 epochs, lr 3e-4, ~30 clips per word from the training signers),
once without and once with left/right-mirrored copies, and tests on signers it has never seen:
TSL-ONE signers 04, 09, 15, 21, 27 and the TSL-51 user_sign signer, as recorded (right-handed) and
mirrored (simulated left-handed).   python ml/mirror_experiment.py  -> docs/mirror-experiment.json
"""
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn

from features import mirror_points, prepare, tsl_points_from_csv, tsl_points_from_tslone
from finetune_user import augment_raw, raw_clips
from paths import HOME
from train_tsl import SignNet

SI = HOME / 'models' / 'tsl_combined_si'
TEST_SIGNERS = {'04', '09', '15', '21', '27'}
ROOT = Path(__file__).resolve().parent.parent


def test_sets(labels):
    words = json.load(open(Path(__file__).with_name('tsl_one_words.json'), encoding='utf-8'))
    one, pts, y = HOME / 'tsl_one', [], []
    for g in json.load(open(one / 'tsl_one_s_dataset.json', encoding='utf-8')):
        for inst in g['instances']:
            f = one / 'pose' / 'TSL-ONE-Pose' / f"{inst['video_id']}.npy"
            if inst['video_id'][:2] in TEST_SIGNERS and f.exists():
                pts.append(tsl_points_from_tslone(np.load(f, allow_pickle=False))); y.append(labels.index(f"{words[g['gloss']]}_tslone"))
    sets = {'tslone_new_signers': (pts, np.array(y))}
    data = HOME / 'tsl51'
    user = pd.read_csv(data / 'metadata' / 'user_sign_metadata.csv', encoding='utf-8-sig')
    pts, y = [], []
    for path, sign in zip(user.landmark_path, user.sign_id):
        if (data / path).exists() and sign in labels:
            pts.append(tsl_points_from_csv(pd.read_csv(data / path, encoding='utf-8-sig'))); y.append(labels.index(sign))
    sets['tsl51_new_signer'] = (pts, np.array(y))
    return sets


def main():
    meta = json.load(open(SI / 'labels.json', encoding='utf-8'))
    labels, mean, std = meta['labels'], np.array(meta['mean'], np.float32), np.array(meta['std'], np.float32)
    feats = lambda points: ((prepare(points, use_face=False) - mean) / std).astype(np.float32)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    t0 = time.time()
    tests = {name: (np.stack([feats(p) for p in pts]), np.stack([feats(mirror_points(p)) for p in pts]), y)
             for name, (pts, y) in test_sets(labels).items()}
    clips = raw_clips(labels, per_class=30, exclude_signers=TEST_SIGNERS)
    print(f'test sets ready, {len(clips)} training clips ({time.time() - t0:.0f}s)', flush=True)

    def evaluate(model):
        model.eval(); out = {}
        with torch.no_grad():
            for name, (Xn, Xm, y) in tests.items():
                for kind, X in (('right_handed', Xn), ('left_handed', Xm)):
                    pred = torch.cat([model(torch.from_numpy(X[i:i + 512]).to(device)).argmax(1).cpu() for i in range(0, len(X), 512)]).numpy()
                    out[f'{name}_{kind}'] = round(float((pred == y).mean()), 4)
        return out

    def base_model():
        m = SignNet(len(mean), len(labels)); m.load_state_dict(torch.load(SI / 'tsl51.pt', map_location='cpu')); return m.to(device)

    results = {'base_model_no_finetune': evaluate(base_model())}
    print('base', results['base_model_no_finetune'], flush=True)
    rng = np.random.default_rng(0)
    index = {s: i for i, s in enumerate(labels)}
    for mirror in (False, True):
        X, y = [], []
        for label, p in clips:
            versions = [p, augment_raw(p, rng)]
            if mirror:
                versions += [mirror_points(v) for v in versions]
            X += [feats(v) for v in versions]; y += [index[label]] * len(versions)
        X, y = torch.from_numpy(np.stack(X)), torch.from_numpy(np.array(y))
        model = base_model()
        opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=0.05)
        loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)
        torch.manual_seed(0)
        loader = torch.utils.data.DataLoader(torch.utils.data.TensorDataset(X, y), batch_size=128, shuffle=True)
        for _ in range(12):
            model.train()
            for xb, yb in loader:
                xb, yb = xb.to(device), yb.to(device)
                opt.zero_grad(); loss_fn(model(xb + torch.randn_like(xb) * 0.02), yb).backward(); opt.step()
        name = 'finetune_with_mirrored_copies' if mirror else 'finetune_without_mirror'
        results[name] = evaluate(model) | {'train_clips': len(y)}
        print(name, results[name], flush=True)
        del X, y, loader
    out = {'test': 'held-out signers; left_handed = the same clips mirrored', 'test_clips': {k: len(v[2]) for k, v in tests.items()},
           'results': results, 'minutes': round((time.time() - t0) / 60, 1)}
    (ROOT / 'docs' / 'mirror-experiment.json').write_text(json.dumps(out, indent=1), encoding='utf-8')
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
