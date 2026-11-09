"""Old file storage (one .npy per sample) vs SQLite, on throw-away data.  python ml/bench_storage.py
Measures the operations the app actually does: save a sample, count samples per word (every time the
teach panel refreshes), and load all samples (every fine-tune). Writes docs/storage-benchmark.json."""
import json
import os
import statistics
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import db  # noqa: E402

FRAMES = 42  # median live clip length measured in the browser (PROJECT_SUMMARY.md)
WORDS = 20


def clip(rng):
    return rng.random((FRAMES, 543, 3), dtype=np.float32)


def median_ms(fn, runs=20):
    ts = []
    for _ in range(runs):
        t = time.perf_counter(); fn(); ts.append((time.perf_counter() - t) * 1000)
    return round(statistics.median(ts), 2)


def size_and_files(path):
    files = [p for p in Path(path).rglob('*') if p.is_file()]
    return round(sum(p.stat().st_size for p in files) / 2**20, 1), len(files)


def bench(n, root, rng):
    out = {}
    # --- files (previous implementation) ---
    fdir = root / f'files_{n}'
    labels = [f'word{i}_user' for i in range(WORDS)]
    t = time.perf_counter()
    for i in range(n):
        d = fdir / labels[i % WORDS]; d.mkdir(parents=True, exist_ok=True)
        np.save(d / f'{i:08d}.npy', clip(rng).astype(np.float16))
    out['files_save_ms_per_sample'] = round((time.perf_counter() - t) * 1000 / n, 2)
    out['files_count_ms'] = median_ms(lambda: {d.name: len(list(d.glob('*.npy'))) for d in fdir.glob('*') if d.is_dir()})
    out['files_load_all_ms'] = median_ms(lambda: [np.load(f).astype(np.float32) for d in sorted(fdir.glob('*')) for f in sorted(d.glob('*.npy'))], runs=5)
    out['files_disk_mb'], out['files_on_disk'] = size_and_files(fdir)
    # --- SQLite (new) ---
    sdir = root / f'sqlite_{n}'; sdir.mkdir()
    c = db.conn(sdir / 'test.db')
    t = time.perf_counter()
    for i in range(n):
        db.save_sample(labels[i % WORDS], clip(rng), c=c)
    out['sqlite_save_ms_per_sample'] = round((time.perf_counter() - t) * 1000 / n, 2)
    out['sqlite_count_ms'] = median_ms(lambda: db.counts(c=c))
    out['sqlite_load_all_ms'] = median_ms(lambda: db.load_samples(c=c), runs=5)
    c.close()
    out['sqlite_disk_mb'], out['sqlite_files_on_disk'] = size_and_files(sdir)
    return out


def main():
    rng = np.random.default_rng(0)
    results = {}
    with tempfile.TemporaryDirectory() as tmp:
        for n in (100, 2000):  # ~today's data (91 samples) and a classroom-scale amount
            results[n] = bench(n, Path(tmp), rng)
            print(n, json.dumps(results[n]), flush=True)
    out = Path(__file__).resolve().parent.parent / 'docs' / 'storage-benchmark.json'
    out.write_text(json.dumps({'frames_per_sample': FRAMES, 'words': WORDS, 'results': results}, indent=1), encoding='utf-8')
    print('saved', out)


if __name__ == '__main__':
    main()
