"""Unit tests for ml/db.py on a throw-away database.  python -m unittest ml/test_db.py"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import db  # noqa: E402


class DatabaseTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.c = db.conn(Path(self.dir.name) / 'test.db')

    def tearDown(self):
        self.c.close()
        self.dir.cleanup()

    def test_samples_round_trip_and_undo(self):
        a = np.random.rand(40, 543, 3).astype(np.float32)
        db.save_sample('สวัสดี_x', a, c=self.c)
        db.save_sample('สวัสดี_x', a[:10], c=self.c)
        db.save_sample('ใช่_user', a[:5], c=self.c)
        self.assertEqual(db.counts(c=self.c), {'สวัสดี_x': 2, 'ใช่_user': 1})
        rows = db.load_samples(c=self.c)
        self.assertEqual([r[0] for r in rows], ['สวัสดี_x', 'สวัสดี_x', 'ใช่_user'])
        np.testing.assert_array_equal(rows[0][1], a.astype(np.float16).astype(np.float32))  # same as the old .npy files
        db.undo_last('สวัสดี_x', c=self.c)
        self.assertEqual(db.counts(c=self.c)['สวัสดี_x'], 1)
        self.assertEqual(db.load_samples(c=self.c)[0][1].shape, (40, 543, 3))      # the newest one was removed
        db.undo_last('ใช่_user', c=self.c)
        self.assertNotIn('ใช่_user', db.counts(c=self.c))                         # empty words drop out

    def test_words_and_corrections(self):
        db.set_word('เสียใจ_user', 'เสียใจ', 'sad', c=self.c)
        db.set_word('เสียใจ_user', 'เสียใจ', 'sorry', c=self.c)
        self.assertEqual(db.get_words(c=self.c), {'เสียใจ_user': {'th': 'เสียใจ', 'en': 'sorry'}})
        top = [{'label': 'พี่_var_1', 'prob': 0.6}, {'label': 'น้อง_var_1', 'prob': 0.3}]
        tid = db.log_translation(42, 40, top, c=self.c)
        db.correct_translation(tid, 'น้อง_var_1', c=self.c)
        s = db.stats(c=self.c)
        self.assertEqual((s['translations'], s['corrected']), (1, 1))
        self.assertEqual(s['top_confusions'], ['พี่_var_1 -> น้อง_var_1: 1'])

    def test_proposals_wait_for_approval(self):
        a = np.random.rand(12, 543, 3).astype(np.float32)
        db.save_sample('ดี_var_1', a, c=self.c)
        pid = db.save_sample('ดีใจ_user', a, c=self.c, status='pending', by='user01', th='ดีใจ', en='happy')
        rid = db.save_sample('ดี_var_1', a, c=self.c, status='pending', by='user01')
        self.assertEqual(db.counts(c=self.c), {'ดี_var_1': 1})               # pending samples are not counted
        self.assertEqual(len(db.load_samples(c=self.c)), 1)                    # ...and not trained on
        self.assertEqual([p['id'] for p in db.proposals(c=self.c)], [rid, pid])
        self.assertEqual(len(db.proposal_frames(pid, c=self.c)), 12 * 543 * 3 * 4)
        db.undo_last('ดีใจ_user', c=self.c)                                    # admin undo never touches proposals
        self.assertEqual(db.review([pid], True, c=self.c), 1)
        self.assertEqual(db.get_words(c=self.c)['ดีใจ_user'], {'th': 'ดีใจ', 'en': 'happy'})
        self.assertEqual(db.review([rid], False, c=self.c), 1)
        self.assertEqual(db.counts(c=self.c), {'ดี_var_1': 1, 'ดีใจ_user': 1})
        self.assertEqual(db.proposals(c=self.c), [])
        self.assertEqual(db.stats(c=self.c)['pending'], 0)

    def test_migration_imports_files_once(self):
        root = Path(self.dir.name)
        (root / 'samples' / 'ดี_var_1').mkdir(parents=True)
        np.save(root / 'samples' / 'ดี_var_1' / '1700000000000.npy', np.ones((8, 543, 3), np.float16))
        (root / 'words.json').write_text(json.dumps({'ดี_var_1': {'th': 'ดี', 'en': 'good'}}), encoding='utf-8')
        self.assertEqual(db.migrate_from_files(root / 'samples', root / 'words.json', c=self.c), 1)
        self.assertEqual(db.migrate_from_files(root / 'samples', root / 'words.json', c=self.c), 0)  # not twice
        self.assertEqual(db.counts(c=self.c), {'ดี_var_1': 1})
        self.assertEqual(db.get_words(c=self.c)['ดี_var_1']['en'], 'good')
        self.assertTrue((root / 'samples' / 'ดี_var_1' / '1700000000000.npy').exists())             # backup kept


if __name__ == '__main__':
    unittest.main()
