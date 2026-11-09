import { DrawingUtils, FaceLandmarker, FilesetResolver, GestureRecognizer, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { faceCue, GestureInterpreter } from './recognition.js';
import { FramePreprocessor } from './image-processing.js';
import { literalSentence, localizedWord, PHRASES } from './language.js';
import { armsRaised, AttentionGate, concatFrames, facingCamera, FoldTwiceGesture, handAboveHead, HoldGesture, packFrame, SignSegmenter, wordForLabel } from './signs.js';
import { createAura } from './aura.js';
import { icon, withIcon } from './icons.js';
import './theme.js';
import { canPickOutput, listOutputs, outputSupported, pickOutput, routeAudio, setVoiceOutput, voiceOutput } from './voice-output.js';
import { createHud, drawFaceBox, emotionLabel, PointSmoother } from './hud.js';
import { initTutorial } from './tutorial.js';

const $ = (id) => document.getElementById(id);
const el = {
  camera: $('camera'), overlay: $('overlay'), cameraButton: $('camera-button'),
  tslSampleButton: $('tsl-sample-button'), teachPanel: $('teach-panel'), teachWord: $('teach-word'),
  teachRecord: $('teach-record'), teachUndo: $('teach-undo'), teachTrain: $('teach-train'), teachStatus: $('teach-status'),
  teachNew: $('teach-new'), teachNewEn: $('teach-new-en'), teachAdd: $('teach-add'),
  teachImport: $('teach-import'), teachImportInput: $('teach-import-input'),
  vocabFilter: $('vocab-filter'), vocabBody: document.querySelector('#vocab-table tbody'), teachLast: $('teach-last'), candidates: $('candidates'), autoCompose: $('auto-compose'),
  videoButton: $('video-button'), videoInput: $('video-input'),
  cameraPill: $('camera-pill'), placeholder: $('camera-placeholder'), visionStatus: $('vision-status'),
  handState: $('hand-state'), fpsState: $('fps-state'), lightState: $('light-state'),
  tokenList: $('token-list'), wordCount: $('word-count'), sentence: $('sentence'),
  languageSelect: $('language-select'),
  modelSelect: $('model-select'), modelStatus: $('model-status'), rewriteButton: $('rewrite-button'),
  speakButton: $('speak-button'), undoButton: $('undo-button'), clearButton: $('clear-button')
};

let gestureModel;
let faceModel;
let handModel;
let poseModel;
let visionDelegate = 'CPU';
let lastTs = 0;
// MediaPipe needs strictly increasing timestamps per model (warm-up runs before camera frames).
const nextTs = (now) => (lastTs = Math.max(now, lastTs + 1));
// Thai Sign Language only (the ASL and basic-gesture modes were removed from the UI).
const mode = 'tsl';
let classifying = false;
let composeTimer;
let composedFor = '';
let composePending = null;
const segmenter = new SignSegmenter();
let stream;
let videoUrl;
let running = false;
let loading = false;
let tokens = [];
let userEdited = false;
let lastFrame = 0;
let frames = 0;
let fpsWindow = performance.now();
let language = 'th';
let speechBusy = false;
let activeAudio;
let activeAudioUrl;
const interpreter = new GestureInterpreter();
const preprocessor = new FramePreprocessor();
const enhanceVision = new URLSearchParams(location.search).get('enhance') !== '0';
const ctx = el.overlay.getContext('2d');
const drawing = new DrawingUtils(ctx);
const hud = createHud();
const aura = createAura(document.getElementById('speak-aura'));
// Signed-in user: everyone can use the speak view; the teach view (shared vocabulary and model) is for admins.
let currentUser = null;
try {
  const me = await fetch('/api/auth/me');
  if (me.status === 401) location.replace('/login.html');
  currentUser = me.ok ? (await me.json()).user : null;
} catch { /* server unreachable: the page still loads */ }
const isAdmin = currentUser?.role === 'admin';
document.body.classList.toggle('is-admin', isAdmin);
document.getElementById('user-name').textContent = currentUser ? currentUser.displayName : '';
document.getElementById('logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.replace('/login.html');
});
const smoother = new PointSmoother();
// Keep the navigation mounted while the speak, teach and admin content changes.
const adminOutlet = document.getElementById('admin-outlet');
const adminSkeleton = adminOutlet.firstElementChild.cloneNode(true);
const viewLinks = [...document.querySelectorAll('.view-switch a[data-view]')];
let activeView;
let speakView = false;
let adminModule;
let adminContentRequest;
let routeVersion = 0;
let contentAnimation;
function animateViewContent(view) {
  contentAnimation?.cancel();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = view === 'admin'
    ? adminOutlet.querySelector('.admin-main, .admin-skeleton')
    : view === 'speak' ? document.querySelector('.camera-panel') : document.querySelector('.page-shell main');
  if (!target?.animate) return;
  contentAnimation = target.animate(
    view === 'speak'
      ? [{ opacity: 0.65 }, { opacity: 1 }]
      : [{ opacity: 0.65, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' }
  );
}
const viewFromUrl = () => {
  const view = new URLSearchParams(location.search).get('view');
  return view === 'speak' || view === 'admin' ? view : 'teach';
};
const viewUrl = (view) => view === 'teach' ? '/' : `/?view=${view}`;
const ensureAdminContent = async () => {
  if (adminOutlet.querySelector('.admin-main')) return;
  if (!adminOutlet.querySelector('.admin-skeleton')) adminOutlet.replaceChildren(adminSkeleton.cloneNode(true));
  adminContentRequest ??= (async () => {
    const response = await fetch('/admin.html');
    if (response.redirected && new URL(response.url).pathname === '/login.html') location.replace('/login.html');
    if (!response.ok || response.redirected) throw new Error('เปิดหน้าแอดมินไม่ได้');
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const content = page.querySelector('.admin-main');
    if (!content) throw new Error('ไม่พบเนื้อหาหน้าแอดมิน');
    adminOutlet.replaceChildren(document.importNode(content, true));
  })();
  try { await adminContentRequest; }
  catch (error) { adminContentRequest = null; throw error; }
};
async function setView(requestedView, { push = false } = {}) {
  const view = requestedView === 'admin' && !isAdmin ? 'speak' : requestedView;
  if (push && view === activeView) return;
  if (push) history.pushState({ view }, '', viewUrl(view));
  else if (requestedView !== view) history.replaceState({ view }, '', viewUrl(view));
  const previousView = activeView;
  activeView = view;
  speakView = view === 'speak';
  document.body.classList.toggle('speak-view', speakView);
  document.body.classList.toggle('admin-view', view === 'admin');
  adminOutlet.hidden = view !== 'admin';
  if (previousView === 'admin' && view !== 'admin') adminModule?.unmountAdmin();
  for (const link of viewLinks) {
    const active = link.dataset.view === view;
    link.classList.toggle('on', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `SignVoice — ${{ speak: 'หน้าพูด', teach: 'สอนท่า', admin: 'แอดมิน' }[view]}`;
  document.getElementById('output-panel').hidden = true;
  document.getElementById('output-button').setAttribute('aria-expanded', 'false');
  initTutorial(view, { isAdmin });
  const version = ++routeVersion;
  if (previousView && previousView !== view) animateViewContent(view);
  if (view === 'admin') {
    stopCamera();
    if (!adminOutlet.querySelector('.admin-main')) adminOutlet.setAttribute('aria-busy', 'true');
    try {
      await ensureAdminContent();
      adminOutlet.removeAttribute('aria-busy');
      if (version !== routeVersion || activeView !== 'admin') return;
      adminModule ??= await import('./admin.js');
      if (version === routeVersion && activeView === 'admin') {
        adminModule.mountAdmin();
        if (previousView && previousView !== view) animateViewContent(view);
      }
    } catch (error) {
      adminOutlet.removeAttribute('aria-busy');
      if (version === routeVersion && activeView === 'admin') adminOutlet.textContent = error.message;
    }
  }
  window.scrollTo(0, 0);
}
for (const link of viewLinks) link.addEventListener('click', (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  void setView(link.dataset.view, { push: true });
});
window.addEventListener('popstate', () => { void setView(viewFromUrl()); });
history.replaceState({ view: viewFromUrl() }, '', location.href);
await setView(viewFromUrl());
// "My sentence is finished: say it" = a hand raised above the head for 1 s (no Thai sign is made up there).
const raiseDone = new HoldGesture(1000);
// "Delete the last word" = show ✌️ and fold the two fingers down twice (within 2.5 s).
const foldUndo = new FoldTwiceGesture(2500);
// Only listen while the person faces the camera, so moving the hands for something else adds nothing.
const attention = new AttentionGate(400, 1500);
let doneSeen = false;

function status(message, error = false) {
  el.visionStatus.textContent = message;
  el.visionStatus.classList.toggle('error', error);
}

function redrawTokens() {
  el.tokenList.replaceChildren();
  if (!tokens.length) {
    const hint = document.createElement('span');
    hint.className = 'empty-hint';
    hint.textContent = 'คำที่อ่านได้จะขึ้นตรงนี้';
    el.tokenList.append(hint);
  } else {
    tokens.forEach((token, index) => {
      const chip = document.createElement('span');
      chip.className = 'token';
      const word = document.createElement('span');
      word.textContent = localizedWord(token.word, language);
      const face = document.createElement('small');
      face.textContent = token.face !== 'neutral' ? `· ${token.face}` : '';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.innerHTML = icon('x');
      remove.setAttribute('aria-label', `ลบคำ ${localizedWord(token.word, language)}`);
      remove.addEventListener('click', () => { tokens.splice(index, 1); userEdited = false; redrawTokens(); scheduleCompose(); });
      chip.append(word, face, remove);
      el.tokenList.append(chip);
    });
  }
  el.wordCount.textContent = `${tokens.length} คำ`;
  hud.setTokens(tokens.map((t) => localizedWord(t.word, language)));
  if (!userEdited) {
    composedFor = '';
    el.sentence.value = literalSentence(tokens, language);
  }
}

function addToken(word, face = 'neutral', source = 'camera') {
  tokens.push({ word, face, source });
  userEdited = false;
  redrawTokens();
  status(`เพิ่มคำว่า “${localizedWord(word, language)}” แล้ว`);
  scheduleCompose();
}

// Let the local LLM turn the sign gloss into a natural sentence once the signer pauses.
const composeKey = () => JSON.stringify([tokens.map((t) => [t.word, t.face]), language, el.modelSelect.value]);
function scheduleCompose() {
  clearTimeout(composeTimer);
  if (!el.autoCompose.checked || !el.modelSelect.value || !tokens.length) return;
  composeTimer = setTimeout(() => {
    const key = composeKey();
    if (userEdited || segmenter.collecting || key === composedFor || composePending?.key === key) return;
    void rewrite();
  }, 1500);
}

function undo() {
  if (!tokens.length) return status('ยังไม่มีคำให้ลบ');
  const last = tokens.pop();
  userEdited = false;
  redrawTokens();
  scheduleCompose();
  status(`ลบคำว่า “${localizedWord(last.word, language)}” แล้ว`);
}

function clear() {
  tokens = [];
  userEdited = false;
  redrawTokens();
  status('ล้างข้อความแล้ว');
}

function drawHolistic(result) {
  drawLandmarks({ landmarks: [...(result.leftHandLandmarks || []), ...(result.rightHandLandmarks || [])] }, result);
  for (const pose of result.poseLandmarks || []) {
    drawing.drawConnectors(pose, PoseLandmarker.POSE_CONNECTIONS.filter((c) => c.start >= 11 && c.end >= 11 && c.start < 25 && c.end < 25), { color: 'rgba(255, 255, 255, 0.45)', lineWidth: 1.5 });
  }
}

// ---- Learn from corrections: every translated clip can become a training sample ----
let lastClip = null;
let lastTokenIndex = -1;
let lastTranslationId = null;
// Record which word the user said was right, for the correction statistics in the database.
const reportCorrection = (label) => lastTranslationId && fetch('/api/user/correct', { method: 'POST', body: JSON.stringify({ id: lastTranslationId, label }) });

function renderCandidates(options) {
  el.candidates.replaceChildren(document.createTextNode('หมายถึงคำไหน? '));
  for (const o of options.slice(0, 3)) {
    if (!o.word) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cand';
    button.innerHTML = icon('check');  // the word itself is added as text (it can be a user-made name)
    button.append(` ${o.word} ${Math.round(o.prob * 100)}%`);
    button.addEventListener('click', () => confirmCandidate(o));
    el.candidates.append(button);
  }
  const hint = document.createElement('small');
  hint.textContent = ' ถ้ายังไม่ตรง เลือกคำในช่องสอนท่าแล้วกด “เก็บท่าที่เพิ่งทำให้คำนี้”';
  el.candidates.append(hint);
}

async function confirmCandidate(option) {
  if (!lastClip) return;
  // Fix the sentence: replace the word that was added, or add it if nothing was confident enough.
  if (lastTokenIndex >= 0 && tokens[lastTokenIndex]) tokens[lastTokenIndex].word = option.word;
  else { addToken(option.word, 'neutral', mode); lastTokenIndex = tokens.length - 1; }
  userEdited = false;
  redrawTokens();
  scheduleCompose();
  reportCorrection(option.label);
  await saveSample(lastClip, option.label);  // admins: straight into the samples; users: a proposal for an admin to approve
  for (const b of el.candidates.querySelectorAll('button')) b.disabled = true;
  lastClip = null;
  el.teachLast.disabled = true;
}

async function classifyClip(frames) {
  classifying = true;
  el.handState.textContent = 'กำลังอ่านท่า...';
  hud.setStep('sign', 0);
  hud.showSign('…', 0, 'กำลังดูท่าที่ทำ', 'progress');
  try {
    const response = await fetch(`/api/sign?lang=${mode}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: concatFrames(frames) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || 'sign model unavailable');
    const options = data.top.map((item) => ({ ...item, word: displayWord(item.label) }));
    for (const o of options) if (o.word && o.en && !PHRASES[o.word]) PHRASES[o.word] = { th: o.word, en: o.en };
    lastClip = frames;
    lastTranslationId = data.id;
    lastTokenIndex = -1;
    el.teachLast.disabled = false;
    renderCandidates(options);
    const best = options[0];
    hud.setStep('sign');
    hud.showSign(best.word ?? '—', best.prob, !best.word ? 'ยังอ่านท่านี้ไม่ได้' : best.prob < 0.35 ? `ยังไม่แน่ใจ ${Math.round(best.prob * 100)}% · ยังไม่เพิ่มคำ` : `${Math.round(best.prob * 100)}% · เพิ่มคำแล้ว`);
    if (!best.word) return status('ยังอ่านท่านี้ไม่ได้ ลองทำอีกครั้งให้มืออยู่ในภาพ');
    if (best.prob < 0.35) return status(`ยังไม่แน่ใจว่าเป็นคำไหน (${Math.round(best.prob * 100)}%) เลือกคำที่ตรงจากด้านล่างได้`);
    addToken(best.word, interpreter.stableFace(performance.now()), mode);
    lastTokenIndex = tokens.length - 1;
  } catch (error) {
    status(`แปลท่าไม่สำเร็จ: ${error.message}`, true);
  } finally {
    classifying = false;
  }
}

let signFrameCount = 0;
let lastFaceResult = { faceLandmarks: [], faceBlendshapes: [] };

function signFrame(prepared, now, ts) {
  // Separate hand / pose / face models instead of Holistic: Holistic finds hands only from
  // the pose wrist, so fingers drop out on fast movement, and it is ~2x slower.
  const hands = handModel.detectForVideo(prepared, ts);
  const pose = poseModel.detectForVideo(prepared, ts);
  // Expression is only a cue for the HUD and the LLM (the Thai model has no face input),
  // so the face model runs every 3rd frame to keep hand tracking fast.
  if (faceModel && signFrameCount++ % 3 === 0) {
    lastFaceResult = faceModel.detectForVideo(prepared, ts);
    if (lastFaceResult.faceLandmarks.length) hud.setStep('face', 0);
  }
  const faceResult = lastFaceResult;
  const result = {
    faceLandmarks: faceResult.faceLandmarks,
    poseLandmarks: pose.landmarks,
    // packFrame re-assigns left/right using the pose wrists.
    leftHandLandmarks: hands.landmarks.slice(0, 1),
    rightHandLandmarks: hands.landmarks.slice(1, 2)
  };
  const face = faceCue(faceResult);
  hud.setEmotion(faceResult.faceLandmarks.length ? face.name : null);
  interpreter.faceHistory.push({ name: face.name, time: now });
  interpreter.faceHistory = interpreter.faceHistory.filter((item) => now - item.time < 1800);
  const { frame, hands: handCount } = packFrame(result);
  const attentive = attention.update(facingCamera(pose.landmarks[0]), now);
  hud.setAttention(attentive);
  if (!attentive && segmenter.collecting) segmenter.reset();
  const undoGesture = foldUndo.update(attentive ? hands.landmarks : [], now);
  if (undoGesture.progress > 0) {
    doneSeen = true;
    hud.showSign('ลบคำ', undoGesture.progress, undoGesture.fired ? 'ลบคำล่าสุดแล้ว' : 'พับสองนิ้วลงอีกครั้งเพื่อลบ', 'progress');
  }
  if (undoGesture.fired) {
    segmenter.reset();
    undo();
  }
  const done = raiseDone.update(attentive && handAboveHead(pose.landmarks[0]), now);
  if (done.progress > 0) {
    doneSeen = true;
    hud.showSign('พูด', done.progress, done.fired ? 'กำลังพูด…' : 'ค้างไว้เพื่อพูดประโยค', 'progress');
  }
  if (done.fired) {
    segmenter.reset();
    speakNow();
  }
  const clip = !attentive || done.progress > 0 || undoGesture.progress > 0 ? null : segmenter.update(frame, handCount, now, armsRaised(pose.landmarks[0]));
  if (!classifying) el.handState.textContent = segmenter.collecting ? 'กำลังจับท่า' : handCount ? `พบมือ ${handCount} ข้าง` : 'ไม่พบมือ';
  if (segmenter.collecting && !classifying && !done.progress && !undoGesture.progress) {
    hud.showSign('…', Math.min(1, segmenter.frames.length / 30), recordingLabel ? 'กำลังบันทึกท่าเพื่อสอน' : 'กำลังอ่านท่า · ลดมือลงเมื่อจบคำ', 'progress');
    hud.setStep('hand');
  }
  if (!handCount && !segmenter.collecting && !done.progress && !undoGesture.progress) doneSeen = false;
  if (clip && doneSeen) doneSeen = false; // the hands that made the say-it gesture are not a word
  else if (clip) {
    clearTimeout(composeTimer);
    if (recordingLabel) saveSample(clip);
    else classifyClip(clip);
  }
  // Smoothed copies for drawing only; the model above used the raw points.
  const shown = hands.landmarks.map((h, i) => smoother.smooth(hands.handedness?.[i]?.[0]?.categoryName || i, h));
  drawHolistic({ ...result, leftHandLandmarks: shown.slice(0, 1), rightHandLandmarks: shown.slice(1, 2),
    poseLandmarks: pose.landmarks.map((p) => smoother.smooth('pose', p)) });
  if (faceResult.faceLandmarks[0]) drawFaceBox(ctx, faceResult.faceLandmarks[0], emotionLabel(face.name), el.overlay.width, el.overlay.height);
  return face;
}

function drawLandmarks(gestureResult, faceResult) {
  if (el.overlay.width !== el.camera.videoWidth || el.overlay.height !== el.camera.videoHeight) {
    el.overlay.width = el.camera.videoWidth;
    el.overlay.height = el.camera.videoHeight;
  }
  ctx.clearRect(0, 0, el.overlay.width, el.overlay.height);
  for (const hand of gestureResult.landmarks || []) {
    ctx.save();
    ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
    ctx.shadowBlur = 10;
    drawing.drawConnectors(hand, GestureRecognizer.HAND_CONNECTIONS, { color: 'rgba(255, 255, 255, 0.85)', lineWidth: 2 });
    drawing.drawLandmarks(hand, { color: 'rgba(255, 255, 255, 0.95)', fillColor: 'rgba(255, 255, 255, 0.95)', radius: 2 });
    ctx.restore();
  }
  if (mode === 'basic') {
    for (const face of faceResult.faceLandmarks || []) {
      drawing.drawConnectors(face, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: '#8fe0d3', lineWidth: 2 });
    }
  }
}

function consume(event) {
  if (!event) return;
  if (event.event === 'sign') addToken(event.word, event.face);
  if (event.event === 'undo') undo();
  if (event.event === 'speak') finalizeAndSpeak();
}

function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  // Sign mode samples up to ~30 FPS so fast movements are not missed; basic mode keeps ~10 FPS.
  if (el.camera.readyState < 2 || now - lastFrame < (mode === 'basic' ? 95 : 30)) return;
  lastFrame = now;
  const ts = nextTs(now);
  try {
    const prepared = enhanceVision ? preprocessor.process(el.camera, now) : el.camera;
    let face;
    if (mode === 'basic') {
      const gestureResult = gestureModel.recognizeForVideo(prepared, ts);
      const faceResult = faceModel.detectForVideo(prepared, ts);
      face = faceCue(faceResult);
      const top = (gestureResult.gestures || []).map((g) => g[0]).filter((g) => g && g.categoryName !== 'None').sort((a, b) => b.score - a.score)[0];
      el.handState.textContent = top ? `${top.categoryName} ${Math.round(top.score * 100)}%` : 'ไม่พบท่า';
      drawLandmarks(gestureResult, faceResult);
      consume(interpreter.update(gestureResult, now, face.name));
    } else {
      face = signFrame(prepared, now, ts);
    }
    el.lightState.textContent = !enhanceVision ? 'ปิดการปรับภาพ' : preprocessor.exposure.quality === 'normal' ? 'ปกติ' :
      preprocessor.exposure.quality === 'very-dark' ? `มืดมาก · เพิ่มแสง ${preprocessor.exposure.gain.toFixed(1)}×` :
        `แสงน้อย · เพิ่มแสง ${preprocessor.exposure.gain.toFixed(1)}×`;
    frames++;
    if (now - fpsWindow > 1000) {
      el.fpsState.textContent = `${Math.round(frames * 1000 / (now - fpsWindow))} FPS${mode === 'basic' ? '' : ' · ' + visionDelegate}`;
      fpsWindow = now;
      frames = 0;
    }
  } catch (error) {
    status(`ประมวลผลภาพไม่สำเร็จ: ${error.message}`, true);
    stopCamera();
  }
}

// The first GPU inferences compile shaders and can take seconds each; do that now on a
// sample frame with a hand in it, so the camera starts at full speed. If the GPU is still
// slow afterwards (e.g. Chrome is on the integrated GPU), fall back to CPU.
async function gpuIsFast() {
  status('กำลังเตรียมกล้อง ครั้งแรกอาจใช้เวลาประมาณ 10–20 วินาที...');
  const sample = document.createElement('video');
  sample.muted = true;
  sample.src = '/samples/tsl-sawasdee.mp4';
  await new Promise((resolve, reject) => { sample.onloadeddata = resolve; sample.onerror = reject; });
  sample.currentTime = 1.5;
  await new Promise((resolve) => { sample.onseeked = resolve; });
  const times = [];
  const started = performance.now();
  while (performance.now() - started < 30000 && times.length < 40) {
    const t0 = performance.now();
    handModel.detectForVideo(sample, nextTs(t0));
    poseModel.detectForVideo(sample, nextTs(performance.now()));
    times.push(performance.now() - t0);
    if (times.length >= 3 && times.slice(-3).every((t) => t < 60)) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const recent = times.slice(-3).reduce((a, b) => a + b, 0) / Math.min(times.length, 3);
  console.info(`GPU warm-up: ${times.length} runs, last ${recent.toFixed(1)} ms`);
  return recent < 120;
}

async function loadVision() {
  const fileset = await FilesetResolver.forVisionTasks('/wasm');
  // Thai mode does not use the face at all (the sign model has no face input), so it is not loaded.
  if (!faceModel && mode !== 'tsl') faceModel = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'CPU' },
    runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true
  });
  if (mode !== 'basic') {
    if (handModel && poseModel) return;
    status('กำลังเตรียมการอ่านมือ ท่าทาง และสีหน้า...');
    // GPU (WebGL) first; ?vision=cpu or a failed GPU init falls back to CPU.
    const wantCpu = new URLSearchParams(location.search).get('vision') === 'cpu';
    for (const delegate of wantCpu ? ['CPU'] : ['GPU', 'CPU']) {
      try {
        handModel = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate },
          runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4
        });
        poseModel = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate },
          runningMode: 'VIDEO', numPoses: 1
        });
        visionDelegate = delegate;
        if (delegate === 'CPU' || await gpuIsFast()) return;
        handModel.close(); poseModel.close();
      } catch (error) {
        if (delegate === 'CPU') throw error;
      }
    }
  }
  if (gestureModel) return;
  status('กำลังเตรียมการอ่านมือและสีหน้า...');
  gestureModel = await GestureRecognizer.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/gesture_recognizer.task', delegate: 'CPU' },
    runningMode: 'VIDEO', numHands: 2
  });
}

// Windows lets one page hold a webcam at a time, and the page we just left may still be
// releasing it: retry a few times instead of failing on the first "device in use".
async function openCamera() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 960, height: 600 }, audio: false });
    } catch (error) {
      if (error.name !== 'NotReadableError' || attempt >= 4) throw error;
      status('กล้องยังถูกใช้อยู่ กำลังลองเปิดใหม่...');
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
}

// Leaving the page (menu link, back/forward): give the camera back right away so the next
// page can open it, and never come back from the back/forward cache with a dead stream.
window.addEventListener('pagehide', () => stopCamera());
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });

async function startCamera() {
  if (loading || running) return;
  loading = true;
  el.cameraButton.disabled = true;
  try {
    stopCamera();
    await loadVision();
    status('กำลังขออนุญาตเปิดกล้อง...');
    stream = await openCamera();
    el.camera.srcObject = stream;
    await el.camera.play();
    running = true;
    interpreter.reset();
    segmenter.reset();
    el.placeholder.classList.add('hidden');
    el.cameraPill.textContent = 'กล้องกำลังทำงาน';
    document.body.classList.add('camera-on');
    document.getElementById('speak-stop').hidden = false;
    el.cameraPill.classList.add('active');
    el.cameraButton.innerHTML = withIcon('camera-off', 'ปิดกล้อง');
    status('กล้องพร้อมแล้ว ลองทำท่าทีละคำและลดมือลงเมื่อจบคำ');
    requestAnimationFrame(frame);
  } catch (error) {
    status(`เปิดกล้องไม่ได้: ${error.message}. ตรวจสิทธิ์กล้องหรือใช้โหมดทดลอง`, true);
  } finally {
    loading = false;
    el.cameraButton.disabled = false;
  }
}

async function startVideo(file) {
  if (loading || !file) return;
  if (!['video/mp4', 'video/webm'].includes(file.type)) return status('ใช้วิดีโอ MP4 หรือ WebM', true);
  if (file.size > 100_000_000) return status('วิดีโอต้องเล็กกว่า 100 MB', true);
  loading = true;
  el.videoButton.disabled = true;
  try {
    stopCamera();
    await loadVision();
    videoUrl = URL.createObjectURL(file);
    el.camera.src = videoUrl;
    // Slower playback gives the landmark models more frames per sign (matters most on CPU).
    el.camera.playbackRate = mode === 'basic' ? 0.6 : 0.75;
    el.camera.onended = () => {
      running = false;
      // Hands may still be up on the last frame: close the clip so it is still translated.
      const clip = segmenter.update(new Float32Array(543 * 3).fill(NaN), 0, Infinity);
      if (clip && mode !== 'basic') classifyClip(clip);
      el.cameraPill.textContent = 'วิดีโอจบ';
      el.cameraButton.innerHTML = withIcon('camera', 'เปิดกล้อง');
      status('วิดีโอจบแล้ว ลองตรวจคำและข้อความที่ได้');
    };
    await el.camera.play();
    running = true;
    interpreter.reset();
    segmenter.reset();
    el.placeholder.classList.add('hidden');
    el.cameraPill.textContent = 'วิดีโอ: ' + file.name;
    el.cameraPill.classList.add('active');
    el.cameraButton.innerHTML = withIcon('x', 'หยุดวิดีโอ');
    status(`กำลังอ่านท่าจากวิดีโอ (เล่นที่ความเร็ว ${el.camera.playbackRate}×)`);
    requestAnimationFrame(frame);
  } catch (error) {
    stopCamera();
    status('เปิดวิดีโอไม่ได้: ' + error.message, true);
  } finally {
    loading = false;
    el.videoButton.disabled = false;
  }
}

function stopCamera() {
  running = false;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  el.camera.pause();
  el.camera.onended = null;
  el.camera.srcObject = null;
  el.camera.removeAttribute('src');
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;
  el.camera.load();
  ctx.clearRect(0, 0, el.overlay.width, el.overlay.height);
  el.placeholder.classList.remove('hidden');
  el.cameraPill.textContent = 'ยังไม่เปิดกล้อง';
  document.body.classList.remove('camera-on');
  document.getElementById('speak-stop').hidden = true;
  el.cameraPill.classList.remove('active');
  el.cameraButton.innerHTML = withIcon('camera', 'เปิดกล้อง');
  el.handState.textContent = '—';
  el.fpsState.textContent = '—';
  el.lightState.textContent = '—';
  hud.hideSign();
  hud.setEmotion(null);
}

async function loadModels() {
  try {
    const response = await fetch('/api/models');
    if (!response.ok) throw new Error('Ollama unavailable');
    const { models, available } = await response.json();
    if (!available) throw new Error('Ollama unavailable');
    el.modelSelect.replaceChildren();
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'ใช้ข้อความที่พิมพ์เอง';
    el.modelSelect.append(option);
    for (const model of models) {
      const item = document.createElement('option');
      item.value = model;
      item.textContent = model;
      el.modelSelect.append(item);
    }
    const preferred = models.find((name) => name.includes('qwen3:4b')) || models[0];
    if (preferred) el.modelSelect.value = preferred;
    el.modelStatus.textContent = preferred ? `พร้อมช่วยเรียงประโยค · มีตัวเลือก ${models.length} แบบในเครื่อง` : 'Ollama เปิดอยู่ แต่ยังไม่มีตัวช่วยเรียงประโยคในเครื่อง';
  } catch {
    el.modelSelect.innerHTML = '<option value="">ใช้ข้อความที่พิมพ์เอง</option>';
    el.modelStatus.textContent = 'ยังไม่มีตัวช่วยเรียงประโยค คุณยังตรวจข้อความและกดพูดได้';
  }
}

function rewrite() {
  const text = el.sentence.value.trim();
  if (!text && !tokens.length) return status('เพิ่มคำหรือพิมพ์ข้อความก่อน', true);
  const model = el.modelSelect.value;
  if (!model) return status('ยังไม่มีตัวช่วยเรียงประโยค ใช้ข้อความที่คุณแก้ไว้ได้เลย');
  const key = composeKey();
  if (composePending?.key === key && composePending.text === text) return composePending.promise;
  const requestTokens = tokens.map((token) => ({ ...token }));
  const editedText = userEdited ? text : '';
  const requestLanguage = language;
  const task = (async () => {
    el.rewriteButton.disabled = true;
    status('กำลังช่วยเรียงคำเป็นประโยค...');
    hud.setStep('llm', 0);
    try {
      const response = await fetch('/api/rewrite', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tokens: requestTokens, editedText, model, language: requestLanguage })
      });
      const data = await response.json();
      if (!response.ok || !data.sentence) throw new Error(data.error || 'Empty response');
      // A delayed answer for an earlier sign must never replace newer signs or a manual edit.
      if (composePending?.promise !== task || key !== composeKey() || el.sentence.value.trim() !== text) return null;
      el.sentence.value = data.sentence;
      hud.setSentence(data.sentence);
      hud.setStep('llm', 2500);
      userEdited = true;
      composedFor = key;
      status('เรียงประโยคให้แล้ว ลองอ่านและแก้ให้ตรงใจก่อนพูด');
      return data.sentence;
    } catch (error) {
      if (composePending?.promise === task && key === composeKey())
        status(`ยังช่วยเรียงประโยคไม่ได้ (${error.message}) ใช้ข้อความเดิมได้`, true);
      return null;
    } finally {
      if (composePending?.promise === task) {
        composePending = null;
        el.rewriteButton.disabled = false;
      }
    }
  })();
  composePending = { key, text, promise: task };
  return task;
}

function speakInBrowser(text) {
  if (!('speechSynthesis' in window)) return status('เบราว์เซอร์นี้ไม่มีระบบอ่านออกเสียง', true);
  const localVoice = speechSynthesis.getVoices().find((voice) => voice.localService && voice.lang.startsWith(language));
  if (!localVoice) return status('ยังไม่มีเสียงพูดสำหรับภาษานี้บนเครื่อง ดูวิธีติดตั้งใน README', true);
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === 'th' ? 'th-TH' : 'en-US';
  utterance.rate = 0.9;
  utterance.voice = localVoice;
  utterance.onstart = () => { aura.attach(null); status('กำลังพูดข้อความของคุณ...'); };
  utterance.onend = () => { aura.stop(); status('พูดจบแล้ว'); };
  utterance.onerror = (event) => { aura.stop(); status(`เสียงพูดไม่สำเร็จ: ${event.error}`, true); };
  window.speechSynthesis.speak(utterance);
}

async function speak(text) {
  if (speechBusy) return status('กำลังพูดอยู่ รอให้จบก่อนนะ');
  speechBusy = true;
  el.speakButton.disabled = true;
  try {
    status('กำลังเตรียมเสียงพูด...');
    const response = await fetch('/api/speech', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, language })
    });
    if (!response.ok) throw new Error('Offline voice unavailable');
    activeAudioUrl = URL.createObjectURL(await response.blob());
    const route = await routeAudio(activeAudioUrl);
    activeAudio = route.primary;
    const extraAudio = route.extra;
    const audioUrl = activeAudioUrl;
    activeAudio.onended = () => {
      aura.stop();
      setTimeout(() => { extraAudio?.pause(); URL.revokeObjectURL(audioUrl); }, 1500);  // let the meeting copy finish
      hud.setSentence(text, false);
      if (speakView) { tokens = []; userEdited = false; composedFor = ''; redrawTokens(); }
      activeAudioUrl = null;
      activeAudio = null;
      speechBusy = false;
      el.speakButton.disabled = false;
      status('พูดจบแล้ว');
    };
    activeAudio.onerror = () => {
      aura.stop();
      extraAudio?.pause();
      hud.setSentence(text, false);
      URL.revokeObjectURL(activeAudioUrl);
      activeAudioUrl = null;
      activeAudio = null;
      speechBusy = false;
      el.speakButton.disabled = false;
      status('ไม่สามารถเล่นเสียงได้', true);
    };
    hud.setSentence(text, true);
    hud.setStep('voice', 0);
    await aura.attach(route.analyse ? activeAudio : null);
    extraAudio?.play().catch(() => {});
    await activeAudio.play();
    status(route.failed ? 'ไม่พบอุปกรณ์เสียงที่เลือก จึงพูดผ่านลำโพงแทน' : `กำลังพูด${language === 'th' ? 'ภาษาไทย' : 'ภาษาอังกฤษ'}${extraAudio || !route.analyse ? 'ผ่านไมค์เสมือน' : ''}...`, route.failed);
  } catch {
    aura.stop();
    if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
    activeAudio = null;
    speechBusy = false;
    el.speakButton.disabled = false;
    speakInBrowser(text);
  }
}

async function speakNow() {
  if (!tokens.length && !el.sentence.value.trim()) return status('ยังไม่มีคำให้พูด');
  clearTimeout(composeTimer);
  let stable = true;
  for (let attempt = 0; attempt < 3 && !userEdited && el.modelSelect.value; attempt++) {
    const key = composeKey();
    if (key === composedFor) break;
    await rewrite();
    stable = key === composeKey();
    if (stable) break;
  }
  if (!stable)
    return status('กำลังอ่านท่าใหม่อยู่ รอจบคำแล้วลองพูดอีกครั้ง');
  await finalizeAndSpeak();
}

async function finalizeAndSpeak() {
  const text = el.sentence.value.trim();
  if (!text && !tokens.length) return status('ยังไม่มีข้อความให้พูด', true);
  if (text) speak(text);
}

// ---- Personal calibration ("สอนท่า"): record the user's own signs, then fine-tune ----
let recordingLabel = null;
let teachLabels = [];

// Display names per model label, in both languages (edited in the vocabulary table).
const wordNames = {};
const displayWord = (label) => (label === 'null_act' ? null : wordNames[label]?.th || wordForLabel(label, 'tsl'));
let teachCounts = {};

function setWordName(label, th, en) {
  wordNames[label] = { th, en };
  PHRASES[th] = { th, en: en || th };  // the English sentence/voice uses this
}

function renderVocab() {
  const q = el.vocabFilter.value.trim().toLowerCase();
  const rows = teachLabels.filter((label) => {
    const w = wordNames[label] || {};
    return !q || `${w.th} ${w.en}`.toLowerCase().includes(q);
  });
  el.vocabBody.replaceChildren(...rows.map((label) => {
    const tr = document.createElement('tr');
    const w = wordNames[label] || { th: displayWord(label), en: '' };
    const cell = (value, key) => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.value = value || '';
      input.placeholder = key === 'en' ? '(ยังไม่มี)' : '';
      input.addEventListener('change', async () => {
        const next = { ...wordNames[label], [key]: input.value.trim() };
        if (!next.th) { input.value = wordNames[label].th; return; }
        const response = await fetch('/api/user/words', { method: 'POST', body: JSON.stringify({ label, th: next.th, en: next.en || '' }) });
        if (!response.ok) { el.teachStatus.textContent = 'บันทึกชื่อไม่สำเร็จ'; return; }
        setWordName(label, next.th, next.en || '');
        renderTeachOptions();
        redrawTokens();
        el.teachStatus.textContent = `บันทึกชื่อ “${next.th}” / “${next.en || '-'}” แล้ว`;
      });
      td.append(input);
      return td;
    };
    const count = document.createElement('td');
    count.textContent = teachCounts[label] || 0;
    tr.append(cell(w.th, 'th'), cell(w.en, 'en'), count);
    return tr;
  }));
}

function renderTeachOptions() {
  const current = el.teachWord.value;
  el.teachWord.replaceChildren(...teachLabels.map((label) => {
    const option = document.createElement('option');
    option.value = label;
    const w = wordNames[label] || {};
    option.textContent = `${displayWord(label)}${w.en ? ` (${w.en})` : ''} · ${teachCounts[label] || 0} ครั้ง`;
    return option;
  }));
  if (current && teachLabels.includes(current)) el.teachWord.value = current;
}

function renderTeach(data) {
  teachLabels = data.labels.filter((label) => label !== 'null_act');
  teachCounts = data.counts;
  for (const label of teachLabels) {
    const base = wordForLabel(label, 'tsl');
    const saved = data.words?.[label];
    setWordName(label, saved?.th || base, saved?.en || data.english?.[label] || PHRASES[base]?.en || '');
  }
  renderTeachOptions();
  renderVocab();
  const t = data.training;
  el.teachTrain.disabled = t.running;
  if (t.running) el.teachStatus.textContent = `กำลังฝึกอ่านท่า: ${t.message} (${Math.round(t.progress * 100)}%)`;
  else if (t.error) el.teachStatus.textContent = `ฝึกอ่านท่าไม่สำเร็จ: ${t.error}`;
  else if (data.personal) {
    const r = data.personal;
    const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
    el.teachStatus.textContent = `พร้อมอ่านท่าที่คุณสอนแล้ว (${r.words} คำ, ${r.train_samples} ตัวอย่าง) · ผลทดสอบ ${r.heldout_samples} ครั้ง: ก่อน ${pct(r.heldout_before)} → หลัง ${pct(r.heldout_after)}`;
  }
  return t;
}

async function loadTeach() {
  try {
    const data = await (await fetch('/api/user/samples')).json();
    return renderTeach(data);
  } catch {
    el.teachStatus.textContent = 'ยังบันทึกท่าไม่ได้ บริการสอนท่า (Python) ยังไม่ทำงาน';
  }
}

// Names typed for a new word by a non-admin user travel with their proposals until an admin approves them.
const proposedNames = {};
let proposalsSent = 0;
async function proposeSample(frames, label) {
  const name = proposedNames[label] || {};
  const query = new URLSearchParams({ label, th: name.th || '', en: name.en || '' });
  const response = await fetch(`/api/user/propose?${query}`, { method: 'POST', body: concatFrames(frames) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  proposalsSent++;
  el.teachStatus.textContent = `ส่งท่า “${displayWord(label)}” ให้ผู้ดูแลตรวจแล้ว ตอนนี้มีท่ารอตรวจ ${data.pending} ท่า`;
}

async function saveSample(frames, label = recordingLabel) {
  if (!isAdmin) {
    try { await proposeSample(frames, label); } catch (error) { el.teachStatus.textContent = `ส่งท่าไม่สำเร็จ: ${error.message}`; }
    return;
  }
  try {
    const response = await fetch(`/api/user/sample?label=${encodeURIComponent(label)}`, { method: 'POST', body: concatFrames(frames) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    await loadTeach();
    el.teachStatus.textContent = `บันทึกท่า “${wordForLabel(label, 'tsl')}” แล้ว ${data.counts[label]} ครั้ง เมื่อมีหลายตัวอย่างค่อยกด “ฝึกให้จำท่า”`;
  } catch (error) {
    el.teachStatus.textContent = `บันทึกไม่สำเร็จ: ${error.message}`;
  }
}

// New words the model has never seen: stored as "<word>_user" and added as classes on the next training.
el.vocabFilter.addEventListener('input', renderVocab);

el.teachAdd.addEventListener('click', async () => {
  const word = el.teachNew.value.trim().replace(/\s+/g, ' ');
  const english = el.teachNewEn.value.trim();
  if (!/^[\u0E00-\u0E7FA-Za-z0-9 ]{1,30}$/.test(word)) {
    el.teachStatus.textContent = 'ใช้ได้เฉพาะตัวอักษรไทย/อังกฤษ ตัวเลข และเว้นวรรค ไม่เกิน 30 ตัว';
    return;
  }
  const existing = teachLabels.find((label) => displayWord(label) === word);
  const label = existing || `${word}_user`;
  if (!existing) {
    const option = document.createElement('option');
    option.value = label;
    option.textContent = `${word} · ใหม่ · 0 ครั้ง`;
    el.teachWord.prepend(option);
    teachLabels.unshift(label);
  }
  if (!isAdmin) {  // users cannot rename the shared vocabulary; the name goes with their proposals
    if (!existing) { proposedNames[label] = { th: word, en: english }; setWordName(label, word, english); }
    el.teachWord.value = label;
    el.teachNew.value = '';
    el.teachNewEn.value = '';
    el.teachStatus.textContent = `เลือกคำว่า “${word}” แล้ว กดเริ่มบันทึกและทำท่า 5–10 ครั้ง จากนั้นผู้ดูแลจะช่วยตรวจให้`;
    return;
  }
  if (!existing || english) {
    const th = existing ? displayWord(existing) : word;
    const en = english || wordNames[label]?.en || '';
    await fetch('/api/user/words', { method: 'POST', body: JSON.stringify({ label, th, en }) });
    setWordName(label, th, en);
    renderTeachOptions();
    renderVocab();
  }
  el.teachWord.value = label;
  el.teachNew.value = '';
  el.teachNewEn.value = '';
  el.teachStatus.textContent = existing
    ? `มีคำว่า “${word}” อยู่แล้ว กดเริ่มบันทึกได้เลย`
    : `เพิ่มคำว่า “${word}” แล้ว ลองดูตัวอย่างท่าที่ th-sl.com จากนั้นบันทึกท่า 10–15 ครั้งก่อนกด “ฝึกให้จำท่า”`;
});

// ---- Bulk import: many clips at once, the word comes from the file name ("สวัสดี_01.mp4") ----
function wordFromFileName(name) {
  return name.replace(/\.[^.]+$/, '').split(/[_]/)[0].replace(/[-\s]*\d+$/, '').trim();
}

async function framesFromVideo(file, fps = 15) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  const url = URL.createObjectURL(file);
  try {
    video.src = url;
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('เล่นไฟล์นี้ไม่ได้ (ใช้ MP4 H.264 หรือ WebM)')); });
    const frames = [];
    const step = 1 / fps;
    for (let t = 0; t < video.duration && frames.length < 400; t += step) {
      video.currentTime = t;
      await new Promise((resolve) => { video.onseeked = resolve; });
      const ts = nextTs(performance.now());
      const hands = handModel.detectForVideo(video, ts);
      const pose = poseModel.detectForVideo(video, ts);
      frames.push(packFrame({ poseLandmarks: pose.landmarks, leftHandLandmarks: hands.landmarks.slice(0, 1), rightHandLandmarks: hands.landmarks.slice(1, 2), faceLandmarks: [] }));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function importClips(files) {
  if (!files.length) return;
  stopCamera();  // the landmark models track one video stream at a time
  el.teachImport.disabled = true;
  const done = { ok: 0, skipped: [] };
  try {
    await loadVision();
    for (const [i, file] of files.entries()) {
      const word = wordFromFileName(file.name);
      el.teachStatus.textContent = `นำเข้า ${i + 1}/${files.length}: ${file.name} → “${word}”`;
      if (!/^[\u0E00-\u0E7FA-Za-z0-9 ]{1,30}$/.test(word)) { done.skipped.push(`${file.name} (ชื่อคำไม่ถูกต้อง)`); continue; }
      try {
        const frames = await framesFromVideo(file);
        const withHands = frames.filter((f) => !Number.isNaN(f[468 * 3]) || !Number.isNaN(f[522 * 3])).length;
        if (withHands < 6) { done.skipped.push(`${file.name} (เห็นมือแค่ ${withHands} เฟรม)`); continue; }
        const label = teachLabels.find((l) => displayWord(l) === word) || `${word}_user`;
        await saveSample(frames, label);
        done.ok++;
      } catch (error) {
        done.skipped.push(`${file.name} (${error.message})`);
      }
    }
  } finally {
    el.teachImport.disabled = false;
    await loadTeach();
    el.teachStatus.textContent = `นำเข้าแล้ว ${done.ok}/${files.length} คลิป` +
      (done.skipped.length ? ` · ข้าม ${done.skipped.length}: ${done.skipped.slice(0, 3).join(', ')}${done.skipped.length > 3 ? ' …' : ''}` : '') +
      (done.ok ? ' · กด “ฝึกให้จำท่า” เพื่อใช้ตัวอย่างที่นำเข้า' : '');
  }
}

el.teachImport.addEventListener('click', () => el.teachImportInput.click());
el.teachImportInput.addEventListener('change', () => {
  const files = [...el.teachImportInput.files];
  el.teachImportInput.value = '';
  importClips(files);
});

el.teachLast.addEventListener('click', async () => {
  if (!lastClip) return;
  const label = el.teachWord.value;
  reportCorrection(label);
  await saveSample(lastClip, label);
  if (lastTokenIndex >= 0 && tokens[lastTokenIndex]) { tokens[lastTokenIndex].word = wordForLabel(label, 'tsl'); redrawTokens(); }
  lastClip = null;
  el.teachLast.disabled = true;
});

el.teachRecord.addEventListener('click', () => {
  recordingLabel = recordingLabel ? null : el.teachWord.value;
  el.teachRecord.classList.toggle('recording', Boolean(recordingLabel));
  el.teachRecord.innerHTML = recordingLabel ? withIcon('stop', 'หยุดบันทึก') : withIcon('record', 'เริ่มบันทึก');
  el.teachWord.disabled = Boolean(recordingLabel);
  el.teachStatus.textContent = recordingLabel
    ? `กำลังบันทึก “${wordForLabel(recordingLabel, 'tsl')}”: ทำท่าแล้วลดมือลงพ้นกล้อง ทุกท่าจะถูกเก็บเป็นตัวอย่าง (ไม่แปล)`
    : 'หยุดบันทึกแล้ว';
  if (recordingLabel && !running) status('เปิดกล้องก่อน แล้วทำท่าตามคำที่เลือก');
});
el.teachUndo.addEventListener('click', async () => {
  const label = el.teachWord.value;
  await fetch(`/api/user/undo?label=${encodeURIComponent(label)}`, { method: 'POST' });
  await loadTeach();
  el.teachStatus.textContent = `ลบตัวอย่างล่าสุดของ “${wordForLabel(label, 'tsl')}” แล้ว`;
});
el.teachTrain.addEventListener('click', async () => {
  recordingLabel = null;
  el.teachRecord.classList.remove('recording');
  el.teachRecord.innerHTML = withIcon('record', 'เริ่มบันทึก');
  el.teachWord.disabled = false;
  await fetch('/api/user/finetune', { method: 'POST' });
  const poll = async () => {
    const t = await loadTeach();
    if (t?.running) setTimeout(poll, 1500);
    else if (!t?.error) status('พร้อมอ่านท่าที่คุณสอนแล้ว ลองทำท่าได้เลย');
  };
  poll();
});
loadTeach();

el.cameraButton.addEventListener('click', () => running ? stopCamera() : startCamera());
document.getElementById('speak-start').addEventListener('click', () => startCamera());
document.getElementById('speak-stop').addEventListener('click', () => stopCamera());
async function playSample(button, path, name) {
  button.disabled = true;
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error('ไม่พบไฟล์ตัวอย่าง');
    const blob = await response.blob();
    await startVideo(new File([blob], name, { type: 'video/mp4' }));
  } catch (error) {
    status('เปิดคลิปตัวอย่างไม่ได้: ' + error.message, true);
  } finally {
    button.disabled = false;
  }
}
el.tslSampleButton.addEventListener('click', () => playSample(el.tslSampleButton, '/samples/tsl-sawasdee.mp4', 'tsl-sawasdee.mp4'));
el.videoButton.addEventListener('click', () => el.videoInput.click());
el.videoInput.addEventListener('change', () => {
  const file = el.videoInput.files?.[0];
  el.videoInput.value = '';
  if (file) startVideo(file);
});
el.sentence.addEventListener('input', () => { userEdited = true; });
for (const button of document.querySelectorAll('.try-phrases button')) {
  button.addEventListener('click', () => {
    el.sentence.value = button.dataset[language === 'th' ? 'exampleTh' : 'exampleEn'];
    el.sentence.dispatchEvent(new Event('input', { bubbles: true }));
    hud.setSentence(el.sentence.value);
    el.sentence.focus();
    status('ตรวจข้อความแล้วกด “พูดข้อความนี้” ได้เลย');
  });
}
el.languageSelect.addEventListener('change', () => {
  language = el.languageSelect.value;
  for (const button of document.querySelectorAll('.try-phrases button')) button.textContent = button.dataset[language === 'th' ? 'labelTh' : 'labelEn'];
  userEdited = false;
  redrawTokens();
  scheduleCompose();
  status(`เปลี่ยนเป็น${language === 'th' ? 'ภาษาไทย' : 'English'}แล้ว`);
});
el.rewriteButton.addEventListener('click', rewrite);
el.speakButton.addEventListener('click', speakNow);
el.undoButton.addEventListener('click', undo);
el.clearButton.addEventListener('click', clear);
loadModels();

// ---- Voice output device (speakers or a virtual microphone for meetings) ----
const output = { button: $('output-button'), panel: $('output-panel'), select: $('output-select'), scan: $('output-scan'), test: $('output-test'), monitor: $('output-monitor'), status: $('output-status') };
const updateOutputButton = () => {
  const label = voiceOutput().deviceId ? 'เสียงออก: ไมค์' : 'เลือกเสียงออก';
  output.button.setAttribute('aria-label', label);
  output.button.title = label;
};
async function fillOutputs(askPermission) {
  try {
    let devices = await listOutputs({ askPermission: askPermission && !canPickOutput() });
    const current = voiceOutput();
    // Firefox / Zen: the list stays empty; the browser's own picker chooses the device.
    if (askPermission && !devices.length && canPickOutput()) {
      const picked = await pickOutput();
      devices = [picked];
      setVoiceOutput({ deviceId: picked.id, label: picked.label });
      current.deviceId = picked.id;
      updateOutputButton();
    } else if (!devices.length && current.deviceId && current.label) {
      devices = [{ id: current.deviceId, label: current.label.replace(/^\[ไมค์เสมือน\] /, ''), virtual: true }];
    }
    output.select.replaceChildren(new Option('ลำโพงของเครื่องนี้', ''));
    for (const d of devices) output.select.append(new Option(`${d.virtual ? '[ไมค์เสมือน] ' : ''}${d.label}`, d.id));
    output.select.value = devices.some((d) => d.id === current.deviceId) ? current.deviceId : '';
    const virtual = devices.filter((d) => d.virtual).length;
    output.status.textContent = devices.length
      ? `เจออุปกรณ์เสียง ${devices.length} ตัว${virtual ? ` รวมไมค์เสมือน ${virtual} ตัว` : ' หากจะใช้ในห้องประชุม สามารถติดตั้ง VB-Audio Virtual Cable ได้'}`
      : canPickOutput()
        ? 'กด “ค้นหาอุปกรณ์เสียง” แล้วเลือกอุปกรณ์ที่ต้องการในหน้าต่างเบราว์เซอร์'
        : 'กด “ค้นหาอุปกรณ์เสียง” แล้วอนุญาตให้ดูรายชื่ออุปกรณ์ ระบบจะไม่อัดเสียงของคุณ';
  } catch (error) {
    output.status.textContent = `อ่านรายชื่ออุปกรณ์ไม่ได้: ${error.message}`;
  }
}
output.monitor.checked = voiceOutput().monitor;
if (!outputSupported) output.button.hidden = true;
output.button.addEventListener('click', () => {
  output.panel.hidden = !output.panel.hidden;
  output.button.setAttribute('aria-expanded', String(!output.panel.hidden));
  if (!output.panel.hidden) fillOutputs(false);
});
output.scan.addEventListener('click', () => fillOutputs(true));
output.select.addEventListener('change', () => {
  const option = output.select.selectedOptions[0];
  setVoiceOutput({ deviceId: output.select.value, label: output.select.value ? option.textContent : '' });
  updateOutputButton();
});
output.monitor.addEventListener('change', () => setVoiceOutput({ monitor: output.monitor.checked }));
output.test.addEventListener('click', () => speak(language === 'th' ? 'ทดสอบเสียง ซายน์วอยซ์' : 'Testing SignVoice audio'));
updateOutputButton();
document.querySelector('.app-header .view-switch').classList.add('nav-ready');

// Non-admin users: the teach column becomes "propose signs" (no training, import or vocabulary edits).
if (!isAdmin && currentUser) {
  document.getElementById('teach-title').textContent = 'เสนอท่าใหม่';
  el.teachStatus.textContent = 'เลือกคำหรือพิมพ์คำใหม่ แล้วกดเริ่มบันทึก ทำท่าทีละคำและลดมือลงเมื่อจบ ผู้ดูแลจะตรวจท่าที่คุณส่งมา';
}
