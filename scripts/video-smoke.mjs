import { signIn } from './test-login.mjs';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const videoPath = process.env.TEST_VIDEO && resolve(process.env.TEST_VIDEO);
const sampleWave = Boolean(process.env.SAMPLE_WAVE || process.argv.includes('--wave'));
const sampleFace = Boolean(process.env.SAMPLE_FACE || process.argv.includes('--face'));
const sampleTsl = process.argv.includes('--tsl');
if (videoPath && !existsSync(videoPath)) throw new Error('TEST_VIDEO does not exist');
const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(existsSync);
if (!chrome) throw new Error('Chrome or Edge was not found');

const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, process.env.APP_URL || 'http://127.0.0.1:5173');
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
  await page.evaluate(() => {
    window.testHandStates = [];
    window.testFaceStates = [];
    const hand = document.getElementById('hand-state');

    new MutationObserver(() => window.testHandStates.push(hand.textContent)).observe(hand, { childList: true, characterData: true, subtree: true });

  });
  if (videoPath) await page.locator('#video-input').setInputFiles(videoPath);
  else if (sampleWave) await page.getByRole('button', { name: /คลิปโบกมือ/ }).click();
  else if (sampleFace) await page.getByRole('button', { name: /คลิปทดสอบใบหน้า/ }).click();
  else if (sampleTsl) await page.getByRole('button', { name: /คลิป TSL/ }).click();
  else await page.getByRole('button', { name: /คลิปทดสอบมือ/ }).click();
  await page.getByText('วิดีโอจบ', { exact: true }).waitFor({ timeout: 90000 });
  if (sampleTsl) await page.waitForFunction(() => /คำที่ถูกคือ|แปลท่าไม่สำเร็จ/.test(document.body.textContent), null, { timeout: 30000 });
  const result = await page.evaluate(() => ({
    handStates: [...new Set(window.testHandStates)].filter(Boolean),
    faceStates: [...new Set(window.testFaceStates)].filter(Boolean),
    tokenText: document.getElementById('token-list').textContent,
    light: document.getElementById('light-state').textContent,
    sentence: document.getElementById('sentence').value,
    status: document.getElementById('vision-status').textContent,
    candidates: document.getElementById('candidates').textContent
  }));
  if (process.env.SCREENSHOT_PATH) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: process.env.SCREENSHOT_PATH });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  if (sampleTsl) {
    if (!result.tokenText.includes('สวัสดี')) throw new Error('TSL clip was not translated to สวัสดี: ' + JSON.stringify(result));
    console.log(JSON.stringify(result));
    await browser.close();
    process.exit(0);
  }
  if (!process.env.ALLOW_ANY && !result.handStates.some((state) => state.includes('Thumb_Up') || state.includes('Open_Palm') || state.includes('Victory') || state.includes('Closed_Fist'))) {
    throw new Error('Video completed, but no expected hand gesture was classified: ' + JSON.stringify(result));
  }
  if (process.env.EXPECT_WORD && !result.sentence.includes(process.env.EXPECT_WORD)) {
    throw new Error('Expected word was not produced: ' + JSON.stringify(result));
  }
  if (!videoPath && !sampleFace && result.sentence !== (sampleWave ? 'สวัสดี' : 'ใช่')) {
    throw new Error('Sample gesture did not become the expected Thai word: ' + JSON.stringify(result));
  }
  if (sampleWave && !result.tokenText.includes('smile')) {
    throw new Error('Wave token did not include the face cue: ' + JSON.stringify(result));
  }
  if ((process.env.TEST_FACE || sampleFace) && !result.faceStates.some((state) => state.includes('smile') || state.includes('raised brows') || state.includes('frown'))) {
    throw new Error('Video completed, but no face cue was found: ' + JSON.stringify(result));
  }
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
