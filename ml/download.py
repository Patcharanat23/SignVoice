"""Download datasets and pretrained weights into ~/.signvoice (outside git and OneDrive).

  python ml/download.py
Licences: see LICENSES.md. TSL-51 and ThonburianTTS are CC BY-NC-SA 4.0 (non-commercial).
"""
import concurrent.futures as cf
import csv
import urllib.parse
import urllib.request

from paths import HOME

HF = 'https://huggingface.co'
TSL = f'{HF}/datasets/Namonpas/thai-sign-language-tsl51/resolve/main/'
FILES = {
    'models/asl250/model.tflite': f'{HF}/sign/kaggle-asl-signs-1st-place/resolve/main/model.tflite',
    'models/asl250/sign_to_prediction_index_map.json': f'{HF}/sign/kaggle-asl-signs-1st-place/resolve/main/sign_to_prediction_index_map.json',
    'models/thonburian/ref_000000.wav': 'https://raw.githubusercontent.com/biodatlab/thonburian-tts/main/assets/000000.wav',
    'tsl51/metadata/expert_metadata.csv': TSL + 'metadata/expert_metadata.csv',
    'tsl51/metadata/user_sign_metadata.csv': TSL + 'metadata/user_sign_metadata.csv',
    'tsl51/metadata/sentence_metadata.csv': TSL + 'metadata/sentence_metadata.csv',
    'tsl51/zips/expert_primary_02.zip': TSL + 'landmarks/expert_primary_02.zip',
    'tsl51/zips/expert_primary_03.zip': TSL + 'landmarks/expert_primary_03.zip',
    'tsl51/zips/expert_scraped.zip': TSL + 'landmarks/expert_scraped.zip',
    # TSL-ONE (29 signers, 184 signs). Non-commercial use; please also fill the request form at tsl-one.github.io.
    'tsl_one/TSL-ONE-Pose.7z': 'https://raw.githubusercontent.com/TSL-ONE/TSL-ONE.github.io/main/data/TSL-ONE-Pose.7z',
    'tsl_one/tsl_one_s_dataset.json': 'https://raw.githubusercontent.com/TSL-ONE/TSL-ONE.github.io/main/tsl_one_s_dataset.json',
    'tsl_one/tsl_one_s_id_to_label.json': 'https://raw.githubusercontent.com/TSL-ONE/TSL-ONE.github.io/main/tsl_one_s_id_to_label.json',
}


def fetch(target, url):
    path = HOME / target
    if path.exists() and path.stat().st_size > 0:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.part')
    with urllib.request.urlopen(url, timeout=120) as response, open(tmp, 'wb') as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)
    tmp.replace(path)
    print('ok', target, flush=True)


def main():
    for target, url in FILES.items():
        fetch(target, url)
    user = []
    for name in ('user_sign_metadata.csv', 'sentence_metadata.csv'):
        with open(HOME / 'tsl51' / 'metadata' / name, encoding='utf-8-sig') as f:
            user += [row['landmark_path'] for row in csv.DictReader(f)]
    with cf.ThreadPoolExecutor(8) as pool:
        list(pool.map(lambda p: fetch(f'tsl51/{p}', TSL + urllib.parse.quote(p)), user))
    print(f'done: {len(user)} user landmark files in {HOME / "tsl51"}')
    pose_dir = HOME / 'tsl_one' / 'pose'
    if not (pose_dir / 'TSL-ONE-Pose').exists():
        import py7zr  # numeric .npy keypoints only; loaded later with allow_pickle=False
        with py7zr.SevenZipFile(HOME / 'tsl_one' / 'TSL-ONE-Pose.7z') as archive:
            archive.extractall(pose_dir)
        print('extracted TSL-ONE keypoints')




def videos(per_class=2):
    """Download TSL-51 user_sign videos (an unseen signer for the signer-independent model) and
    re-encode to H.264 so Chrome can play them. Used by scripts/eval-tsl-browser.mjs."""
    import shutil
    import subprocess
    from collections import defaultdict
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise SystemExit('ffmpeg is required to re-encode TSL-51 videos (winget install Gyan.FFmpeg)')
    picked = defaultdict(list)
    with open(HOME / 'tsl51' / 'metadata' / 'user_sign_metadata.csv', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            if len(picked[row['sign_id']]) < per_class:
                picked[row['sign_id']].append(row)
    out = HOME / 'tsl51' / 'eval_videos'
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for sign, rows in picked.items():
        for row in rows:
            raw = HOME / 'tsl51' / row['video_path']
            fetch(f"tsl51/{row['video_path']}", TSL + urllib.parse.quote(row['video_path']))
            target = out / f"{row['video_id']}.mp4"
            if not target.exists():
                subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(raw), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', str(target)], check=True)
            manifest.append({'file': str(target), 'label': sign})
    import json
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{len(manifest)} evaluation videos in {out}')


if __name__ == '__main__':
    import sys
    if '--videos' in sys.argv:
        videos()
    else:
        main()
