// Bulk-import smoke test: node scripts/import-smoke.mjs <folder of clips named word_01.mp4> (server must be running).
// Note: it really saves the samples; undo them afterwards in the teach panel or via /api/user/undo.
import { signIn } from './test-login.mjs';
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
await signIn(page, 'http://127.0.0.1:5173');
await page.goto('http://127.0.0.1:5173/?vision=cpu');
const before = (await (await page.request.get('http://127.0.0.1:5173/api/user/samples')).json()).counts;
const t = Date.now();
await page.locator('#teach-import-input').setInputFiles(readdirSync(dir).map((f) => join(dir, f)));
await page.waitForFunction(() => document.querySelector('#teach-status')?.textContent.startsWith('นำเข้าแล้ว'), null, { timeout: 300000 });
console.log('status:', await page.locator('#teach-status').textContent());
console.log('seconds:', ((Date.now() - t) / 1000).toFixed(1));
const after = (await (await page.request.get('http://127.0.0.1:5173/api/user/samples')).json()).counts;
for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (before[k] !== after[k]) console.log('changed:', k, before[k] ?? 0, '->', after[k]);
await browser.close();
