// Copies MediaPipe WASM from node_modules and downloads the MediaPipe models into public/.
// These binaries are not committed to git; `npm ci` runs this automatically (postinstall).
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const wasmSrc = 'node_modules/@mediapipe/tasks-vision/wasm';
await mkdir('public/wasm', { recursive: true });
for (const file of await readdir(wasmSrc)) await copyFile(`${wasmSrc}/${file}`, `public/wasm/${file}`);

const base = 'https://storage.googleapis.com/mediapipe-models';
const models = {
  'gesture_recognizer.task': `${base}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`,
  'face_landmarker.task': `${base}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
  'hand_landmarker.task': `${base}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
  'pose_landmarker_lite.task': `${base}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
};
if (!process.argv.includes('--wasm-only')) {
  await mkdir('public/models', { recursive: true });
  for (const [name, url] of Object.entries(models)) {
    const target = `public/models/${name}`;
    if (existsSync(target)) continue;
    console.log(`downloading ${name}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
  }
}
console.log('MediaPipe assets ready in public/');
