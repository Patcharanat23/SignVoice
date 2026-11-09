import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { localizedWord, literalSentence, polishThaiSentence, repairThaiSentence } from './language.js';

test('the same sign sequence can be composed in Thai and English', () => {
  const tokens = [{ word: 'hello' }, { word: 'one moment' }];
  assert.equal(literalSentence(tokens, 'th'), 'สวัสดี รอสักครู่');
  assert.equal(literalSentence(tokens, 'en'), 'hello one moment');
  assert.equal(localizedWord('yes', 'th'), 'ใช่');
});

test('spoken Thai connects a greeting and meeting phrase without inventing content', () => {
  const words = ['สวัสดี', 'ยินดี', 'พบ'];
  assert.equal(literalSentence(words.map((word) => ({ word })), 'th'), 'สวัสดี ยินดีที่ได้พบ');
  assert.equal(polishThaiSentence('สวัสดี ยินดีพบ', words), 'สวัสดี ยินดีที่ได้พบ');
  assert.equal(polishThaiSentence('สวัสดี ยินดีที่ได้พบ', words), 'สวัสดี ยินดีที่ได้พบ');
  assert.equal(polishThaiSentence('ยินดีรู้จักคุณ', ['ยินดี', 'รู้จัก', 'คุณ']), 'ยินดีที่ได้รู้จักคุณ');
  assert.equal(polishThaiSentence('สวัสดี ยินดีพบ', ['สวัสดี', 'ดี', 'พบ']), 'สวัสดี ยินดีพบ');
});

test('known TSL-51 patterns keep the signed subject and action when the model invents words', () => {
  assert.equal(repairThaiSentence('ฉันชอบเที่ยวกรุงเทพ', ['กรุงเทพ', 'แฟน', 'เที่ยว', 'ชอบ']), 'แฟนชอบเที่ยวกรุงเทพ');
  assert.equal(repairThaiSentence('ยายชอบเที่ยวกรุงเทพ', ['กรุงเทพ', 'แม่', 'เที่ยว', 'ชอบ']), 'แม่ชอบเที่ยวกรุงเทพ');
  assert.equal(repairThaiSentence('ยายชอบเรียนภาษามือ', ['ภาษามือ', 'ยาย', 'เรียน']), 'ยายเรียนภาษามือ');
  assert.equal(repairThaiSentence('ฉันกินขนมปังแมว', ['ขนมปัง', 'แมว', 'กิน']), 'แมวกินขนมปัง');
  assert.equal(repairThaiSentence('คุณเรียนภาษามือกับแฟน', ['ภาษามือ', 'แฟน', 'เรียน']), 'แฟนเรียนภาษามือ');
  assert.equal(repairThaiSentence('คุณกินข้าวแฟน', ['แฟน', 'ข้าว', 'กิน']), 'แฟนกินข้าว');
  assert.equal(repairThaiSentence('พี่ชอบเรียนภาษามือ', ['ภาษามือ', 'พี่', 'เรียน', 'ชอบ']), 'พี่ชอบเรียนภาษามือ');
});
