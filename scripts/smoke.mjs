import { signIn } from './test-login.mjs';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(existsSync);
if (!chrome) throw new Error('Chrome or Edge was not found');

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
const page = await browser.newPage({ permissions: ['camera'], viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('INFO: Created TensorFlow Lite')) errors.push(message.text()); });
const appUrl = process.env.APP_URL || 'http://127.0.0.1:5173';
await signIn(page, appUrl);
await page.goto(appUrl + '/?view=speak');
if (!(await page.evaluate(() => document.body.classList.contains('speak-view')))) throw new Error('Speak view did not open');
await page.goto(appUrl);
await page.locator('#teach-word option').nth(10).waitFor({ state: 'attached', timeout: 15000 });
const text = `teach words: ${await page.locator('#teach-word option').count()}`;
if (process.env.PREVIEW_PATH) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: process.env.PREVIEW_PATH });
}
await page.getByRole('button', { name: /เปิดกล้อง/ }).click();
await page.locator('#camera-pill.active').waitFor({ timeout: 30000 });
const camera = await page.locator('#camera-pill').textContent();
await page.waitForTimeout(2000);
const hand = await page.locator('#hand-state').textContent();
if (errors.length) throw new Error(errors.join('\n'));
if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
console.log(JSON.stringify({ composition: text, camera, hand }));
await browser.close();
