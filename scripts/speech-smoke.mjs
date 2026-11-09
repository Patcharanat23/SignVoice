import { signIn } from './test-login.mjs';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(existsSync);
if (!chrome) throw new Error('Chrome or Edge was not found');

const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  let requests = 0;
  page.on('request', (request) => { if (request.url().includes('/api/speech')) requests++; });
  await signIn(page, process.env.APP_URL || 'http://127.0.0.1:5173');
  await page.goto((process.env.APP_URL || 'http://127.0.0.1:5173') + '/?vision=cpu');
  for (const [language, sentence] of [['th', 'สวัสดี'], ['en', 'Hello']]) {
    await page.locator('#language-select').selectOption(language);
    await page.locator('#sentence').fill(sentence);
    const actual = await page.locator('#sentence').inputValue();
    const before = requests;
    await page.evaluate(() => {
      // Record the speaking aura: was it shown, and how loud did it follow the voice?
      const aura = document.getElementById('speak-aura');
      window.__aura = { on: false, max: 0 };
      const watch = () => {
        if (aura.classList.contains('on')) window.__aura.on = true;
        window.__aura.max = Math.max(window.__aura.max, Number(aura.style.getPropertyValue('--level') || 0));
        requestAnimationFrame(watch);
      };
      watch();
      const button = document.getElementById('speak-button');
      button.click();
      button.click();
    });
    await page.getByText('พูดประโยคจบแล้ว', { exact: true }).waitFor({ timeout: 45000 });
    if (requests - before !== 1) throw new Error(`${language}: expected one speech request, got ${requests - before}`);
    if (await page.locator('#speak-button').isDisabled()) throw new Error(`${language}: speech button stayed disabled`);
    const aura = await page.evaluate(() => ({ ...window.__aura, onAfter: document.getElementById('speak-aura').classList.contains('on') }));
    if (!aura.on || aura.max <= 0.05) throw new Error(`${language}: speaking aura did not follow the voice ${JSON.stringify(aura)}`);
    if (aura.onAfter) throw new Error(`${language}: speaking aura stayed on after the voice ended`);
    console.log(`${language}: ${actual}, one request, playback completed, aura peak level ${aura.max.toFixed(2)}`);
  }
} finally {
  await browser.close();
}
