"""Compare landmark extractors on TSL-51 user_sign videos with the signer-independent model.

  A: HolisticLandmarker (close to how TSL-51 was extracted)
  B: HandLandmarker + PoseLandmarker lite + FaceLandmarker (the faster browser setup)
Videos: python ml/download.py --videos. Frames are sampled at ~15 FPS like the browser.
"""
import json
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import onnxruntime as ort
from mediapipe.tasks.python import BaseOptions, vision

from features import prepare, tsl_points_from_543
from paths import HOME

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / 'public' / 'models'
SI = HOME / 'models' / 'tsl51' / 'signer_independent'
meta = json.load(open(SI / 'labels.json', encoding='utf-8'))
session = ort.InferenceSession(str(SI / 'tsl51.onnx'), providers=['CPUExecutionProvider'])
mean, std = np.array(meta['mean'], np.float32), np.array(meta['std'], np.float32)
VIDEO = vision.RunningMode.VIDEO


def put(frame, offset, landmarks, count):
    for i, p in enumerate(landmarks[:count]):
        frame[offset + i] = (p.x, p.y, p.z)


def assign_hands(frame, hands, pose):
    """Same rule as src/signs.js: nearest pose wrist decides left (15) vs right (16)."""
    if not hands:
        return
    if pose:
        lw, rw = np.array([pose[15].x, pose[15].y]), np.array([pose[16].x, pose[16].y])
        sides = []
        for h in hands[:2]:
            w = np.array([h[0].x, h[0].y])
            sides.append(468 if np.sum((w - lw) ** 2) < np.sum((w - rw) ** 2) else 522)
        if len(sides) == 2 and sides[0] == sides[1]:
            sides[1] = 522 if sides[0] == 468 else 468
    else:
        sides = [468, 522]
    for h, offset in zip(hands, sides):
        put(frame, offset, h, 21)


def holistic_extractor():
    model = vision.HolisticLandmarker.create_from_options(vision.HolisticLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(HOME / 'models' / 'holistic_landmarker.task')), running_mode=VIDEO))

    def run(image, ts):
        r = model.detect_for_video(image, ts)
        f = np.full((543, 3), np.nan, np.float32)
        if r.face_landmarks: put(f, 0, r.face_landmarks, 468)
        if r.pose_landmarks: put(f, 489, r.pose_landmarks, 33)
        hands = [h for h in (r.left_hand_landmarks, r.right_hand_landmarks) if h]
        assign_hands(f, hands, r.pose_landmarks or None)
        return f
    return run


def split_extractor():
    hand = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODELS / 'hand_landmarker.task')), running_mode=VIDEO, num_hands=2,
        min_hand_detection_confidence=0.4, min_hand_presence_confidence=0.4, min_tracking_confidence=0.4))
    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODELS / 'pose_landmarker_lite.task')), running_mode=VIDEO))
    face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODELS / 'face_landmarker.task')), running_mode=VIDEO))

    def run(image, ts):
        h, p, fa = hand.detect_for_video(image, ts), pose.detect_for_video(image, ts), face.detect_for_video(image, ts)
        f = np.full((543, 3), np.nan, np.float32)
        if fa.face_landmarks: put(f, 0, fa.face_landmarks[0], 468)
        if p.pose_landmarks: put(f, 489, p.pose_landmarks[0], 33)
        assign_hands(f, h.hand_landmarks, p.pose_landmarks[0] if p.pose_landmarks else None)
        return f
    return run


def classify(frames):
    x = ((prepare(tsl_points_from_543(np.stack(frames))) - mean) / std)[None].astype(np.float32)
    return meta['labels'][int(session.run(None, {'x': x})[0][0].argmax())]


def main():
    manifest = json.load(open(HOME / 'tsl51' / 'eval_videos' / 'manifest.json', encoding='utf-8'))
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(manifest)
    results = {}
    for name, make in (('holistic', holistic_extractor), ('hand+pose+face', split_extractor)):
        run, correct, rows = make(), 0, []
        ts = 0
        for item in manifest[:limit]:
            cap = cv2.VideoCapture(item['file'])
            fps = cap.get(cv2.CAP_PROP_FPS) or 30
            step = max(1, round(fps / 15))
            frames, i = [], 0
            while True:
                ok, bgr = cap.read()
                if not ok:
                    break
                if i % step == 0:
                    ts += int(1000 / 15)
                    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
                    frames.append(run(image, ts))
                i += 1
            pred = classify(frames)
            ok = pred == item['label']
            correct += ok
            rows.append(f"{'✔' if ok else '✖'} {item['label']} -> {pred}")
        results[name] = correct / limit
        print(name, f'{correct}/{limit} = {correct / limit:.1%}', flush=True)
        print('  wrong:', '; '.join(r[2:] for r in rows if r.startswith('✖')), flush=True)
    print(json.dumps(results))


if __name__ == '__main__':
    main()
