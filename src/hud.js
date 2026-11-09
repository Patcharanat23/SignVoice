import { icon } from './icons.js';
// Heads-up display drawn over the camera: recognised words, the current sign with its
// confidence, the detected expression, the spoken sentence and the active pipeline stage.

export const EMOTIONS = [
  { key: 'smile', th: 'ดีใจ', color: '#5be08a' },
  { key: 'frown', th: 'เศร้า', color: '#6fa8ff' },
  { key: 'neutral', th: 'ปกติ', color: '#b9c4c0' },
  { key: 'angry', th: 'โกรธ', color: '#ff6b6b' },
  { key: 'raised brows', th: 'สงสัย / คำถาม', color: '#ffc94d' }
];
export const emotionLabel = (key) => EMOTIONS.find((e) => e.key === key)?.th || key;

const $ = (id) => document.getElementById(id);

export function createHud() {
  const tokens = $('hud-tokens');
  const sentence = $('hud-sentence');
  const sentenceText = $('hud-sentence-text');
  const sign = $('hud-sign');
  const emotions = $('hud-emotions');
  const attention = $('hud-attention');
  let attentive = null;
  const steps = [...document.querySelectorAll('#pipeline [data-step]')];
  const signWord = sign.querySelector('strong');
  const signBar = sign.querySelector('i');
  const signNote = sign.querySelector('small');
  let stepTimer;
  let resultUntil = 0;          // keep a translation on screen at least this long
  let emotionShown = null, emotionCandidate = null, emotionSince = 0;
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

  emotions?.replaceChildren(...EMOTIONS.map((e) => {
    const row = document.createElement('div');
    row.dataset.key = e.key;
    row.innerHTML = `<i style="background:${e.color}"></i><span>${e.th}</span>`;
    return row;
  }));

  return {
    setAttention(on) {
      if (on === attentive || !attention) return;
      attentive = on;
      attention.classList.toggle('on', on);
      attention.innerHTML = `${icon('eye')}<span>${on ? 'เห็นคุณแล้ว' : 'มองกล้องเพื่อเริ่ม'}</span>`;
    },
    setTokens(words) {
      tokens.replaceChildren(...words.slice(-8).map((w) => {
        const chip = document.createElement('span');
        chip.textContent = w;
        return chip;
      }));
    },
    // Switch the highlighted expression only after it has been stable for 400 ms (no flicker).
    setEmotion(key) {
      const now = performance.now();
      if (key !== emotionCandidate) { emotionCandidate = key; emotionSince = now; }
      if (key === emotionShown || now - emotionSince < 400) return;
      emotionShown = key;
      if (!emotions) return;
      for (const row of emotions.children) row.classList.toggle('on', row.dataset.key === key);
    },
    // kind 'result' = a translation (held >= 1.5 s); 'progress' = live reading, never overrides a fresh result.
    showSign(word, prob, note, kind = 'result') {
      const now = performance.now();
      if (kind === 'progress' && now < resultUntil) return;
      if (kind === 'result') resultUntil = now + 1500;
      sign.classList.remove('hidden', 'idle');
      setText(signWord, word);
      setText(signNote, note);
      signBar.style.width = `${Math.round((prob ?? 0) * 100)}%`;
    },
    hideSign() {
      sign.classList.add('idle');
      setText(signWord, '—');
      setText(signNote, 'รอท่าถัดไป');
      signBar.style.width = '0%';
    },
    setSentence(text, speaking = false) {
      sentence.classList.toggle('hidden', !text);
      sentence.classList.toggle('speaking', speaking);
      sentenceText.textContent = text || '';
    },
    // Highlight one pipeline stage; it fades back to idle unless refreshed.
    setStep(step, holdMs = 1200) {
      for (const s of steps) s.classList.toggle('on', s.dataset.step === step);
      clearTimeout(stepTimer);
      if (holdMs) stepTimer = setTimeout(() => steps.forEach((s) => s.classList.remove('on')), holdMs);
    }
  };
}

/** Face box + expression tag on the (CSS-mirrored) overlay canvas; text is flipped back to read normally. */
let faceBox = null;  // eased box: the face model runs every 3rd frame, so glide between its updates

export function drawFaceBox(ctx, landmarks, label, width, height) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const target = [minX * width, minY * height, (maxX - minX) * width, (maxY - minY) * height];
  faceBox = faceBox ? faceBox.map((v, i) => v + 0.35 * (target[i] - v)) : target;
  const [x, y, w, h] = faceBox;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.font = '600 15px "Segoe UI", Tahoma, sans-serif';
  const pad = 6, tw = ctx.measureText(label).width + pad * 2;
  // Canvas is mirrored by CSS: draw the tag at the box's visual top-right, un-mirrored.
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillRect(-tw, -24, tw, 22);
  ctx.fillStyle = '#18231c';
  ctx.fillText(label, -tw + pad, -8);
  ctx.restore();
}

/**
 * Display-only smoothing of landmark jitter. Moves part-way to the new position each frame,
 * but follows fast motion almost directly so the skeleton does not lag behind the hand.
 * The raw points still go to the sign model.
 */
export class PointSmoother {
  constructor() { this.prev = new Map(); }

  smooth(key, points) {
    if (!points?.length) { this.prev.delete(key); return points; }
    const prev = this.prev.get(key);
    if (!prev || prev.length !== points.length) {
      this.prev.set(key, points.map((p) => ({ ...p })));
      return points;
    }
    let move = 0;
    for (let i = 0; i < points.length; i++) move += Math.hypot(points[i].x - prev[i].x, points[i].y - prev[i].y);
    const alpha = Math.min(1, 0.35 + (move / points.length) * 12);
    const out = points.map((p, i) => ({ ...p, x: prev[i].x + alpha * (p.x - prev[i].x), y: prev[i].y + alpha * (p.y - prev[i].y) }));
    this.prev.set(key, out);
    return out;
  }
}
