import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { armsRaised, AttentionGate, facingCamera, FoldTwiceGesture, twoFingerState, handAboveHead, HoldGesture, isOpenPalm, isThumbsUp, packFrame, PalmsStillGesture, SignSegmenter, wordForLabel, POINTS } from './signs.js';

const hand = (x, y) => Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
const pose = () => {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  p[15] = { x: 0.7, y: 0.6, z: 0 }; // signer's left wrist (image right)
  p[16] = { x: 0.3, y: 0.6, z: 0 }; // signer's right wrist
  return p;
};

test('frames use the 543-point layout with NaN for missing parts', () => {
  const { frame, hands } = packFrame({ poseLandmarks: [pose()], rightHandLandmarks: [hand(0.3, 0.6)] });
  assert.equal(frame.length, POINTS * 3);
  assert.equal(hands, 1);
  assert.ok(Number.isNaN(frame[0]));            // no face
  assert.ok(Number.isNaN(frame[468 * 3]));      // no left hand
  assert.equal(frame[522 * 3], Math.fround(0.3));          // right hand starts at 522
});

test('a hand labelled on the wrong side is reassigned by the nearest pose wrist', () => {
  const { frame } = packFrame({ poseLandmarks: [pose()], leftHandLandmarks: [hand(0.31, 0.6)] });
  assert.ok(Number.isNaN(frame[468 * 3]));
  assert.equal(frame[522 * 3], Math.fround(0.31));
});

test('one clip is emitted after the hands leave view', () => {
  const seg = new SignSegmenter({ endGapMs: 300, minFrames: 3 });
  const f = new Float32Array(POINTS * 3).fill(NaN);
  const withHand = f.slice(); withHand[522 * 3] = 0.4;
  const clips = [];
  let t = 0;
  for (let i = 0; i < 3; i++) seg.update(f, 0, (t += 50));
  for (let i = 0; i < 8; i++) seg.update(withHand, 1, (t += 50));
  for (let i = 0; i < 10; i++) { const c = seg.update(f, 0, (t += 50)); if (c) clips.push(c); }
  assert.equal(clips.length, 1);
  assert.ok(clips[0].length >= 8);
});

test('a brief flicker of a hand is ignored', () => {
  const seg = new SignSegmenter({ endGapMs: 200, minFrames: 4 });
  const f = new Float32Array(POINTS * 3).fill(NaN);
  const withHand = f.slice(); withHand[468 * 3] = 0.4;
  let t = 0, clips = 0;
  seg.update(withHand, 1, (t += 50));
  for (let i = 0; i < 8; i++) if (seg.update(f, 0, (t += 50))) clips++;
  assert.equal(clips, 0);
});

test('TSL labels map to Thai words and the null class to nothing', () => {
  assert.equal(wordForLabel('สวัสดี_อายุเท่ากันหรือน้อยกว่า', 'tsl'), 'สวัสดี');
  assert.equal(wordForLabel('แม่_var_1', 'tsl'), 'แม่');
  assert.equal(wordForLabel('null_act', 'tsl'), null);
  assert.equal(wordForLabel('airplane', 'asl'), 'airplane');
});

const thumbsUpHand = () => {
  const h = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }));
  h[0] = { x: 0.5, y: 0.7 };                                  // wrist
  h[9] = { x: 0.5, y: 0.6 };                                  // middle MCP -> hand size 0.1
  for (const [tip, base] of [[8, 5], [12, 9], [16, 13], [20, 17]]) { h[base] = { x: 0.5, y: 0.6 }; h[tip] = { x: 0.52, y: 0.62 }; }
  h[2] = { x: 0.45, y: 0.6 }; h[3] = { x: 0.45, y: 0.55 }; h[4] = { x: 0.45, y: 0.5 };
  return h;
};

test('a fist with the thumb raised is a thumbs-up; an open hand is not', () => {
  assert.equal(isThumbsUp(thumbsUpHand()), true);
  const open = thumbsUpHand();
  open[8] = { x: 0.5, y: 0.45 };                               // index finger extended
  assert.equal(isThumbsUp(open), false);
});

test('the done gesture fires once after being held, and resets when released', () => {
  const hold = new HoldGesture(1000);
  assert.equal(hold.update(true, 0).fired, false);
  assert.equal(hold.update(true, 999).fired, false);
  assert.equal(hold.update(true, 1000).fired, true);
  assert.equal(hold.update(true, 1500).fired, false);
  hold.update(false, 1600);
  hold.update(true, 1700);
  assert.equal(hold.update(true, 2700).fired, true);
});

test('a hand-tracking drop-out mid-sign is bridged while the arms stay up', () => {
  const seg = new SignSegmenter({ endGapMs: 300, bridgeMs: 1000, minFrames: 3 });
  const f = new Float32Array(POINTS * 3).fill(NaN);
  const withHand = f.slice(); withHand[522 * 3] = 0.4;
  let t = 0;
  for (let i = 0; i < 5; i++) seg.update(withHand, 1, (t += 50));
  // hands lost for 600 ms but wrists still raised: the sign must not be cut
  for (let i = 0; i < 12; i++) assert.equal(seg.update(f, 0, (t += 50), true), null);
  for (let i = 0; i < 5; i++) seg.update(withHand, 1, (t += 50));
  // arms lowered: ends after the normal short gap
  let clip = null;
  for (let i = 0; i < 8 && !clip; i++) clip = seg.update(f, 0, (t += 50), false);
  assert.ok(clip && clip.length >= 22);
});

test('raised wrists are detected from the pose', () => {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.9, visibility: 0.9 }));
  pose[11] = { x: 0.6, y: 0.5 }; pose[12] = { x: 0.4, y: 0.5 };
  pose[15] = { x: 0.6, y: 0.99, visibility: 0.2 }; pose[16] = { x: 0.4, y: 0.99, visibility: 0.2 };
  assert.equal(armsRaised(pose), false);
  pose[16] = { x: 0.45, y: 0.55, visibility: 0.9 };
  assert.equal(armsRaised(pose), true);
});

const openHand = (cx) => {
  const h = Array.from({ length: 21 }, () => ({ x: cx, y: 0.6 }));
  h[0] = { x: cx, y: 0.7 }; h[9] = { x: cx, y: 0.6 };          // size 0.1
  [[8, 5], [12, 9], [16, 13], [20, 17]].forEach(([tip, base], k) => { h[base] = { x: cx - 0.03 + k * 0.02, y: 0.6 }; h[tip] = { x: cx - 0.03 + k * 0.02, y: 0.5 }; });
  h[4] = { x: cx - 0.09, y: 0.62 };
  return h;
};

test('two open palms held still fire once; moving them (like ขอบคุณ) does not', () => {
  const g = new PalmsStillGesture(1000, 0.05);
  let fired = 0;
  for (let t = 0; t <= 1300; t += 100) if (g.update([openHand(0.3), openHand(0.7)], t).fired) fired++;
  assert.equal(fired, 1);
  const moving = new PalmsStillGesture(1000, 0.05);
  fired = 0;
  for (let t = 0, k = 0; t <= 2000; t += 100, k++) if (moving.update([openHand(0.3 + k * 0.03), openHand(0.7 - k * 0.03)], t).fired) fired++;
  assert.equal(fired, 0);
  assert.equal(isOpenPalm(thumbsUpHand()), false);
});

test('a wrist above the head is detected; one at face level is not', () => {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.8, visibility: 0.9 }));
  pose[0] = { x: 0.5, y: 0.35 }; pose[11] = { x: 0.6, y: 0.55 }; pose[12] = { x: 0.4, y: 0.55 };
  pose[15] = { x: 0.62, y: 0.36, visibility: 0.9 };            // hand by the face (signing)
  assert.equal(handAboveHead(pose), false);
  pose[16] = { x: 0.35, y: 0.18, visibility: 0.9 };            // hand raised above the head
  assert.equal(handAboveHead(pose), true);
});

const fingersHand = (indexMiddleUp) => {
  const h = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }));
  h[0] = { x: 0.5, y: 0.7 }; h[9] = { x: 0.5, y: 0.6 };              // hand size 0.1
  for (const [tip, base] of [[8, 5], [12, 9], [16, 13], [20, 17]]) {
    h[base] = { x: 0.5, y: 0.6 };
    const up = indexMiddleUp && (tip === 8 || tip === 12);
    h[tip] = up ? { x: 0.5, y: 0.5 } : { x: 0.51, y: 0.62 };
  }
  return h;
};

test('✌️ folded down twice deletes; folding once or a plain ✌️ does not', () => {
  const v = [fingersHand(true)], fold = [fingersHand(false)];
  assert.equal(twoFingerState(v[0]), 'v');
  assert.equal(twoFingerState(fold[0]), 'fold');
  let g = new FoldTwiceGesture(2500), fired = 0, t = 0;
  for (const hands of [v, v, fold, fold, v, v, fold]) if (g.update(hands, (t += 150)).fired) fired++;
  assert.equal(fired, 1);
  g = new FoldTwiceGesture(2500); fired = 0; t = 0;
  for (const hands of [v, v, v, fold, fold, fold, v, v, v]) if (g.update(hands, (t += 150)).fired) fired++;
  assert.equal(fired, 0);                                               // only one fold
  g = new FoldTwiceGesture(2500); fired = 0; t = 0;
  for (const hands of [v, fold, v]) g.update(hands, (t += 150));
  if (g.update(fold, (t += 3000)).fired) fired++;                       // second fold too late
  assert.equal(fired, 0);
});

test('holding ✌️ for a while before folding still works', () => {
  const v = [fingersHand(true)], fold = [fingersHand(false)];
  const g = new FoldTwiceGesture(2500);
  let t = 0, fired = 0;
  for (let i = 0; i < 30; i++) g.update(v, (t += 150));               // 4.5 s of ✌️
  for (const hands of [fold, v, fold]) if (g.update(hands, (t += 200)).fired) fired++;
  assert.equal(fired, 1);
});

const head = (noseX) => {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  p[0] = { x: noseX, y: 0.3, visibility: 0.9 };
  p[2] = { x: 0.53, y: 0.28, visibility: 0.9 }; p[5] = { x: 0.47, y: 0.28, visibility: 0.9 };
  p[7] = { x: 0.58, y: 0.3, visibility: 0.9 }; p[8] = { x: 0.42, y: 0.3, visibility: 0.9 };
  return p;
};

test('facing the camera vs. turned away', () => {
  assert.equal(facingCamera(head(0.5)), true);
  assert.equal(facingCamera(head(0.575)), false);                      // nose near one ear: head turned
  const away = head(0.5); away[5].visibility = 0.1;                    // one eye hidden
  assert.equal(facingCamera(away), false);
});

test('attention switches on after a short look and survives a brief glance away', () => {
  const g = new AttentionGate(400, 1500);
  assert.equal(g.update(true, 0), false);
  assert.equal(g.update(true, 400), true);
  assert.equal(g.update(false, 500), true);                            // glance away
  assert.equal(g.update(true, 900), true);                             // back before 1.5 s
  assert.equal(g.update(false, 1000), true);
  assert.equal(g.update(false, 2400), true);                           // away 1.4 s: still on
  assert.equal(g.update(false, 2500), false);                          // away 1.5 s: off
});
