// Captures the login-page slideshow images from the running app into public/showcase/.
//   node scripts/showcase-shots.mjs      (APP_URL, SV_TEST_USER / SV_TEST_PASS = an admin account)
// Only 3-voice-output.jpg is captured here; the photo-*.jpg slides are real camera screenshots.
// Replace any of the files with your own screenshot of the same name to change a slide.
import { chromium } from 'playwright-core';
import { signIn } from './test-login.mjs';
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const out = 'public/showcase';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
await signIn(page, base);
const shot = (name) => page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 82 });

await page.goto(base + '/?view=speak&vision=cpu');
await page.waitForTimeout(1200);
await page.evaluate(() => {
  document.getElementById('hud-tokens').innerHTML = '<span>สวัสดี</span><span>ฉัน</span><span>ชอบ</span><span>ภาษามือ</span>';
  document.getElementById('hud-sentence').classList.remove('hidden');
  document.getElementById('hud-sentence-text').textContent = 'สวัสดี ฉันชอบภาษามือ';
  const aura = document.getElementById('speak-aura'); aura.classList.add('on'); aura.style.setProperty('--level', '0.8');
});
await page.waitForTimeout(800);
await shot('1-speak');
await page.evaluate(() => document.getElementById('speak-aura').classList.remove('on'));
await page.locator('#output-button').click();
await page.waitForTimeout(500);
await shot('3-voice-output');

await page.goto(base + '/');
await page.waitForTimeout(1500);
await page.locator('.vocab-box summary').click();
await page.waitForTimeout(400);
await shot('2-manage');

await browser.close();
console.log('saved to', out);
