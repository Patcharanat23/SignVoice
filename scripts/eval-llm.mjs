import { sessionCookie } from './test-login.mjs';
// LLM sentence-composer benchmark on the 76 TSL-51 sentence glosses.
// Reference word order comes from the TSL-51 dataset card's table (Thai order for each sign-order pattern),
// not from us. Requires the app server (npm start) and Ollama. Writes docs/llm-eval.json.
//   node scripts/eval-llm.mjs [model ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const home = process.env.SIGNVOICE_HOME || join(homedir(), '.signvoice');
const app = process.env.APP_URL || 'http://127.0.0.1:5173';
const cookie = await sessionCookie(app);
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['qwen3:4b-instruct', 'llama3.2:3b', 'gemma3:4b'];
const SUBJECTS = ['ฉัน', 'คุณ', 'แม่', 'พี่', 'น้อง', 'แฟน', 'ยาย', 'แมว'];
const VOCAB = ['แม่', 'คุณ', 'แฟน', 'พี่', 'น้อง', 'ฉัน', 'ยาย', 'แมว', 'ภาษามือ', 'ขนมปัง', 'ข้าว', 'ไข่', 'ถาม', 'เรียก', 'ชอบ', 'เที่ยว', 'ไป',
  'เหงา', 'แต่งงาน', 'ร้อน', 'โสด', 'โกรธ', 'กลัว', 'เหนื่อย', 'สบายดี', 'ทำงาน', 'เกิด', 'ง่วง', 'อยู่บ้าน', 'กิน', 'เรียน', 'ชื่อ', 'ดี',
  'ด้วยกัน', 'หูหนวก', 'สวัสดี', 'ขอโทษ', 'ขอบคุณ', 'วันนี้', 'เช้า', 'วันหยุด', 'พรุ่งนี้', 'อย่า', 'ทำไม', 'อะไร', 'ที่ไหน', 'กรุงเทพ', 'โรงเรียน', 'บ้าน', 'ตลาด'];

// Thai word order per pattern, from the TSL-51 dataset card ("กลุ่มไวยากรณ์" column). S = subject.
// `seen` = this structure also appears among the few-shot examples in our prompt (possible leakage).
function expected(g) {
  const s = g.find((w) => SUBJECTS.includes(w));
  const has = (...w) => w.every((x) => g.includes(x));
  if (has('ขนมปัง', 'กิน')) return { group: 'S กิน ขนมปัง', order: [s, 'กิน', 'ขนมปัง'], seen: true };
  if (has('ไข่', 'กิน', 'ชอบ')) return { group: 'S ชอบ กิน ไข่', order: [s, 'ชอบ', 'กิน', 'ไข่'], seen: true };
  if (has('ภาษามือ', 'เรียน', 'ชอบ')) return { group: 'S ชอบ เรียน ภาษามือ', order: [s, 'ชอบ', 'เรียน', 'ภาษามือ'], seen: false };
  if (has('ภาษามือ', 'เรียน')) return { group: 'S เรียน ภาษามือ', order: [s, 'เรียน', 'ภาษามือ'], seen: false };
  if (has('กรุงเทพ', 'เที่ยว', 'ชอบ')) return { group: 'S ชอบ เที่ยว กรุงเทพ', order: [s, 'ชอบ', 'เที่ยว', 'กรุงเทพ'], seen: false };
  if (has('พรุ่งนี้', 'ที่ไหน')) return { group: 'พรุ่งนี้ คุณ ไป กิน ข้าว ที่ไหน', order: ['พรุ่งนี้', 'คุณ', 'ไป', 'กิน', 'ข้าว', 'ที่ไหน'], seen: true };
  if (has('ขอโทษ', 'ข้าว', 'กิน', 'ไป')) return { group: 'ขอโทษ S ไป กิน ข้าว', order: ['ขอโทษ', s, 'ไป', 'กิน', 'ข้าว'], seen: false };
  if (has('ข้าว', 'กิน')) return { group: 'S กิน ข้าว', order: [s, 'กิน', 'ข้าว'], seen: true };
  if (has('ขอโทษ', 'หูหนวก')) return { group: 'ขอโทษ S หูหนวก', order: ['ขอโทษ', s, 'หูหนวก'], seen: false };
  if (has('เกิด', 'หูหนวก')) return { group: 'S เกิด หูหนวก', order: [s, 'เกิด', 'หูหนวก'], seen: false };
  if (has('สบายดี')) return { group: 'สวัสดี/ขอบคุณ S สบายดี', order: g, seen: true };
  if (has('คุณ', 'ชื่อ', 'อะไร')) return { group: 'คุณ ชื่อ อะไร', order: ['คุณ', 'ชื่อ', 'อะไร'], seen: true };
  if (has('คุณ', 'เกิด', 'ที่ไหน')) return { group: 'คุณ เกิด ที่ไหน', order: ['คุณ', 'เกิด', 'ที่ไหน'], seen: false };
  if (has('คุณ', 'ฉัน') && (g.includes('แต่งงาน') || g.includes('แฟน'))) return { group: 'คุณ แต่งงาน/แฟน ฉัน', order: ['คุณ', g.includes('แต่งงาน') ? 'แต่งงาน' : 'แฟน', 'ฉัน'], seen: false };
  return null;
}

// Positions of the expected words in the output, matched left to right.
function inOrder(text, order) {
  let at = 0;
  for (const w of order) {
    const i = text.indexOf(w, at);
    if (i < 0) return false;
    at = i + w.length;
  }
  return true;
}
const keepsAll = (text, words) => words.every((w) => text.includes(w));
const extras = (text, words) => VOCAB.filter((v) => !words.includes(v) && text.includes(v) && !words.some((w) => w.includes(v)) && !(v === 'ดี' && text.includes('สบายดี')) && !(v === 'บ้าน' && text.includes('อยู่บ้าน')));

const csv = readFileSync(join(home, 'tsl51', 'metadata', 'sentence_metadata.csv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/);
const head = csv[0].split(',');
const glosses = [...new Set(csv.slice(1).filter(Boolean).map((line) => line.split(',')[head.indexOf('sentence_clean')]))].map((s) => s.split(' '));
const cases = glosses.map((g) => ({ gloss: g, ref: expected(g) })).filter((c) => c.ref);
console.log(`${glosses.length} unique glosses, ${cases.length} matched to a reference pattern`);

async function compose(model, words) {
  if (!model) return words.join('');
  const r = await fetch(`${app}/api/rewrite`, { method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ tokens: words.map((word) => ({ word, face: 'neutral' })), model, language: 'th' }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d.sentence;
}

const report = { cases: cases.length, models: {} };
for (const model of [null, ...models]) {
  const name = model || 'no LLM (words joined)';
  const rows = [];
  const times = [];
  for (const c of cases) {
    const t = Date.now();
    const out = (await compose(model, c.gloss)).replace(/\s+/g, '');
    if (model) times.push(Date.now() - t);
    rows.push({ gloss: c.gloss.join(' '), group: c.ref.group, seen: c.ref.seen, out, keeps: keepsAll(out, c.gloss), ordered: inOrder(out, c.ref.order), extra: extras(out, c.gloss) });
  }
  const pct = (xs, f) => xs.length ? Math.round((xs.filter(f).length / xs.length) * 1000) / 10 : null;
  const unseen = rows.filter((r) => !r.seen);
  report.models[name] = {
    keeps_all_words: pct(rows, (r) => r.keeps), correct_thai_order: pct(rows, (r) => r.ordered), no_added_sign_words: pct(rows, (r) => !r.extra.length),
    unseen_patterns: { cases: unseen.length, correct_thai_order: pct(unseen, (r) => r.ordered), keeps_all_words: pct(unseen, (r) => r.keeps) },
    median_ms: times.length ? times.sort((a, b) => a - b)[Math.floor(times.length / 2)] : 0,
    examples: rows.filter((_, i) => i % 9 === 0).map((r) => `${r.gloss} -> ${r.out}`), errors: rows.filter((r) => !r.ordered || r.extra.length).slice(0, 8).map((r) => `${r.gloss} -> ${r.out}${r.extra.length ? ' [+' + r.extra.join(',') + ']' : ''}`)
  };
  console.log(name, JSON.stringify({ ...report.models[name], examples: undefined, errors: undefined }));
}
const output = process.env.EVAL_OUTPUT || 'docs/llm-eval.json';
writeFileSync(output, JSON.stringify(report, null, 1));
console.log(`saved ${output}`);
