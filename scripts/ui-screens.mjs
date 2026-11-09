// Screenshots of the login, speak (with the speaking aura) and admin pages: node scripts/ui-screens.mjs <out-dir>
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { signIn } from './test-login.mjs';
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const out = process.argv[2] || 'docs';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, permissions: ['camera'] });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('TensorFlow Lite')) errors.push(m.text()); });
await page.goto(base + '/login.html');
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, 'ui-login.png') });
await signIn(page, base);
await page.goto(base + '/?view=speak&vision=cpu');
await page.waitForTimeout(1500);
await page.evaluate(() => {
  document.getElementById('hud-sentence').classList.remove('hidden');
  document.getElementById('hud-sentence-text').textContent = 'สวัสดี ฉันชอบภาษามือ';
  const aura = document.getElementById('speak-aura');
  aura.classList.add('on'); aura.style.setProperty('--level', '0.7');
});
await page.waitForTimeout(900);
await page.screenshot({ path: join(out, 'ui-speak-aura.png') });
await page.goto(base + '/');
await page.waitForTimeout(1200);
await page.screenshot({ path: join(out, 'ui-teach.png') });
await page.goto(base + '/admin.html');
await page.waitForTimeout(1200);
await page.screenshot({ path: join(out, 'ui-admin.png') });
console.log(JSON.stringify({ errors }));
await browser.close();
