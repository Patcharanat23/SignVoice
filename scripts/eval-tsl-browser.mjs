// Accuracy of the full browser pipeline (MediaPipe Holistic in Chrome -> sign cutter -> TSL model)
// on TSL-51 user_sign videos. Start the server with the signer-independent model for an honest number:
//   $env:SIGNVOICE_TSL_MODEL='tsl51/signer_independent'; npm start
//   npm run eval:tsl            (videos come from: python ml/download.py --videos)
import { signIn } from './test-login.mjs';
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const home = process.env.SIGNVOICE_HOME || join(homedir(), '.signvoice');
const manifest = JSON.parse(readFileSync(join(home, 'tsl51', 'eval_videos', 'manifest.json'), 'utf8'));
const limit = Number(process.env.LIMIT || manifest.length);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
await signIn(page, process.env.APP_URL || 'http://127.0.0.1:5173');
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
await page.locator('#auto-compose').uncheck();
let responses = [];
page.on('response', async (r) => { if (r.url().includes('/api/sign')) responses.push(await r.json().catch(() => null)); });

const word = (label) => (label === 'null_act' ? null : label.split('_')[0]);
const rows = [];
for (const item of manifest.slice(0, limit)) {
  responses = [];
  await page.locator('#video-input').setInputFiles(item.file);
  await page.getByText('วิดีโอจบ', { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500); // let the last clip's request finish
  const tops = responses.filter(Boolean).map((r) => r.top[0]);
  // A clip can be cut into several segments; take the most confident non-null prediction.
  const signs = tops.filter((t) => word(t.label));
  const best = signs.sort((a, b) => b.prob - a.prob)[0];
  const predicted = best && best.prob >= 0.35 ? word(best.label) : null;
  const expected = word(item.label);
  rows.push({ expected, predicted, prob: best?.prob ?? 0, segments: tops.length, ok: predicted === expected });
  console.log(`${rows.at(-1).ok ? '✔' : '✖'} ${expected ?? 'null'} -> ${predicted ?? '(none)'} ${Math.round((best?.prob ?? 0) * 100)}% (${tops.length} seg)`);
}
await browser.close();
const signRows = rows.filter((r) => r.expected);
const summary = {
  clips: rows.length,
  accuracy_all: rows.filter((r) => r.ok).length / rows.length,
  accuracy_signs: signRows.filter((r) => r.ok).length / signRows.length,
  null_clips_without_word: rows.filter((r) => !r.expected && !r.predicted).length + '/' + rows.filter((r) => !r.expected).length,
  no_segment: rows.filter((r) => !r.segments).length
};
console.log(JSON.stringify(summary, null, 2));
if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify({ summary, rows }, null, 1));
