// A small, explicit vocabulary for the prototype. These labels are communication
// shortcuts, not a claim that MediaPipe's stock model understands full ASL.
export const SIGNS = {
  Thumb_Up: { word: 'yes', hint: 'ชูนิ้วโป้ง ถือ 0.7 วินาที' },
  Thumb_Down: { word: 'no', hint: 'คว่ำนิ้วโป้ง ถือ 0.7 วินาที' },
  ILoveYou: { word: 'I love you', hint: 'ท่ารักนะ ถือ 0.7 วินาที' },
  Pointing_Up: { word: 'one moment', hint: 'ชูนิ้วชี้ ถือ 0.7 วินาที' }
};

const score = (map, key) => map[key] || 0;

export function faceCue(result) {
  const categories = result?.faceBlendshapes?.[0]?.categories || [];
  const map = Object.fromEntries(categories.map((item) => [item.categoryName, item.score]));
  const smile = (score(map, 'mouthSmileLeft') + score(map, 'mouthSmileRight')) / 2;
  const brow = Math.max(score(map, 'browInnerUp'), score(map, 'browOuterUpLeft'), score(map, 'browOuterUpRight'));
  const frown = (score(map, 'mouthFrownLeft') + score(map, 'mouthFrownRight')) / 2;
  const browDown = (score(map, 'browDownLeft') + score(map, 'browDownRight')) / 2;
  if (brow > 0.43) return { name: 'raised brows', value: brow };
  if (smile > 0.4) return { name: 'smile', value: smile };
  if (browDown > 0.45) return { name: 'angry', value: browDown };
  if (frown > 0.42) return { name: 'frown', value: frown };
  return { name: 'neutral', value: 0 };
}

export class GestureInterpreter {
  constructor() {
    this.label = 'None';
    this.since = 0;
    this.fired = false;
    this.path = [];
    this.lastWaveAt = -Infinity;
    this.lastOpenAt = -Infinity;
    this.waveLatched = false;
    this.waveSide = null;
    this.faceHistory = [];
  }

  reset() {
    this.label = 'None';
    this.since = 0;
    this.fired = false;
    this.path = [];
    this.lastOpenAt = -Infinity;
    this.waveLatched = false;
    this.waveSide = null;
    this.faceHistory = [];
  }

  update(result, now, face = 'neutral') {
    // Read every detected hand; the strongest recognised gesture wins, so a
    // second hand in view no longer hides (or resets) the one being signed.
    const hands = (result?.gestures || []).map((gestures, i) => ({
      category: gestures?.[0],
      landmarks: result?.landmarks?.[i],
      side: result?.handedness?.[i]?.[0]?.categoryName || String(i)
    }));
    const known = hands.filter((h) => h.category && h.category.categoryName !== 'None');
    const best = (known.length ? known : hands).sort((a, b) => (b.category?.score || 0) - (a.category?.score || 0))[0];
    const category = best?.category;
    const label = category?.score >= 0.58 ? category.categoryName : 'None';
    const confidence = category?.score || 0;
    const palm = hands.find((h) => h.category?.categoryName === 'Open_Palm' && h.category.score >= 0.42);
    // Keep following the same hand through brief classifier drop-outs.
    const tracked = palm || hands.find((h) => h.side === this.waveSide);
    const hand = tracked?.landmarks;
    this.faceHistory.push({ name: face, time: now });
    this.faceHistory = this.faceHistory.filter((item) => now - item.time < 1800);
    if (palm) {
      if (palm.side !== this.waveSide) this.path = [];
      this.waveSide = palm.side;
      this.lastOpenAt = now;
    }
    if (label !== this.label) {
      this.label = label;
      this.since = now;
      this.fired = false;
    }

    // A wave can rotate around a nearly stationary wrist, and the stock
    // classifier can momentarily return None while the open palm moves.
    if (hand?.[0] && hand?.[12] && now - this.lastOpenAt < 550) {
      this.path.push({ wrist: hand[0].x, tip: hand[12].x, time: now });
      this.path = this.path.filter((point) => now - point.time < 2600);
      if (!this.waveLatched && now - this.lastWaveAt > 1400 && this.isWaving()) {
        this.fired = true;
        this.waveLatched = true;
        this.lastWaveAt = now;
        this.path = [];
        return { event: 'sign', word: 'hello', face: this.stableFace(now), label: 'Wave', confidence };
      }
    } else if (now - this.lastOpenAt >= 550) {
      this.path = [];
      if (now - this.lastOpenAt >= 850) this.waveLatched = false;
    }

    if (this.fired) return null;
    const held = now - this.since;
    if (label === 'Closed_Fist' && held >= 1300) {
      this.fired = true;
      return { event: 'speak', label, confidence };
    }
    if (label === 'Victory' && held >= 1150) {
      this.fired = true;
      return { event: 'undo', label, confidence };
    }
    if (SIGNS[label] && held >= 700) {
      this.fired = true;
      return { event: 'sign', word: SIGNS[label].word, face: this.stableFace(now), label, confidence };
    }
    return null;
  }

  isWaving() {
    if (this.path.length < 5) return false;
    return ['tip', 'wrist'].some((key) => {
      const xs = this.path.map((point) => point[key]);
      if (Math.max(...xs) - Math.min(...xs) < 0.1) return false;
      let extreme = xs[0];
      let direction = 0;
      let reversals = 0;
      for (const x of xs.slice(1)) {
        const delta = x - extreme;
        if (Math.abs(delta) < 0.045) continue;
        const next = Math.sign(delta);
        if (direction && next !== direction) reversals++;
        direction = next;
        extreme = x;
      }
      // Two direction changes (e.g. right-left-right): one swing in and out of frame is not a wave.
      return reversals >= 2;
    });
  }

  stableFace(now) {
    const counts = new Map();
    for (const item of this.faceHistory) {
      if (now - item.time > 1200 || item.name === 'neutral') continue;
      counts.set(item.name, (counts.get(item.name) || 0) + 1);
    }
    const [name, count] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
    return count >= 2 ? name : 'neutral';
  }
}
