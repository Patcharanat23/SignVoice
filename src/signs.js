// Continuous sign-language input: pack MediaPipe Holistic results into the
// 543-point layout shared by the ASL (Kaggle) and TSL-51 models, then cut the
// stream into one clip per sign.

export const POINTS = 543;
const FACE = 0, LH = 468, POSE = 489, RH = 522;

function put(frame, offset, landmarks, count) {
  if (!landmarks) return;
  for (let i = 0; i < count && i < landmarks.length; i++) {
    const p = landmarks[i];
    frame[(offset + i) * 3] = p.x;
    frame[(offset + i) * 3 + 1] = p.y;
    frame[(offset + i) * 3 + 2] = p.z;
  }
}

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * Returns { frame: Float32Array(543*3) with NaN for missing points, hands: number }.
 * Hands are assigned to the signer's left/right by distance to the pose wrists
 * (pose 15/16), which is what the training data encodes, rather than trusting labels.
 */
export function packFrame(result) {
  const frame = new Float32Array(POINTS * 3).fill(NaN);
  const pose = result.poseLandmarks?.[0];
  put(frame, FACE, result.faceLandmarks?.[0], 468);
  put(frame, POSE, pose, 33);
  let left = result.leftHandLandmarks?.[0];
  let right = result.rightHandLandmarks?.[0];
  if (pose?.[15] && pose?.[16]) {
    const swap = (h, own, other) => h && dist2(h[0], pose[other]) < dist2(h[0], pose[own]);
    if (swap(left, 15, 16) || swap(right, 16, 15)) [left, right] = [right, left];
  }
  put(frame, LH, left, 21);
  put(frame, RH, right, 21);
  return { frame, hands: Number(Boolean(left?.length)) + Number(Boolean(right?.length)) };
}

/** Collects frames while hands are visible; emits a clip once hands rest (leave view). */
export class SignSegmenter {
  constructor({ endGapMs = 450, bridgeMs = 1200, minFrames = 6, maxMs = 4500, preFrames = 2 } = {}) {
    Object.assign(this, { endGapMs, bridgeMs, minFrames, maxMs, preFrames });
    this.reset();
  }

  reset() {
    this.frames = [];
    this.recent = [];
    this.active = false;
    this.startAt = 0;
    this.lastHandAt = -Infinity;
  }

  /** Returns an array of Float32Array frames when a sign clip is complete, else null. */
  /** armsUp: the pose wrists are still in signing space, so a brief hand-tracking drop-out is bridged. */
  update(frame, hands, now, armsUp = false) {
    if (!this.active) {
      this.recent.push(frame);
      if (this.recent.length > this.preFrames + 1) this.recent.shift();
      if (!hands) return null;
      this.active = true;
      this.startAt = now;
      this.frames = [...this.recent];
      this.lastHandAt = now;
      return null;
    }
    this.frames.push(frame);
    if (hands) this.lastHandAt = now;
    const ended = now - this.lastHandAt >= (armsUp ? this.bridgeMs : this.endGapMs);
    const tooLong = now - this.startAt >= this.maxMs;
    if (!ended && !tooLong) return null;
    const clip = this.frames;
    this.active = false;
    this.recent = [];
    this.frames = [];
    const handFrames = clip.filter((f) => !Number.isNaN(f[LH * 3]) || !Number.isNaN(f[RH * 3])).length;
    return handFrames >= this.minFrames ? clip : null;
  }

  get collecting() {
    return this.active;
  }
}

export function concatFrames(frames) {
  const out = new Float32Array(frames.length * POINTS * 3);
  frames.forEach((frame, i) => out.set(frame, i * POINTS * 3));
  return out;
}

/** Model label -> word. TSL-51 labels look like "สวัสดี_อายุเท่ากันหรือน้อยกว่า" or "แม่_var_1". */
export function wordForLabel(label, model) {
  if (model === 'tsl') return label === 'null_act' ? null : label.split('_')[0];
  return label;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Thumb pointing up with the other four fingers curled (a fist with the thumb raised). */
export function isThumbsUp(hand) {
  if (!hand || hand.length < 21) return false;
  const size = dist(hand[0], hand[9]);
  if (size < 1e-3) return false;
  const thumbUp = hand[4].y < hand[3].y && hand[3].y < hand[2].y && hand[5].y - hand[4].y > 0.35 * size;
  const curled = [[8, 5], [12, 9], [16, 13], [20, 17]].every(([tip, base]) => dist(hand[tip], hand[base]) < 0.6 * size);
  return thumbUp && curled;
}

/** Fires once when a condition (e.g. both thumbs up) stays true for `holdMs`; progress is 0..1 while holding. */
export class HoldGesture {
  constructor(holdMs = 1000) {
    this.holdMs = holdMs;
    this.since = null;
    this.fired = false;
  }

  update(active, now) {
    if (!active) {
      this.since = null;
      this.fired = false;
      return { progress: 0, fired: false };
    }
    this.since ??= now;
    const progress = Math.min(1, (now - this.since) / this.holdMs);
    const fired = progress >= 1 && !this.fired;
    if (fired) this.fired = true;
    return { progress, fired };
  }
}

/** True when a pose wrist is raised into signing space (in view, above the lower chest). */
export function armsRaised(pose) {
  if (!pose?.[11] || !pose?.[12]) return false;
  const shoulderY = (pose[11].y + pose[12].y) / 2;
  const width = Math.abs(pose[11].x - pose[12].x);
  return [15, 16].some((i) => {
    const w = pose[i];
    return w && (w.visibility ?? 1) > 0.5 && w.y < Math.min(0.95, shoulderY + 1.3 * width);
  });
}

/** Open hand: all four fingers stretched out away from their knuckles. */
export function isOpenPalm(hand) {
  if (!hand || hand.length < 21) return false;
  const size = dist(hand[0], hand[9]);
  if (size < 1e-3) return false;
  const fingersOut = [[8, 5], [12, 9], [16, 13], [20, 17]].every(([tip, base]) => dist(hand[tip], hand[base]) > 0.7 * size);
  const thumbOut = dist(hand[4], hand[5]) > 0.5 * size;
  return fingersOut && thumbOut;
}

/**
 * "Say it" gesture: both hands open (✋✋) and held still. The stillness check keeps a
 * moving two-handed sign such as ขอบคุณ from triggering it.
 */
export class PalmsStillGesture {
  constructor(holdMs = 1000, maxMove = 0.05) {
    this.hold = new HoldGesture(holdMs);
    this.maxMove = maxMove;
    this.anchor = null;
  }

  update(hands, now) {
    const open = hands?.length === 2 && hands.every(isOpenPalm);
    let still = false;
    if (open) {
      const wrists = hands.map((h) => h[0]).sort((a, b) => a.x - b.x);
      still = Boolean(this.anchor) && wrists.every((w, i) => dist(w, this.anchor[i]) < this.maxMove);
      if (!still) this.anchor = wrists;
    } else {
      this.anchor = null;
    }
    return this.hold.update(open && still, now);
  }
}

/** A wrist raised above the head (pose 0 = nose; "above" = higher than nose by 0.6 shoulder widths). */
export function handAboveHead(pose) {
  if (!pose?.[0] || !pose?.[11] || !pose?.[12]) return false;
  const width = Math.abs(pose[11].x - pose[12].x);
  const line = pose[0].y - 0.6 * width;
  return [15, 16].some((i) => pose[i] && (pose[i].visibility ?? 1) > 0.3 && pose[i].y < line);
}

const fingerOut = (hand, tip, base, size) => dist(hand[tip], hand[base]) > 0.7 * size;
const fingerIn = (hand, tip, base, size) => dist(hand[tip], hand[base]) < 0.55 * size;

/** 'v' = index + middle up, ring + pinky down (✌️); 'fold' = all four fingers curled; null = anything else. */
export function twoFingerState(hand) {
  if (!hand || hand.length < 21) return null;
  const size = dist(hand[0], hand[9]);
  if (size < 1e-3) return null;
  const restDown = fingerIn(hand, 16, 13, size) && fingerIn(hand, 20, 17, size);
  if (!restDown) return null;
  if (fingerOut(hand, 8, 5, size) && fingerOut(hand, 12, 9, size)) return 'v';
  if (fingerIn(hand, 8, 5, size) && fingerIn(hand, 12, 9, size)) return 'fold';
  return null;
}

/**
 * Delete gesture: show ✌️ and fold the two fingers down twice (✌️→✊→✌️→✊) within `windowMs`.
 * progress = folds so far / 2, so the HUD can show it filling up.
 */
export class FoldTwiceGesture {
  constructor(windowMs = 2500) {
    this.windowMs = windowMs;
    this.reset();
  }

  reset() {
    this.last = null;
    this.folds = 0;
    this.startedAt = 0;
  }

  update(hands, now) {
    const states = (hands || []).map(twoFingerState);
    const state = states.includes('v') ? 'v' : states.includes('fold') ? 'fold' : null;
    if (this.folds && now - this.startedAt > this.windowMs) this.reset();
    if (state === 'fold' && this.last === 'v') {
      if (!this.folds) this.startedAt = now;  // the window runs from the first fold, however long ✌️ was shown
      this.folds += 1;
    }
    if (state) this.last = state;
    if (this.folds >= 2) {
      this.reset();
      return { progress: 1, fired: true };
    }
    return { progress: this.folds / 2, fired: false };
  }
}

/**
 * Is the person facing the camera? Uses the pose head points (0 nose, 2/5 eyes, 7/8 ears):
 * both eyes visible and the nose roughly centred between the ears (small head turn).
 */
export function facingCamera(pose) {
  const [nose, le, re, lear, rear] = [pose?.[0], pose?.[2], pose?.[5], pose?.[7], pose?.[8]];
  const seen = (p) => p && (p.visibility ?? 1) > 0.5;
  if (!seen(nose) || !seen(le) || !seen(re) || !lear || !rear) return false;
  const span = Math.abs(lear.x - rear.x);
  if (span < 1e-3) return false;
  return Math.abs(nose.x - (lear.x + rear.x) / 2) / span < 0.3;
}

/** Switches on after `onMs` of looking at the camera and off after `offMs` of looking away. */
export class AttentionGate {
  constructor(onMs = 400, offMs = 1500) {
    Object.assign(this, { onMs, offMs, active: false, since: null });
  }

  update(looking, now) {
    if (looking === this.active) this.since = null;
    else {
      this.since ??= now;
      if (now - this.since >= (looking ? this.onMs : this.offMs)) { this.active = looking; this.since = null; }
    }
    return this.active;
  }
}
