import { sessionCookie } from './test-login.mjs';
// Run after Ollama has downloaded the requested models.
// Example: MODELS=qwen3:4b-instruct,llama3.2:3b,gemma3:4b npm run compare:models
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const cookie = await sessionCookie(base);
const models = (process.env.MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!models.length) throw new Error('Set MODELS to a comma-separated list of installed Ollama models');

const cases = [
  { name: 'greeting', tokens: [{ word: 'hello', face: 'smile' }, { word: 'one moment', face: 'neutral' }], expected: ['hello', 'moment'] },
  { name: 'negation', tokens: [{ word: 'no', face: 'raised brows' }], expected: ['no'] },
  { name: 'affection', tokens: [{ word: 'I love you', face: 'smile' }], expected: ['love', 'you'] },
  { name: 'user correction', tokens: [{ word: 'one moment', face: 'neutral' }], editedText: 'Please wait a moment.', expected: ['wait', 'moment'] },
  { name: 'Thai output', tokens: [{ word: 'hello', face: 'smile' }, { word: 'one moment', face: 'neutral' }], language: 'th', expected: ['สวัสดี', 'รอ'] },
  { name: 'Thai correction', tokens: [{ word: 'one moment', face: 'neutral' }], editedText: 'กรุณารอสักครู่', language: 'th', expected: ['รอ'] }
];

const results = [];
for (const model of models) {
  for (const item of cases) {
    const start = performance.now();
    try {
      const response = await fetch(`${base}/api/rewrite`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ tokens: item.tokens, editedText: item.editedText || '', language: item.language || 'en', model })
      });
      const data = await response.json();
      const sentence = data.sentence || '';
      const passed = response.ok && item.expected.every((word) => sentence.toLowerCase().includes(word));
      results.push({ model, case: item.name, seconds: +((performance.now() - start) / 1000).toFixed(2), passed, sentence, error: data.error || '' });
    } catch (error) {
      results.push({ model, case: item.name, seconds: +((performance.now() - start) / 1000).toFixed(2), passed: false, sentence: '', error: error.message });
    }
  }
}
console.table(results.map(({ model, case: name, seconds, passed, sentence, error }) => ({ model, case: name, seconds, passed, output: sentence || error })));
const summary = models.map((model) => {
  const rows = results.filter((row) => row.model === model);
  return { model, success: `${rows.filter((row) => row.passed).length}/${rows.length}`, meanSeconds: +(rows.reduce((sum, row) => sum + row.seconds, 0) / rows.length).toFixed(2) };
});
console.table(summary);
