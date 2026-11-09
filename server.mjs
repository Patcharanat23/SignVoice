import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { clearCookie, clientIp, createAuth, rateLimiter, sameOrigin, securityHeaders, sessionCookie, sessionToken } from './auth.mjs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { localizedWord, repairThaiSentence } from './src/language.js';

const production = process.argv.includes('--production');
const port = Number(process.env.PORT || 5173);
const root = process.cwd();
const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
// Optional secrets (ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID) live in .env, which is git-ignored.
try { process.loadEnvFile(resolve(process.cwd(), '.env')); } catch { /* no .env: local voice only */ }
const signvoiceHome = process.env.SIGNVOICE_HOME || join(homedir(), '.signvoice');
const mlPort = Number(process.env.SIGNVOICE_ML_PORT || 8766);
const mlUrl = `http://127.0.0.1:${mlPort}`;
const vite = production ? null : await createViteServer({ server: { middlewareMode: true }, appType: 'mpa' });
// Accounts live in the same SQLite file as the rest of the app data (~/.signvoice/signvoice.db).
const auth = createAuth(process.env.SIGNVOICE_AUTH_DB || join(signvoiceHome, 'signvoice.db'), { admins: (process.env.SIGNVOICE_ADMINS || '').split(',') });
const loginLimit = rateLimiter(10, 15 * 60_000);
const registerLimit = rateLimiter(5, 60 * 60_000);
setInterval(() => auth.cleanup(), 3600_000).unref();
// Changing shared data (the vocabulary, recorded samples, the personal model) is for admins only.
const ADMIN_ONLY = ['/api/user/sample', '/api/user/undo', '/api/user/words', '/api/user/finetune'];
// Non-admin users propose samples instead; an admin approves them. 60 proposals per hour per account.
const proposeLimit = rateLimiter(60, 60 * 60_000);

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function ollama(path, options = {}) {
  const response = await fetch(`${ollamaUrl}${path}`, { ...options, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  return response.json();
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_000) throw new Error('Request too large');
  }
  return JSON.parse(body);
}

async function synthesizeOnWindows(text) {
  if (process.platform !== 'win32') throw new Error('Windows offline voice unavailable');
  const script = resolve(root, 'scripts', 'tts.ps1');
  return new Promise((resolveAudio, reject) => {
    // Windows PowerShell 5.1 ships with Windows; PowerShell 7 (pwsh) usually does not.
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
    let output = '';
    let error = '';
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !output.trim()) return reject(new Error(error.trim() || 'Offline speech failed'));
      resolveAudio(Buffer.from(output.trim(), 'base64'));
    });
    child.stdin.end(text);
  });
}

// Python sidecar (ml/service.py): TSL-51 + ASL sign models and ThonburianTTS, kept loaded in memory.
let mlProcess;
function startMl() {
  const python = process.env.SIGNVOICE_PYTHON || join(signvoiceHome, 'venv', 'Scripts', 'python.exe');
  if (!existsSync(python)) return console.warn(`[ml] Python not found at ${python}; sign translation and Thai voice are off (see README)`);
  mlProcess = spawn(python, ['-u', resolve(root, 'ml', 'service.py')], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUTF8: '1', SIGNVOICE_HOME: signvoiceHome, SIGNVOICE_ML_PORT: String(mlPort), SIGNVOICE_PARENT_PID: String(process.pid) }
  });
  // Drain both pipes: a full, unread stdout pipe blocks the Python process.
  mlProcess.stdout.resume();
  // Chunks can split a line; keep the unfinished tail until the rest arrives.
  let pending = '';
  mlProcess.stderr.on('data', (chunk) => {
    const lines = (pending + chunk).split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) if (line.startsWith('[ml]')) console.log(line);
  });
  mlProcess.on('exit', (code) => { console.warn(`[ml] service exited (${code})`); mlProcess = null; });
}

async function ml(path, options = {}) {
  const response = await fetch(`${mlUrl}${path}`, { ...options, signal: AbortSignal.timeout(options.timeout || 60000) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    // Keep the service's status (400 = bad input, 503 = model not ready) instead of turning everything into 503.
    throw Object.assign(new Error(body.detail || body.error || `ML service HTTP ${response.status}`), { status: response.status });
  }
  return response;
}

// ElevenLabs cloud voice (when a key is configured). Each spoken sentence is cached on disk,
// so rehearsing the same demo sentence does not spend credits again.
async function synthesizeElevenLabs(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) throw new Error('ElevenLabs is not configured');
  const model = process.env.ELEVENLABS_MODEL || 'eleven_v3';
  // Fixed voice settings: without them eleven_v3 re-interprets the voice for every sentence and an
  // English voice reading Thai can drift between a female and a male timbre. Stability 1.0 ("Robust")
  // keeps one consistent voice (measured pitch 86-101 Hz on four sentences for the male voice Brian).
  const settings = { stability: Number(process.env.ELEVENLABS_STABILITY ?? 1.0), similarity_boost: 0.8 };
  const cacheDir = join(signvoiceHome, 'tts_cache');
  const file = join(cacheDir, createHash('sha1').update(`${voice}|${model}|${JSON.stringify(settings)}|${text}`).digest('hex') + '.mp3');
  if (existsSync(file)) return readFile(file);
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings: settings }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`ElevenLabs HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const audio = Buffer.from(await response.arrayBuffer());
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, audio);
  return audio;
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// The tokens are sign-language glosses (TSL or ASL word order, no function words).
const COMPOSER_PROMPT = (language) => `You turn sign-language glosses into one short, natural spoken sentence in ${language === 'th' ? 'Thai' : 'English'}.
The tokens come from a Thai Sign Language (TSL) or American Sign Language (ASL) recogniser, in signing order. Sign languages have their own grammar: topic/object often comes first, verbs follow, question words come last, and there are no particles or tense markers.
Rules:
- Write every word in the output language: translate English/ASL tokens into Thai when the output is Thai, and Thai tokens into English when it is English.
- Reorder into normal spoken word order: subject first; verbs of liking/wanting (ชอบ, อยาก, like, want) go before the action they describe; greetings, thanks and apologies (สวัสดี, ขอบคุณ, ขอโทษ, hello, sorry) stay at the start.
- Add only the small function words a fluent speaker needs (กับ, ที่, จะ, am/is/are, to, a/the, question form). Do not add ครับ/ค่ะ.
- Do not merely concatenate the glosses. In Thai, ยินดี + พบ means ยินดีที่ได้พบ, and ยินดี + รู้จัก means ยินดีที่ได้รู้จัก. These connecting words express the signed meaning; they do not add a new fact.
- A token face "raised brows" usually marks a yes/no question; "frown" can mark a wh-question or negation. Use it only as a hint.
- Do not add people, places, feelings or facts that are not in the tokens. Keep every content word.
- If a subject is signed (such as แม่, พี่, ยาย, แมว), keep that subject. Never replace it with or add ฉัน/I. Keep every action verb, especially เรียน/study when ชอบ/like is also present.
- Only turn a statement into a yes/no question when the face cue or signed question word supports it. Do not infer a question from คุณ/you alone.
- Consecutive single Thai letters (e.g. ส, ม, ช) are fingerspelling: join them into one word or name (e.g. "สมชาย"), and treat สระ... tokens as the vowel they name.
- If editedText is present, it is the user's own correction: keep its meaning.
- Reply with the sentence only, no quotes or explanation.
Examples (Thai): [สวัสดี, ยินดี, พบ] -> สวัสดี ยินดีที่ได้พบ | [ยินดี, รู้จัก, คุณ] -> ยินดีที่ได้รู้จักคุณ | [ขนมปัง, ฉัน, กิน] -> ฉันกินขนมปัง | [สวัสดี, ฉัน, สบายดี] -> สวัสดี ฉันสบายดี | [คุณ, ชื่อ, อะไร] -> คุณชื่ออะไร | [พรุ่งนี้, คุณ, ข้าว, กิน, ไป, ที่ไหน] -> พรุ่งนี้คุณจะไปกินข้าวที่ไหน | [แม่, เหนื่อย (raised brows)] -> แม่เหนื่อยไหม | [ข้าว, น้อง, กิน, ชอบ] -> น้องชอบกินข้าว | [ขอบคุณ, ฉัน, เหนื่อย] -> ขอบคุณ ฉันเหนื่อย | [cat, sleep] -> แมวนอน
Thai order patterns: [ภาษามือ, <ประธาน>, เรียน] -> <ประธาน>เรียนภาษามือ | [ภาษามือ, <ประธาน>, เรียน, ชอบ] -> <ประธาน>ชอบเรียนภาษามือ | [กรุงเทพ, <ประธาน>, เที่ยว, ชอบ] -> <ประธาน>ชอบเที่ยวกรุงเทพ | [คุณ, ฉัน, แต่งงาน] -> คุณแต่งงานกับฉัน | [คุณ, ฉัน, แฟน] -> คุณเป็นแฟนกับฉัน | [ขอโทษ, ฉัน, ข้าว, กิน, ไป] -> ขอโทษ ฉันไปกินข้าว. Replace <ประธาน> with exactly the signed subject, including แมว if signed.
Examples (English): [bread, I, eat] -> I eat bread. | [you, name, what] -> What is your name? | [hello, fine (raised brows)] -> Hello, are you doing well? | [tomorrow, I, busy] -> I am busy tomorrow. | [แม่, ร้อน] -> Mom is hot.`;

async function handleAuth(req, res, user) {
  const path = new URL(req.url, 'http://localhost').pathname;
  const ip = clientIp(req);
  if (req.method === 'GET' && path === '/api/auth/me') return json(res, user ? 200 : 401, { user });
  if (req.method === 'POST' && path === '/api/auth/logout') {
    auth.logout(sessionToken(req));
    res.setHeader('set-cookie', clearCookie(req));
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && (path === '/api/auth/login' || path === '/api/auth/register')) {
    // Registration counts every attempt; login counts only failed attempts (10 wrong passwords / 15 min / IP).
    const limiter = path.endsWith('login') ? loginLimit : registerLimit;
    if (path.endsWith('login') ? limiter.blocked(ip) : !limiter.allow(ip)) {
      res.setHeader('retry-after', String(limiter.retryAfter(ip)));
      return json(res, 429, { error: `ลองหลายครั้งเกินไป กรุณารอ ${Math.ceil(limiter.retryAfter(ip) / 60)} นาที` });
    }
    const input = await readJson(req);
    if (path.endsWith('register')) {
      const result = await auth.register(input, ip);
      if (result.error) return json(res, 400, result);
    }
    const result = await auth.login(input, ip, req.headers['user-agent']);
    if (result.error) {
      if (path.endsWith('login')) loginLimit.allow(ip);  // record the failed attempt
      return json(res, 401, { error: result.error });
    }
    res.setHeader('set-cookie', sessionCookie(req, result.token));
    return json(res, 200, { user: result.user });
  }
  if (path.startsWith('/api/admin/')) {
    if (!user) return json(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
    if (user.role !== 'admin') return json(res, 403, { error: 'เฉพาะผู้ดูแลระบบ' });
    if (req.method === 'GET' && path === '/api/admin/users') return json(res, 200, { users: auth.listUsers(), log: auth.recentLog() });
    const match = path.match(/^\/api\/admin\/users\/(\d+)$/);
    if (req.method === 'POST' && match) {
      const result = auth.updateUser(user, match[1], await readJson(req));
      return json(res, result.error ? 400 : 200, result);
    }
    if (req.method === 'GET' && path === '/api/admin/stats') return json(res, 200, await (await ml('/user/stats', { timeout: 3000 })).json());
  }
  return json(res, 404, { error: 'Unknown API route' });
}

async function handleApi(req, res) {
  try {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-site request blocked' });
    // Permission checks below compare the raw URL, and fetch() would collapse "/x/../finetune"
    // (or %2e%2e, %2f, backslashes) before it reaches the ML service. Only canonical paths pass.
    const rawPath = req.url.split('?')[0];
    if (/%2e|%2f|%5c|\\/i.test(rawPath) || new URL(req.url, 'http://localhost').pathname !== rawPath) {
      return json(res, 400, { error: 'Invalid path' });
    }
    const user = auth.sessionUser(sessionToken(req));
    if (req.url.startsWith('/api/auth/') || req.url.startsWith('/api/admin/')) return await handleAuth(req, res, user);
    if (!user) return json(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
    if (req.method === 'POST' && ADMIN_ONLY.some((p) => req.url.startsWith(p)) && user.role !== 'admin') return json(res, 403, { error: 'เฉพาะผู้ดูแลระบบแก้ไขคำศัพท์และโมเดลได้' });
    if (req.method === 'GET' && req.url === '/api/models') {
      try {
        const data = await ollama('/api/tags');
        return json(res, 200, { available: true, models: (data.models || []).map((m) => m.name) });
      } catch {
        return json(res, 200, { available: false, models: [] });
      }
    }
    if (req.method === 'GET' && req.url === '/api/ml') {
      try {
        return json(res, 200, await (await ml('/health', { timeout: 3000 })).json());
      } catch (error) {
        return json(res, 200, { tsl: false, asl: false, tts: false, errors: { service: error.message } });
      }
    }
    if (req.url.startsWith('/api/user/proposals')) {
      if (user.role !== 'admin') return json(res, 403, { error: 'เฉพาะผู้ดูแลระบบ' });
      const body = req.method === 'POST' ? await readBody(req, 64_000) : undefined;
      const response = await ml(req.url.slice(4), { method: req.method, body, headers: { 'content-type': 'application/json' } });
      if (req.url.endsWith('/frames')) {
        const bytes = Buffer.from(await response.arrayBuffer());
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'no-store' });
        return res.end(bytes);
      }
      return json(res, 200, await response.json());
    }
    if (req.method === 'POST' && req.url.startsWith('/api/user/propose')) {
      if (!proposeLimit.allow(user.username)) return json(res, 429, { error: 'เสนอท่าเกินชั่วโมงละ 60 ครั้ง กรุณารอสักครู่' });
      const q = new URL(req.url, 'http://localhost').searchParams;
      // The proposer is taken from the session, never from the request.
      const params = new URLSearchParams({ label: q.get('label') || '', th: q.get('th') || '', en: q.get('en') || '', by: user.username });
      const body = await readBody(req, 543 * 3 * 4 * 400);
      const response = await ml(`/user/propose?${params}`, { method: 'POST', body, headers: { 'content-type': 'application/octet-stream' } });
      return json(res, 200, await response.json());
    }
    if (req.url?.startsWith('/api/user/')) {
      // Personal calibration: record the user's own signs and fine-tune on them.
      const body = req.method === 'POST' ? await readBody(req, 543 * 3 * 4 * 400) : undefined;
      const response = await ml(req.url.slice(4), { method: req.method, body, headers: { 'content-type': 'application/octet-stream' } });
      return json(res, 200, await response.json());
    }
    if (req.method === 'POST' && req.url?.startsWith('/api/sign')) {
      const lang = new URL(req.url, 'http://localhost').searchParams.get('lang') === 'asl' ? 'asl' : 'tsl';
      const body = await readBody(req, 543 * 3 * 4 * 400);
      const response = await ml(`/classify?lang=${lang}`, { method: 'POST', body, headers: { 'content-type': 'application/octet-stream' } });
      return json(res, 200, await response.json());
    }
    if (req.method === 'POST' && req.url === '/api/rewrite') {
      const input = await readJson(req);
      const tokens = Array.isArray(input.tokens) ? input.tokens.slice(0, 30) : [];
      const model = typeof input.model === 'string' ? input.model.slice(0, 100) : '';
      const language = input.language === 'th' ? 'th' : 'en';
      const editedText = typeof input.editedText === 'string' ? input.editedText.slice(0, 500) : '';
      if ((!tokens.length && !editedText.trim()) || !model) return json(res, 400, { error: 'Missing text or model' });
      // The same sign recognised twice in a row is almost always a repeat, not intent.
      const gloss = tokens.filter((t, i) => i === 0 || t.word !== tokens[i - 1].word).map((t) => ({
        word: localizedWord(String(t.word || '').slice(0, 60), language),
        face: String(t.face || 'neutral').slice(0, 30)
      }));
      const data = await ollama('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          options: { temperature: 0.1, num_predict: 120 },
          messages: [
            { role: 'system', content: COMPOSER_PROMPT(language) },
            { role: 'user', content: JSON.stringify({ tokens: gloss, editedText }) }
          ]
        })
      });
      const rawSentence = String(data.message?.content || '').trim().replace(/^['"`]+|['"`]+$/g, '').slice(0, 500);
      const sentence = language === 'th' && !editedText.trim()
        ? repairThaiSentence(rawSentence, gloss.map((token) => token.word))
        : rawSentence;
      console.log(`[llm] ${gloss.map((t) => t.word + (t.face !== 'neutral' ? `(${t.face})` : '')).join(' ')} -> ${sentence}`);
      return json(res, 200, { sentence, model });
    }
    if (req.method === 'POST' && req.url === '/api/speech') {
      const input = await readJson(req);
      const text = typeof input.text === 'string' ? input.text.trim().slice(0, 500) : '';
      const language = input.language === 'th' ? 'th' : 'en';
      if (!text) return json(res, 400, { error: 'Missing text' });
      // Voice chain: ElevenLabs (if configured and online) -> ThonburianTTS (local) -> Windows voice (English).
      let audio, type = 'audio/wav', engine = 'thonburian';
      try {
        audio = await synthesizeElevenLabs(text);
        type = 'audio/mpeg';
        engine = 'elevenlabs';
      } catch (error) {
        if (process.env.ELEVENLABS_API_KEY) console.warn(`[voice] ElevenLabs failed, using local voice: ${error.message}`);
        try {
          audio = Buffer.from(await (await ml('/tts', { method: 'POST', body: JSON.stringify({ text }), headers: { 'content-type': 'application/json' } })).arrayBuffer());
        } catch (localError) {
          if (language === 'th') throw localError;
          audio = await synthesizeOnWindows(text);
          engine = 'windows';
        }
      }
      console.log(`[voice] ${engine}: ${text}`);
      res.writeHead(200, { 'content-type': type, 'content-length': audio.length, 'cache-control': 'no-store', 'x-voice-engine': engine });
      return res.end(audio);
    }
    return json(res, 404, { error: 'Unknown API route' });
  } catch (error) {
    const status = error instanceof SyntaxError || error.message === 'Request too large' ? 400 : error.status || 503;
    return json(res, status, { error: error.message || 'Model unavailable' });
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.json': 'application/json; charset=utf-8', '.mp4': 'video/mp4'
};

startMl();
const stopMl = () => mlProcess?.kill();
process.on('exit', stopMl);
process.on('SIGINT', () => { stopMl(); process.exit(0); });

// Pages need a session: the app for any user, admin.html for admins; others go to the login page.
function pageRedirect(req) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const page = pathname === '/' || pathname === '/index.html' ? 'app' : pathname === '/admin.html' ? 'admin' : pathname === '/login.html' ? 'login' : null;
  if (!page) return null;
  const user = auth.sessionUser(sessionToken(req));
  if (page === 'login') return user ? '/' : null;
  if (!user) return '/login.html';
  if (page === 'admin' && user.role !== 'admin') return '/';
  return null;
}

const tls = process.env.SIGNVOICE_TLS_CERT && process.env.SIGNVOICE_TLS_KEY
  ? { cert: readFileSync(process.env.SIGNVOICE_TLS_CERT), key: readFileSync(process.env.SIGNVOICE_TLS_KEY) } : null;
const server = (tls ? (handler) => createHttpsServer(tls, handler) : createHttpServer)(async (req, res) => {
  for (const [name, value] of Object.entries(securityHeaders(req, production))) res.setHeader(name, value);
  if (req.url?.startsWith('/api/')) return handleApi(req, res);
  const redirect = pageRedirect(req);
  if (redirect) {
    res.writeHead(302, { location: redirect, 'cache-control': 'no-store' });
    return res.end();
  }
  if (vite) return vite.middlewares(req, res);
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  const target = resolve(root, 'dist', `.${pathname === '/' ? '/index.html' : pathname}`);
  const dist = resolve(root, 'dist');
  if (target !== dist && !target.startsWith(dist + sep)) return json(res, 403, { error: 'Forbidden' });
  try {
    const file = (await stat(target)).isDirectory() ? resolve(target, 'index.html') : target;  // no SPA fallback: unknown paths are 404
    const bytes = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', ...(extname(file) === '.html' ? { 'cache-control': 'no-store' } : {}) });
    res.end(bytes);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
});

// 127.0.0.1 by default (only this computer). Docker sets SIGNVOICE_HOST=0.0.0.0 so the published port works.
const host = process.env.SIGNVOICE_HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`SignVoice Local: ${tls ? 'https' : 'http'}://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
