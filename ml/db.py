"""SQLite storage for everything the app writes at run time (one file: ~/.signvoice/signvoice.db).

Why SQLite (see docs/EXPERIMENTS.md): one local server, a handful of users, structured data that needs
querying (counts per word, correction statistics), no server to install, works offline, and the same
SQL moves to PostgreSQL/Supabase if the app ever runs on several machines.

Tables
  words         display names per label (Thai/English) and where the word came from
  samples       the user's recorded signs (landmarks only, float16 BLOB of frames x 543 x 3)
  translations  every translation made by the app, and the word the user picked if they corrected it
  training_runs every personal fine-tune with its held-out before/after accuracy
Large files (datasets, ONNX models) stay on disk; the database stores their paths and results.
"""
import json
import sqlite3
import threading
import time
from pathlib import Path

import numpy as np

from paths import HOME

PATH = HOME / 'signvoice.db'
_lock = threading.Lock()
_conn = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS words (
  label TEXT PRIMARY KEY, th TEXT NOT NULL, en TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'user', updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, created_at REAL NOT NULL,
  frames INTEGER NOT NULL, data BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS samples_label ON samples(label);
CREATE TABLE IF NOT EXISTS translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at REAL NOT NULL, frames INTEGER, hand_frames INTEGER,
  top_label TEXT, top_prob REAL, top3 TEXT, corrected_label TEXT);
CREATE TABLE IF NOT EXISTS training_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, finished_at REAL NOT NULL, words INTEGER, new_words TEXT,
  train_samples INTEGER, heldout_samples INTEGER, heldout_before REAL, heldout_after REAL, model_path TEXT);
"""


def _prepare(c):
    c.execute('PRAGMA journal_mode=WAL')  # readers do not block the writer
    c.executescript(SCHEMA)
    # Proposals (added later): samples from non-admin users wait as 'pending' until an admin approves them.
    have = {row[1] for row in c.execute('PRAGMA table_info(samples)')}
    for name, decl in (('status', "TEXT NOT NULL DEFAULT 'approved'"), ('proposed_by', 'TEXT'), ('word_th', 'TEXT'), ('word_en', 'TEXT')):
        if name not in have:
            c.execute(f'ALTER TABLE samples ADD COLUMN {name} {decl}')
    c.execute('CREATE INDEX IF NOT EXISTS samples_status ON samples(status)')
    c.commit()
    return c


def conn(path=None):
    """One shared connection (the service is multi-threaded; every call below takes the lock)."""
    global _conn
    if path is not None:  # tests / benchmarks use their own file
        return _prepare(sqlite3.connect(path, check_same_thread=False))
    if _conn is None:
        PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = _prepare(sqlite3.connect(PATH, check_same_thread=False))
    return _conn


def _run(sql, args=(), c=None, many=False):
    with _lock:
        c = c or conn()
        cur = c.executemany(sql, args) if many else c.execute(sql, args)
        c.commit()
        return cur


def migrate_from_files(samples_dir, words_file, c=None):
    """Copy the earlier file storage (user_samples/<label>/<ms>.npy, user_words.json) in once.
    The old files are left in place as a backup."""
    c = c or conn()
    if _run("SELECT value FROM meta WHERE key='migrated_files'", c=c).fetchone():
        return 0
    rows = []
    for folder in sorted(Path(samples_dir).glob('*')):
        for f in sorted(folder.glob('*.npy')):
            a = np.load(f, allow_pickle=False).astype(np.float16)
            created = int(f.stem) / 1000 if f.stem.isdigit() else f.stat().st_mtime
            rows.append((folder.name, created, len(a), a.tobytes()))
    _run('INSERT INTO samples(label, created_at, frames, data) VALUES (?,?,?,?)', rows, c=c, many=True)
    try:
        words = json.loads(Path(words_file).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        words = {}
    _run('INSERT OR REPLACE INTO words(label, th, en, source, updated_at) VALUES (?,?,?,?,?)',
         [(k, v.get('th', ''), v.get('en', ''), 'user' if k.endswith('_user') else 'edited', time.time()) for k, v in words.items()], c=c, many=True)
    _run("INSERT INTO meta(key, value) VALUES ('migrated_files', ?)", (str(len(rows)),), c=c)
    return len(rows)


def save_sample(label, frames, c=None, status='approved', by=None, th=None, en=None):
    a = np.asarray(frames, np.float16).reshape(-1, 543, 3)
    return _run('INSERT INTO samples(label, created_at, frames, data, status, proposed_by, word_th, word_en) VALUES (?,?,?,?,?,?,?,?)',
                (label, time.time(), len(a), a.tobytes(), status, by, th, en), c=c).lastrowid


def undo_last(label, c=None):
    _run("DELETE FROM samples WHERE id = (SELECT MAX(id) FROM samples WHERE label = ? AND status = 'approved')", (label,), c=c)


def counts(c=None):
    return dict(_run("SELECT label, COUNT(*) FROM samples WHERE status = 'approved' GROUP BY label", c=c).fetchall())


def proposals(c=None):
    """Pending samples proposed by non-admin users, newest first (without the landmark data)."""
    rows = _run("SELECT id, label, proposed_by, created_at, frames, word_th, word_en, data FROM samples WHERE status = 'pending' ORDER BY id DESC", c=c).fetchall()
    out = []
    for i, label, by, at, n, th, en, data in rows:
        a = np.frombuffer(data, np.float16).reshape(n, 543, 3)
        hands = int((~np.isnan(a[:, 468, 0]) | ~np.isnan(a[:, 522, 0])).sum())
        out.append({'id': i, 'label': label, 'by': by, 'at': at, 'frames': n, 'hand_frames': hands, 'th': th, 'en': en})
    return out


def proposal_frames(sample_id, c=None):
    row = _run("SELECT frames, data FROM samples WHERE id = ? AND status = 'pending'", (sample_id,), c=c).fetchone()
    return None if row is None else np.frombuffer(row[1], np.float16).astype('<f4').tobytes()


def review(ids, approve, c=None):
    """Approve (the samples join training; a proposed new word gets its name) or reject (deleted)."""
    ids = [int(i) for i in ids][:500]
    if not ids:
        return 0
    marks = ','.join('?' * len(ids))
    if approve:
        named = _run(f"SELECT label, word_th, word_en FROM samples WHERE status = 'pending' AND id IN ({marks}) AND word_th IS NOT NULL", ids, c=c).fetchall()
        known = get_words(c=c)
        for label, th, en in named:
            if label not in known:
                set_word(label, th, en or '', c=c)
                known[label] = True
        return _run(f"UPDATE samples SET status = 'approved' WHERE status = 'pending' AND id IN ({marks})", ids, c=c).rowcount
    return _run(f"DELETE FROM samples WHERE status = 'pending' AND id IN ({marks})", ids, c=c).rowcount


def load_samples(c=None):
    """[(label, float32 array frames x 543 x 3)] in recording order — what fine-tuning trains on (approved only)."""
    rows = _run("SELECT label, frames, data FROM samples WHERE status = 'approved' ORDER BY id", c=c).fetchall()
    return [(label, np.frombuffer(data, np.float16).reshape(n, 543, 3).astype(np.float32)) for label, n, data in rows]


def get_words(c=None):
    return {label: {'th': th, 'en': en} for label, th, en in _run('SELECT label, th, en FROM words', c=c).fetchall()}


def set_word(label, th, en, c=None):
    _run('INSERT OR REPLACE INTO words(label, th, en, source, updated_at) VALUES (?,?,?,?,?)',
         (label, th, en, 'user' if label.endswith('_user') else 'edited', time.time()), c=c)


def log_translation(frames, hand_frames, top, c=None):
    return _run('INSERT INTO translations(created_at, frames, hand_frames, top_label, top_prob, top3) VALUES (?,?,?,?,?,?)',
                (time.time(), frames, hand_frames, top[0]['label'], top[0]['prob'], json.dumps([t['label'] for t in top[:3]], ensure_ascii=False)), c=c).lastrowid


def correct_translation(translation_id, label, c=None):
    _run('UPDATE translations SET corrected_label = ? WHERE id = ?', (label, translation_id), c=c)


def log_training(report, model_path, c=None):
    _run('INSERT INTO training_runs(finished_at, words, new_words, train_samples, heldout_samples, heldout_before, heldout_after, model_path) VALUES (?,?,?,?,?,?,?,?)',
         (time.time(), report.get('words'), json.dumps(report.get('new_words', []), ensure_ascii=False), report.get('train_samples'),
          report.get('heldout_samples'), report.get('heldout_before'), report.get('heldout_after'), str(model_path)), c=c)


def stats(c=None):
    """Usage statistics for reports: translations, how often the user corrected them, most-corrected words."""
    total, corrected = _run('SELECT COUNT(*), COUNT(corrected_label) FROM translations', c=c).fetchone()
    wrong = _run('SELECT top_label, corrected_label, COUNT(*) n FROM translations WHERE corrected_label IS NOT NULL '
                 'AND corrected_label != top_label GROUP BY 1, 2 ORDER BY n DESC LIMIT 10', c=c).fetchall()
    return {'translations': total, 'corrected': corrected, 'top_confusions': [f'{a} -> {b}: {n}' for a, b, n in wrong],
            'samples': _run("SELECT COUNT(*) FROM samples WHERE status = 'approved'", c=c).fetchone()[0],
            'pending': _run("SELECT COUNT(*) FROM samples WHERE status = 'pending'", c=c).fetchone()[0],
            'training_runs': _run('SELECT COUNT(*) FROM training_runs', c=c).fetchone()[0]}
