import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { faceCue, GestureInterpreter } from './recognition.js';
import { exposureFor } from './image-processing.js';

const gesture = (name, score = 0.9, x = 0.5) => ({
  gestures: [[{ categoryName: name, score }]],
  landmarks: [[...Array.from({ length: 21 }, () => ({ x }))]]
});

test('held sign fires once until gesture changes', () => {
  const recognizer = new GestureInterpreter();
  assert.equal(recognizer.update(gesture('Thumb_Up'), 0), null);
  assert.equal(recognizer.update(gesture('Thumb_Up'), 699), null);
  assert.equal(recognizer.update(gesture('Thumb_Up'), 700).word, 'yes');
  assert.equal(recognizer.update(gesture('Thumb_Up'), 900), null);
  recognizer.update(gesture('None'), 1000);
  recognizer.update(gesture('Thumb_Up'), 1500);
  assert.equal(recognizer.update(gesture('Thumb_Up'), 2200).word, 'yes');
});

test('closed fist requests speech and victory requests undo', () => {
  const recognizer = new GestureInterpreter();
  recognizer.update(gesture('Closed_Fist'), 0);
  assert.equal(recognizer.update(gesture('Closed_Fist'), 1300).event, 'speak');
  recognizer.update(gesture('Victory'), 1500);
  assert.equal(recognizer.update(gesture('Victory'), 2650).event, 'undo');
});

test('face cue uses visible blendshape scores', () => {
  const data = { faceBlendshapes: [{ categories: [
    { categoryName: 'mouthSmileLeft', score: 0.8 },
    { categoryName: 'mouthSmileRight', score: 0.7 }
  ] }] };
  assert.equal(faceCue(data).name, 'smile');
});

test('open palm moving side to side becomes one wave', () => {
  const recognizer = new GestureInterpreter();
  const positions = [0.5, 0.54, 0.58, 0.62, 0.57, 0.52, 0.47, 0.42, 0.47, 0.52, 0.57, 0.62];
  const events = positions.map((x, index) => recognizer.update(gesture('Open_Palm', 0.9, x), index * 70)).filter(Boolean);
  assert.equal(events.length, 1);
  assert.equal(events[0].word, 'hello');
});

test('wrist rotation, uncertain frames and a smile produce one greeting', () => {
  const recognizer = new GestureInterpreter();
  const tips = [0.45, 0.49, 0.54, 0.61, 0.68, 0.64, 0.58, 0.51, 0.45, 0.51, 0.58, 0.65];
  const events = tips.map((tip, index) => {
    const result = gesture(index % 4 === 2 ? 'None' : 'Open_Palm', index % 4 === 2 ? 0.55 : 0.68, 0.5);
    result.landmarks[0][12].x = tip;
    return recognizer.update(result, index * 110, 'smile');
  }).filter(Boolean);
  assert.equal(events.length, 1);
  assert.equal(events[0].word, 'hello');
  assert.equal(events[0].face, 'smile');
});

test('a nearly still open palm does not add a greeting', () => {
  const recognizer = new GestureInterpreter();
  const events = Array.from({ length: 24 }, (_, index) =>
    recognizer.update(gesture('Open_Palm', 0.7, 0.5 + (index % 3) * 0.007), index * 100)
  ).filter(Boolean);
  assert.equal(events.length, 0);
});

test('low-light enhancement is bounded and leaves normal light alone', () => {
  assert.equal(exposureFor(120).gain, 1);
  assert.equal(exposureFor(45).quality, 'low-light');
  assert.equal(exposureFor(1).gain, 2.2);
});

test('a single swing in and out of frame is not a wave', () => {
  const recognizer = new GestureInterpreter();
  const positions = [0.3, 0.38, 0.46, 0.54, 0.62, 0.55, 0.47, 0.4, 0.33];
  const events = positions.map((x, index) => recognizer.update(gesture('Open_Palm', 0.9, x), index * 80)).filter(Boolean);
  assert.equal(events.length, 0);
});

test('a sign on the second hand is read while the first hand shows nothing', () => {
  const recognizer = new GestureInterpreter();
  const twoHands = {
    gestures: [[{ categoryName: 'None', score: 0.8 }], [{ categoryName: 'Thumb_Up', score: 0.85 }]],
    handedness: [[{ categoryName: 'Left' }], [{ categoryName: 'Right' }]],
    landmarks: [Array.from({ length: 21 }, () => ({ x: 0.3 })), Array.from({ length: 21 }, () => ({ x: 0.7 }))]
  };
  recognizer.update(twoHands, 0);
  assert.equal(recognizer.update(twoHands, 700).word, 'yes');
});

test('lowered brows read as an angry cue', () => {
  const data = { faceBlendshapes: [{ categories: [
    { categoryName: 'browDownLeft', score: 0.6 },
    { categoryName: 'browDownRight', score: 0.55 }
  ] }] };
  assert.equal(faceCue(data).name, 'angry');
});
