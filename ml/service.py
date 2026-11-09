"""Local ML sidecar: sign classification (TSL-51 / ASL-250) and Thai/English speech.

Runs on 127.0.0.1 only; server.mjs starts it and proxies /api/sign and /api/speech.
Models stay loaded, so speech and recognition do not pay start-up cost per request.
"""
import io
import json
import os
import sys
import re
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import db  # noqa: E402
from features import prepare, tsl_points_from_543  # noqa: E402
from paths import HOME  # noqa: E402

PORT = int(os.environ.get('SIGNVOICE_ML_PORT', 8766))
MODELS = HOME / 'models'
state = {'tsl': None, 'asl': None, 'tts': None, 'errors': {}}
gpu = threading.Lock()
tts_loading = threading.Lock()
# With a cloud voice configured, the local voice (~2 GB RAM) loads only when it is first needed.
LAZY_TTS = bool(os.environ.get('ELEVENLABS_API_KEY'))


def log(*args):
    print('[ml]', *args, file=sys.stderr, flush=True)


def load_tsl():
    import onnxruntime as ort
    # SIGNVOICE_TSL_MODEL=tsl51/signer_independent loads the model that never saw the user_sign signer.
    # Otherwise prefer the model fine-tuned on the user's own signs, when one exists.
    chosen = os.environ.get('SIGNVOICE_TSL_MODEL')
    folder = MODELS / chosen if chosen else (MODELS / 'tsl51' / 'user' if (MODELS / 'tsl51' / 'user' / 'tsl51.onnx').exists() else MODELS / 'tsl51')
    log('tsl model:', folder)
    meta = json.load(open(folder / 'labels.json', encoding='utf-8'))
    session = ort.InferenceSession(str(folder / 'tsl51.onnx'), providers=['CPUExecutionProvider'])
    mean, std = np.array(meta['mean'], np.float32), np.array(meta['std'], np.float32)
    mask = np.array([allowed(label) for label in meta['labels']])
    log('tsl vocabulary:', int(mask.sum()), 'of', len(mask), 'classes')

    def run(frames):
        x = ((prepare(tsl_points_from_543(frames), use_face=meta.get('use_face', True)) - mean) / std)[None].astype(np.float32)
        logits = session.run(None, {'x': x})[0][0]
        logits = np.where(mask, logits, -1e9)
        return meta['labels'], logits
    run.english = english_names(meta)
    return run


# English for TSL-51 words (ml/tsl51_words_en.json); TSL-ONE labels already carry theirs in labels.json.
TSL51_EN = json.load(open(os.path.join(os.path.dirname(__file__), 'tsl51_words_en.json'), encoding='utf-8'))


def english_names(meta):
    names = dict(meta.get('english', {}))
    for label in meta['labels']:
        names.setdefault(label, TSL51_EN.get(label.split('_')[0]))
    return {k: v for k, v in names.items() if v}


def load_asl():
    from ai_edge_litert.interpreter import Interpreter
    folder = MODELS / 'asl250'
    index = json.load(open(folder / 'sign_to_prediction_index_map.json', encoding='utf-8'))
    labels = [None] * len(index)
    for sign, i in index.items():
        labels[i] = sign
    runner = Interpreter(model_path=str(folder / 'model.tflite')).get_signature_runner('serving_default')

    def run(frames):
        return labels, np.asarray(runner(inputs=np.asarray(frames, np.float32))['outputs']).reshape(-1)
    return run


def load_tts():
    import soundfile as sf
    import torch
    import torchaudio
    from cached_path import cached_path

    # torchaudio>=2.9 decodes through torchcodec, which needs FFmpeg DLLs; the reference clip is a plain WAV.
    def read_wav(path, *_, **__):
        data, sr = sf.read(str(path), dtype='float32', always_2d=True)
        return torch.from_numpy(data.T.copy()), sr
    torchaudio.load = read_wav
    from f5_tts.infer.utils_infer import infer_process, load_model, load_vocoder, preprocess_ref_audio_text
    from f5_tts.model import DiT
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    ckpt = str(cached_path('hf://biodatlab/ThonburianTTS/megaF5/mega_f5_last.safetensors'))
    vocab = str(cached_path('hf://biodatlab/ThonburianTTS/megaF5/mega_vocab.txt'))
    vocoder = load_vocoder('vocos', device=device)
    model = load_model(DiT, dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4), ckpt,
                       mel_spec_type='vocos', vocab_file=vocab, device=device)
    # Reference voice shipped with ThonburianTTS (assets/000000.wav, transcript from its demo app).
    ref_audio, ref_text = preprocess_ref_audio_text(str(MODELS / 'thonburian' / 'ref_000000.wav'), 'ใครเป็นผู้รับ', show_info=lambda *_: None)

    def run(text):
        wav, sr, _ = infer_process(ref_audio, ref_text, text, model, vocoder, nfe_step=32, cfg_strength=2.5,
                                   speed=1.0, device=device, show_info=lambda *_: None, progress=None)
        buffer = io.BytesIO()
        sf.write(buffer, wav, sr, format='WAV')
        return buffer.getvalue()
    return run


# Earlier versions stored samples/names as files; they are imported into SQLite once (see ml/db.py).
SAMPLES = HOME / 'user_samples'
WORDS = HOME / 'user_words.json'
# Everyday-communication scope: words in ml/vocab_exclude.json are never output or offered for teaching.
EXCLUDE = set(json.load(open(os.path.join(os.path.dirname(__file__), 'vocab_exclude.json'), encoding='utf-8'))['exclude'])
allowed = lambda label: label.split('_')[0] not in EXCLUDE
# A word the user adds in the teach panel: Thai/Latin letters, digits and spaces only (it becomes a folder name).
USER_WORD = re.compile(r'^[฀-๿A-Za-z0-9 ]{1,30}_user$')
training = {'running': False, 'message': '', 'progress': 0.0, 'report': None, 'error': None}


def sample_counts():
    return db.counts()


def run_finetune():
    import finetune_user
    try:
        def progress(message, fraction):
            training.update(message=message, progress=fraction)
        with gpu:
            report = finetune_user.finetune(progress)
        db.log_training(report, finetune_user.OUT / 'tsl51.onnx')
        state['tsl'] = load_tsl()
        training.update(report=report, error=None)
        log('fine-tune done:', report)
    except Exception as error:
        traceback.print_exc()
        training.update(error=f'{type(error).__name__}: {error}')
    finally:
        training['running'] = False


def warm(name, loader):
    try:
        state[name] = loader()
        log(name, 'ready')
    except Exception as error:  # keep the other models usable
        state['errors'][name] = f'{type(error).__name__}: {error}'
        log(name, 'unavailable:', state['errors'][name])


def top(labels, logits, k=5):
    p = np.exp(logits - logits.max())
    p /= p.sum()
    order = np.argsort(-p)[:k]
    return [{'label': labels[i], 'prob': float(p[i])} for i in order]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, code, body, kind='application/json; charset=utf-8'):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('content-type', kind)
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/user/samples':
            labels = json.load(open(MODELS / 'tsl51' / 'labels.json', encoding='utf-8'))['labels']
            report = MODELS / 'tsl51' / 'user' / 'report.json'
            labels = [label for label in labels if allowed(label)]
            labels += sorted(l for l, n in sample_counts().items() if l.endswith('_user') and n and l not in labels)
            meta = json.load(open(MODELS / 'tsl51' / 'labels.json', encoding='utf-8'))
            return self.send(200, {'labels': labels, 'counts': sample_counts(), 'training': training,
                                   'words': db.get_words(), 'english': english_names(meta),
                                   'personal': json.load(open(report, encoding='utf-8')) if report.exists() else None})
        if self.path == '/user/stats':
            return self.send(200, db.stats())
        if self.path == '/user/proposals':
            return self.send(200, {'proposals': db.proposals()})
        match = re.fullmatch(r'/user/proposals/(\d+)/frames', self.path)
        if match:  # landmarks of one pending sample, for the admin's skeleton preview
            data = db.proposal_frames(int(match.group(1)))
            return self.send(200, data, 'application/octet-stream') if data else self.send(404, {'error': 'not found'})
        if self.path == '/health':
            return self.send(200, {k: state[k] is not None for k in ('tsl', 'asl', 'tts')} | {'tts_lazy': LAZY_TTS, 'errors': state['errors']})
        self.send(404, {'error': 'not found'})

    def do_POST(self):
        url = urlparse(self.path)
        try:
            body = self.rfile.read(int(self.headers.get('content-length', 0)))
            if url.path == '/classify':
                lang = parse_qs(url.query).get('lang', ['tsl'])[0]
                model = state.get(lang if lang in ('tsl', 'asl') else 'tsl')
                if model is None:
                    return self.send(503, {'error': f'{lang} model unavailable', 'detail': state['errors'].get(lang)})
                frames = np.frombuffer(body, dtype='<f4')
                if frames.size == 0 or frames.size % (543 * 3) or frames.size > 543 * 3 * 400:
                    return self.send(400, {'error': 'expected 1..400 frames of 543x3 float32'})
                clip = frames.reshape(-1, 543, 3)
                labels, logits = model(clip)
                best = top(labels, logits)
                for item in best:  # English gloss for words that only exist in TSL-ONE
                    item['en'] = getattr(model, 'english', {}).get(item['label'])
                hand_frames = int((~np.isnan(clip[:, 468, 0]) | ~np.isnan(clip[:, 522, 0])).sum())
                log(f'{lang} {len(clip)} frames ({hand_frames} with hands):', ' · '.join(f"{t['label']} {t['prob']:.0%}" for t in best[:3]))
                return self.send(200, {'top': best, 'id': db.log_translation(len(clip), hand_frames, best)})
            if url.path in ('/user/sample', '/user/undo'):
                label = parse_qs(url.query).get('label', [''])[0]
                labels = json.load(open(MODELS / 'tsl51' / 'labels.json', encoding='utf-8'))['labels']
                if label not in labels and not USER_WORD.match(label):
                    return self.send(400, {'error': 'unknown label'})
                if url.path == '/user/undo':
                    db.undo_last(label)  # an added word with no samples left drops out of the list
                    return self.send(200, {'counts': sample_counts()})
                frames = np.frombuffer(body, dtype='<f4')
                if frames.size == 0 or frames.size % (543 * 3):
                    return self.send(400, {'error': 'expected frames of 543x3 float32'})
                db.save_sample(label, frames.reshape(-1, 543, 3))
                log('saved sample', label, sample_counts().get(label))
                return self.send(200, {'counts': sample_counts()})
            if url.path == '/user/words':
                data = json.loads(body or b'{}')
                label = str(data.get('label', ''))
                labels = json.load(open(MODELS / 'tsl51' / 'labels.json', encoding='utf-8'))['labels']
                if label not in labels and not USER_WORD.match(label):
                    return self.send(400, {'error': 'unknown label'})
                th, en = str(data.get('th', '')).strip()[:40], str(data.get('en', '')).strip()[:60]
                if not th:
                    return self.send(400, {'error': 'Thai name is required'})
                db.set_word(label, th, en)
                return self.send(200, {'words': db.get_words()})
            if url.path == '/user/propose':  # a non-admin user's sample: waits for an admin (see /user/proposals/review)
                q = parse_qs(url.query)
                label, by = q.get('label', [''])[0], q.get('by', [''])[0]
                th, en = q.get('th', [''])[0].strip()[:40], q.get('en', [''])[0].strip()[:60]
                labels = json.load(open(MODELS / 'tsl51' / 'labels.json', encoding='utf-8'))['labels']
                if (label not in labels and not USER_WORD.match(label)) or not re.fullmatch(r'[a-z0-9_.]{3,32}', by):
                    return self.send(400, {'error': 'unknown label'})
                frames = np.frombuffer(body, dtype='<f4')
                if frames.size == 0 or frames.size % (543 * 3) or frames.size > 543 * 3 * 400:
                    return self.send(400, {'error': 'expected 1..400 frames of 543x3 float32'})
                db.save_sample(label, frames.reshape(-1, 543, 3), status='pending', by=by, th=th or None, en=en or None)
                log('proposed sample', label, 'by', by)
                return self.send(200, {'pending': sum(p['by'] == by for p in db.proposals())})
            if url.path == '/user/proposals/review':
                data = json.loads(body or b'{}')
                done = db.review(data.get('ids', []), data.get('action') == 'approve')
                return self.send(200, {'done': done, 'proposals': db.proposals(), 'counts': sample_counts()})
            if url.path == '/user/correct':  # the user picked the right word for a translation
                data = json.loads(body or b'{}')
                db.correct_translation(int(data.get('id', 0)), str(data.get('label', ''))[:80])
                return self.send(200, {'ok': True})
            if url.path == '/user/finetune':
                if not training['running']:
                    training.update(running=True, message='เริ่ม', progress=0.0, error=None)
                    threading.Thread(target=run_finetune, daemon=True).start()
                return self.send(200, {'training': training})
            if url.path == '/tts':
                text = str(json.loads(body).get('text', '')).strip()[:300]
                if not text:
                    return self.send(400, {'error': 'missing text'})
                if state['tts'] is None and LAZY_TTS:
                    with tts_loading:  # first local-voice request: load it now (~45 s), later ones are fast
                        if state['tts'] is None:
                            state['errors'].pop('tts', None)
                            warm('tts', load_tts)
                if state['tts'] is None:
                    return self.send(503, {'error': 'tts unavailable', 'detail': state['errors'].get('tts')})
                with gpu:
                    return self.send(200, state['tts'](text), 'audio/wav')
            self.send(404, {'error': 'not found'})
        except Exception as error:
            traceback.print_exc()
            self.send(500, {'error': str(error)})


if __name__ == '__main__':
    os.environ.setdefault('HF_HOME', str(HOME / 'hf'))
    sys.stdout = sys.stderr  # libraries print progress; keep it all on one stream
    parent = int(os.environ.get('SIGNVOICE_PARENT_PID', 0))
    if parent and os.name == 'nt':
        # Exit with server.mjs even if it is killed. (A thread blocked reading a stdin pipe
        # stalls other pipe I/O on Windows, so wait on the parent process handle instead.)
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x00100000, False, parent)  # SYNCHRONIZE
        if handle:
            threading.Thread(target=lambda: (ctypes.windll.kernel32.WaitForSingleObject(handle, 0xFFFFFFFF), os._exit(0)), daemon=True).start()
    moved = db.migrate_from_files(SAMPLES, WORDS)
    if moved:
        log(f'database: imported {moved} samples from files into {db.PATH} (old files kept as backup)')
    warm('tsl', load_tsl)
    if os.environ.get('SIGNVOICE_ASL') == '1':  # the web app is Thai-only; ASL stays off to save memory
        warm('asl', load_asl)
    if LAZY_TTS:
        log('tts: cloud voice configured, local voice loads on first fallback')
    else:
        threading.Thread(target=warm, args=('tts', load_tts), daemon=True).start()
    log(f'listening on 127.0.0.1:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
