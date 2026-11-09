export const PHRASES = {
  'hello': { en: 'hello', th: 'สวัสดี' },
  'yes': { en: 'yes', th: 'ใช่' },
  'no': { en: 'no', th: 'ไม่' },
  'I love you': { en: 'I love you', th: 'ฉันรักคุณ' },
  'one moment': { en: 'one moment', th: 'รอสักครู่' }
};

// English glosses for the 51 TSL-51 signs (literal fallback when no LLM is running).
const TSL_EN = {
  'แม่': 'mother', 'คุณ': 'you', 'แฟน': 'partner', 'พี่': 'older sibling', 'น้อง': 'younger sibling', 'ฉัน': 'I',
  'ยาย': 'grandmother', 'แมว': 'cat', 'ภาษามือ': 'sign language', 'ขนมปัง': 'bread', 'ข้าว': 'rice', 'ไข่': 'egg',
  'ถาม': 'ask', 'เรียก': 'call', 'ชอบ': 'like', 'เที่ยว': 'travel', 'ไป': 'go', 'เหงา': 'lonely', 'แต่งงาน': 'marry',
  'ร้อน': 'hot', 'โสด': 'single', 'โกรธ': 'angry', 'กลัว': 'afraid', 'เหนื่อย': 'tired', 'สบายดี': 'fine',
  'ทำงาน': 'work', 'เกิด': 'born', 'ง่วง': 'sleepy', 'อยู่บ้าน': 'stay home', 'กิน': 'eat', 'เรียน': 'study',
  'ชื่อ': 'name', 'ดี': 'good', 'ด้วยกัน': 'together', 'หูหนวก': 'deaf', 'สวัสดี': 'hello', 'ขอโทษ': 'sorry',
  'ขอบคุณ': 'thank you', 'วันนี้': 'today', 'เช้า': 'morning', 'วันหยุด': 'holiday', 'พรุ่งนี้': 'tomorrow',
  'อย่า': "don't", 'ทำไม': 'why', 'อะไร': 'what', 'ที่ไหน': 'where', 'กรุงเทพ': 'Bangkok', 'โรงเรียน': 'school',
  'บ้าน': 'home', 'ตลาด': 'market'
};
for (const [th, en] of Object.entries(TSL_EN)) PHRASES[th] = { th, en };

export function localizedWord(word, language) {
  return PHRASES[word]?.[language] || word;
}

export function literalSentence(tokens, language) {
  const words = tokens.map((token) => localizedWord(token.word, language));
  if (language !== 'th') return words.join(' ');
  // Keep a greeting separate, then add only well-defined connecting words.
  const greeting = ['สวัสดี', 'ขอบคุณ', 'ขอโทษ'].includes(words[0]) && words.length > 1 ? `${words[0]} ` : '';
  const rest = greeting ? words.slice(1) : words;
  return polishThaiSentence(greeting + rest.join(''), words);
}

// A small, auditable repair for a common gloss construction. This also guards against
// a local LLM returning the same words without the connective that spoken Thai needs.
export function polishThaiSentence(sentence, words) {
  let result = sentence.trim();
  const hasMeetingGloss = words.some((word, index) => word === 'ยินดี' && ['พบ', 'รู้จัก'].includes(words[index + 1]));
  if (!hasMeetingGloss) return result;
  result = result.replace(/ยินดี\s*(?:ที่\s*)?(?:ได้\s*)?(พบ|รู้จัก)/u, (_, verb) => `ยินดีที่ได้${verb}`);
  if (words[0] === 'สวัสดี') result = result.replace(/^สวัสดี(?=ยินดี)/u, 'สวัสดี ');
  return result;
}

// The TSL-51 sentence set has a few documented object-first gloss patterns.
// Correct a model answer only when it loses a signed word or invents "ฉัน".
export function repairThaiSentence(sentence, words) {
  const polished = polishThaiSentence(sentence, words);
  const subjects = new Set(['ฉัน', 'คุณ', 'แม่', 'พี่', 'น้อง', 'แฟน', 'ยาย', 'แมว']);
  const inventedFirstPerson = !words.includes('ฉัน') && polished.includes('ฉัน');
  const inventedSubject = [...subjects].some((subject) => !words.includes(subject) && polished.includes(subject));
  const inventedPreference = !words.includes('ชอบ') && polished.includes('ชอบ');
  if (words.every((word) => polished.includes(word)) && !inventedFirstPerson && !inventedSubject && !inventedPreference) return polished;

  if (words.length === 3 && subjects.has(words[0]) && words[1] === 'ข้าว' && words[2] === 'กิน')
    return `${words[0]}กินข้าว`;
  const [object, subject, action, preference] = words;
  if (!subjects.has(subject)) return polished;
  if (words.length === 4 && object === 'กรุงเทพ' && action === 'เที่ยว' && preference === 'ชอบ')
    return `${subject}ชอบเที่ยวกรุงเทพ`;
  if (words.length === 4 && object === 'ภาษามือ' && action === 'เรียน' && preference === 'ชอบ')
    return `${subject}ชอบเรียนภาษามือ`;
  if (words.length === 3 && object === 'ภาษามือ' && action === 'เรียน')
    return `${subject}เรียนภาษามือ`;
  if (words.length === 3 && object === 'ขนมปัง' && action === 'กิน')
    return `${subject}กินขนมปัง`;
  if (words.length === 4 && object === 'ไข่' && action === 'กิน' && preference === 'ชอบ')
    return `${subject}ชอบกินไข่`;
  return polished;
}
