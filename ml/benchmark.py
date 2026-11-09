"""Hardware benchmark for comparing machines (run the same script on each computer).

  python ml/benchmark.py            # environment, sign-model speed/accuracy, training speed, LLM latency
  python ml/benchmark.py --tts      # also the local Thai voice (loads ~2 GB)

Writes docs/benchmark-<computer>.json and prints a summary. Accuracy must be identical on every
machine (same model, same test clips); only the timings should differ.
"""
import json
import os
import platform
import socket
import statistics
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(__file__))
from features import T, prepare, tsl_points_from_tslone, without_face  # noqa: E402
from paths import HOME  # noqa: E402
from train_tsl import SignNet  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TEST_SIGNERS = {'04', '09', '15', '21', '27'}


def sh(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20, shell=True).stdout.strip()
    except Exception:
        return ''


def environment():
    env = {'computer': socket.gethostname(), 'os': platform.platform(), 'python': platform.python_version(),
           'torch': torch.__version__, 'cuda': torch.version.cuda, 'cpu': platform.processor(), 'cpu_threads': os.cpu_count()}
    if os.name == 'nt':
        env['cpu'] = sh('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).Name"') or env['cpu']
        ram = sh('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"')
        env['ram_gb'] = round(int(ram) / 2**30, 1) if ram.isdigit() else None
    if torch.cuda.is_available():
        p = torch.cuda.get_device_properties(0)
        env |= {'gpu': p.name, 'gpu_vram_gb': round(p.total_memory / 2**30, 1),
                'gpu_driver': sh('nvidia-smi --query-gpu=driver_version --format=csv,noheader')}
    else:
        env['gpu'] = 'none (CPU only)'
    return env


def timed(fn, warmup=5, runs=50):
    for _ in range(warmup):
        fn()
    ts = []
    for _ in range(runs):
        t = time.perf_counter(); fn(); ts.append((time.perf_counter() - t) * 1000)
    return round(statistics.median(ts), 2)


def sign_model():
    """Inference latency of the deployed ONNX model + accuracy of the held-out-signer model."""
    import onnxruntime as ort
    out = {}
    d = HOME / 'models' / 'tsl51'
    meta = json.load(open(d / 'labels.json', encoding='utf-8'))
    sess = ort.InferenceSession(str(d / 'tsl51.onnx'), providers=['CPUExecutionProvider'])
    x = np.random.rand(1, T, len(meta['mean'])).astype(np.float32)
    out['onnx_cpu_ms_per_clip'] = timed(lambda: sess.run(None, {'x': x}))
    clip = np.random.rand(45, 54, 3).astype(np.float32)  # a typical live clip is ~42 frames
    out['feature_extraction_ms_per_clip'] = timed(lambda: prepare(clip, use_face=meta.get('use_face', True)))

    si = HOME / 'models' / 'tsl_combined_si'
    words = json.load(open(Path(__file__).with_name('tsl_one_words.json'), encoding='utf-8'))
    if (si / 'tsl51.pt').exists() and (HOME / 'tsl_one' / 'pose').exists():
        m = json.load(open(si / 'labels.json', encoding='utf-8')); labels = m['labels']
        model = SignNet(len(m['mean']), len(labels)); model.load_state_dict(torch.load(si / 'tsl51.pt', map_location='cpu')); model.eval()
        X, y = [], []
        for g in json.load(open(HOME / 'tsl_one' / 'tsl_one_s_dataset.json', encoding='utf-8')):
            for inst in g['instances']:
                f = HOME / 'tsl_one/pose/TSL-ONE-Pose' / f"{inst['video_id']}.npy"
                if inst['video_id'][:2] in TEST_SIGNERS and f.exists():  # one clip (15_08_0267) is missing from the archive
                    X.append(prepare(tsl_points_from_tslone(np.load(f, allow_pickle=False)), False))
                    y.append(labels.index(f"{words[g['gloss']]}_tslone"))
        X = (np.stack(X) - np.array(m['mean'], np.float32)) / np.array(m['std'], np.float32)
        with torch.no_grad():
            pred = model(torch.from_numpy(X.astype(np.float32))).argmax(1).numpy()
        out['heldout_tslone_top1'] = round(float((pred == np.array(y)).mean()), 4)
        out['heldout_clips'] = len(y)
    return out


def training_speed():
    """Steps/second of the sign model on random data (batch 256, same as the real training)."""
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = SignNet(266, 236).to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3)
    xb = torch.randn(256, T, 266, device=dev); yb = torch.randint(0, 236, (256,), device=dev)
    def step():
        opt.zero_grad(); nn_loss = torch.nn.functional.cross_entropy(model(xb), yb); nn_loss.backward(); opt.step()
        if dev == 'cuda':
            torch.cuda.synchronize()
    ms = timed(step, warmup=10, runs=40)
    steps_per_epoch = 51739 // 256  # deployment training set size
    return {'device': dev, 'train_ms_per_step': ms, 'est_minutes_for_40_epochs': round(ms * steps_per_epoch * 40 / 60000, 1)}


def llm_latency():
    url = os.environ.get('OLLAMA_URL', 'http://127.0.0.1:11434') + '/api/chat'
    sentences = [['ภาษามือ', 'ฉัน', 'เรียน', 'ชอบ'], ['สวัสดี', 'ฉัน', 'ชื่อ', 'ส', 'ม'], ['คุณ', 'สบายดี']]
    times = []
    try:
        for words in sentences * 2:
            body = json.dumps({'model': 'qwen3:4b-instruct', 'stream': False, 'options': {'temperature': 0.1, 'num_predict': 120},
                               'messages': [{'role': 'user', 'content': 'เรียงคำเป็นประโยคไทย: ' + ' '.join(words)}]}).encode()
            t = time.perf_counter()
            urllib.request.urlopen(urllib.request.Request(url, body, {'content-type': 'application/json'}), timeout=120).read()
            times.append(round((time.perf_counter() - t) * 1000))
        return {'llm_first_ms': times[0], 'llm_warm_median_ms': int(statistics.median(times[1:]))}
    except Exception as error:
        return {'llm': f'unavailable ({error.__class__.__name__})'}


def tts_speed():
    import service
    t = time.perf_counter(); run = service.load_tts(); load = time.perf_counter() - t
    times = []
    for text in ['สวัสดีครับ', 'ฉันชอบเรียนภาษามือ', 'สวัสดี ฉันชื่อสมชาย ยินดีที่ได้รู้จักครับ']:
        t = time.perf_counter(); run(text); times.append(round(time.perf_counter() - t, 2))
    return {'tts_load_s': round(load, 1), 'tts_seconds_per_sentence': times}


def main():
    os.environ.setdefault('HF_HOME', str(HOME / 'hf'))
    result = {'environment': environment()}
    print(json.dumps(result['environment'], ensure_ascii=False, indent=1), flush=True)
    for name, fn in [('sign_model', sign_model), ('training', training_speed), ('llm', llm_latency)] + ([('tts', tts_speed)] if '--tts' in sys.argv else []):
        result[name] = fn()
        print(name, json.dumps(result[name], ensure_ascii=False), flush=True)
    out = ROOT / 'docs' / f"benchmark-{result['environment']['computer']}.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    print('saved', out)


if __name__ == '__main__':
    main()
