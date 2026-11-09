"""Shared landmark layout and TSL feature extraction (used by training and the live service).

Browser frames use the Kaggle ASL layout: 543 points x (x, y, z), NaN when missing.
  face 0..467 | left hand 468..488 | pose 489..521 | right hand 522..542
"Left"/"right" are the signer's own hands, matching MediaPipe Holistic and TSL-51.
"""
import numpy as np

FACE_IDS = [105, 70, 300, 334, 61, 291]  # TSL-51 brow/mouth columns, in CSV order
LH, POSE, RH = 468, 489, 522
T = 32  # frames after resampling


def tsl_points_from_543(frames):
    """(N, 543, 3) -> (N, 54, 3) in TSL-51 order: lh21, rh21, pose(11..16), face6."""
    f = np.asarray(frames, dtype=np.float32)
    return np.concatenate([f[:, LH:LH + 21], f[:, RH:RH + 21], f[:, POSE + 11:POSE + 17], f[:, FACE_IDS]], axis=1)


def tsl_points_from_csv(df):
    """TSL-51 landmark CSV -> (N, 54, 3)."""
    cols = [f'{h}_{a}{i}' for h in ('lh', 'rh') for i in range(21) for a in 'xyz']
    cols += [f'{p}_{a}' for p in ('l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist') for a in 'xyz']
    cols += [f'{p}_{a}' for p in ('lbrow_outer', 'lbrow_inner', 'rbrow_inner', 'rbrow_outer', 'mouth_right', 'mouth_left') for a in 'xyz']
    return df[cols].to_numpy(np.float32).reshape(len(df), 54, 3)


def active_span(points, margin=2):
    """Frames from first to last detected hand (the same rule the browser uses to cut a sign)."""
    hand = ~np.isnan(points[:, 0, 0]) | ~np.isnan(points[:, 21, 0])
    idx = np.flatnonzero(hand)
    if not len(idx):
        return points
    return points[max(idx[0] - margin, 0): idx[-1] + margin + 1]


def resample(points, length=T):
    n = len(points)
    if n == 1:
        return np.repeat(points, length, axis=0)
    pos = np.linspace(0, n - 1, length)
    lo = np.floor(pos).astype(int)
    hi = np.minimum(lo + 1, n - 1)
    w = (pos - lo)[:, None, None]
    a, b = points[lo], points[hi]
    out = a * (1 - w) + b * w
    # Keep a value from either side when one neighbour is missing.
    out = np.where(np.isnan(a), b, np.where(np.isnan(b), a, out))
    return out.astype(np.float32)


FACE_COLS = slice(96, 108)  # brow/mouth x,y columns inside features(); absent from TSL-ONE


def without_face(feats):
    """Drop the 6 face points so TSL-51 and TSL-ONE (no face landmarks) share one feature space."""
    return np.concatenate([feats[..., :FACE_COLS.start], feats[..., FACE_COLS.stop:]], axis=-1)


def features(points):
    """(T, 54, 3) -> (T, F). Body-centred, shoulder-scaled x/y plus wrist-relative hand shape."""
    p = points[..., :2].astype(np.float32)
    sh = p[:, 42:44]  # left/right shoulder
    centre = np.nanmedian(sh.mean(axis=1), axis=0)
    width = np.nanmedian(np.linalg.norm(sh[:, 0] - sh[:, 1], axis=-1))
    if not np.isfinite(width) or width < 1e-3:
        centre, width = np.array([0.5, 0.5], np.float32), 0.3
    centre = np.nan_to_num(centre, nan=0.5)
    body = (p - centre) / width
    parts = [body[:, :42].reshape(len(p), -1), body[:, 42:].reshape(len(p), -1)]
    present = []
    for start in (0, 21):
        hand = p[:, start:start + 21]
        size = np.linalg.norm(hand[:, 9] - hand[:, 0], axis=-1, keepdims=True)[..., None]
        local = (hand - hand[:, :1]) / np.maximum(size, 1e-3)
        parts.append(local.reshape(len(p), -1))
        present.append((~np.isnan(hand[:, 0, 0])).astype(np.float32)[:, None])
    feat = np.concatenate(parts + present, axis=1)
    vel = np.diff(feat[:, :84], axis=0, prepend=feat[:1, :84])
    return np.nan_to_num(np.concatenate([feat, vel], axis=1), nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)


def prepare(points, use_face=True):
    feats = features(resample(active_span(points)))
    return feats if use_face else without_face(feats)


def tsl_points_from_tslone(flat):
    """TSL-ONE frame (150,) = 75 x (x, y): pose 33, left hand 21, right hand 21; 0 = missing."""
    a = np.asarray(flat, np.float32).reshape(-1, 75, 2)
    out = np.full((len(a), 54, 3), np.nan, np.float32)
    for dst, src in ((0, 33), (21, 54)):
        hand = a[:, src:src + 21]
        seen = np.abs(hand).sum((1, 2)) > 0
        out[seen, dst:dst + 21, :2] = hand[seen]
    out[:, 42:48, :2] = a[:, 11:17]
    out[:, 42:48, 2] = 0
    out[:, :42, 2] = np.where(np.isnan(out[:, :42, 0]), np.nan, 0)
    return out


def mirror_points(points):
    """Left/right mirror of a (T, 54, 3) clip: x -> 1 - x, left/right hands, arms and face swapped.
    A left-hand-dominant signer then looks like a right-hand-dominant one."""
    p = points.copy()
    p[..., 0] = 1.0 - p[..., 0]
    out = p.copy()
    out[:, 0:21], out[:, 21:42] = p[:, 21:42], p[:, 0:21]                      # hands
    for a, b in ((42, 43), (44, 45), (46, 47), (48, 51), (49, 50), (52, 53)):  # shoulders, elbows, wrists, brows, mouth
        out[:, a], out[:, b] = p[:, b], p[:, a]
    return out
