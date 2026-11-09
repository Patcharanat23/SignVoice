// End-to-end check of "users propose, admins approve" on a running server.
//   ADMIN=user:pass USER=user:pass node scripts/proposals-smoke.mjs
// It proposes two clips as the normal user, then the admin rejects both, so the vocabulary
// and the training data are unchanged afterwards.
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const [adminName, adminPass] = (process.env.ADMIN || '').split(':');
const [userName, userPass] = (process.env.USER_ACCOUNT || '').split(':');
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

async function login(username, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ username, password }) });
  if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
  return r.headers.get('set-cookie').split(';')[0];
}
const call = (cookie, path, init = {}) => fetch(base + path, { ...init, headers: { origin: base, cookie, ...(init.headers || {}) } });

const admin = await login(adminName, adminPass);
const user = await login(userName, userPass);
const clip = new Float32Array(30 * 543 * 3).fill(NaN);
for (let f = 0; f < 30; f++) for (let i = 468; i < 489; i++) { clip[(f * 543 + i) * 3] = 0.4 + 0.01 * (i - 468); clip[(f * 543 + i) * 3 + 1] = 0.5 + 0.005 * f; }

const before = (await (await call(admin, '/api/user/samples')).json()).counts;
check('user cannot add samples directly (403)', (await call(user, '/api/user/sample?label=ชอบ_var_1', { method: 'POST', body: clip })).status === 403);
check('user cannot open the review list (403)', (await call(user, '/api/user/proposals')).status === 403);
const p1 = await call(user, '/api/user/propose?label=ชอบ_var_1&by=admin', { method: 'POST', body: clip });
check('user can propose a sample of an existing word', p1.ok, JSON.stringify(await p1.json()));
const p2 = await call(user, `/api/user/propose?label=${encodeURIComponent('ทดสอบเสนอ_user')}&th=${encodeURIComponent('ทดสอบเสนอ')}&en=test`, { method: 'POST', body: clip });
check('user can propose a new word with a name', p2.ok);
const list = (await (await call(admin, '/api/user/proposals')).json()).proposals;
const mine = list.filter((p) => p.label === 'ชอบ_var_1' || p.label === 'ทดสอบเสนอ_user');
check('admin sees both proposals', mine.length >= 2, mine.map((p) => `${p.label} by ${p.by}`).join(', '));
check('proposer is the session user, not the "by" sent by the client', mine.every((p) => p.by === userName));
const after = (await (await call(admin, '/api/user/samples')).json()).counts;
check('pending samples are not counted for training', JSON.stringify(after) === JSON.stringify(before));
const frames = await call(admin, `/api/user/proposals/${mine[0].id}/frames`);
check('admin can load a proposal for the preview', frames.ok && (await frames.arrayBuffer()).byteLength === 30 * 543 * 3 * 4);
const rej = await call(admin, '/api/user/proposals/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: mine.map((p) => p.id), action: 'reject' }) });
const rejData = await rej.json();
check('admin rejects them; nothing reaches the training data', rej.ok && rejData.done === mine.length && JSON.stringify(rejData.counts) === JSON.stringify(before));
await call(user, '/api/auth/logout', { method: 'POST' });
await call(admin, '/api/auth/logout', { method: 'POST' });
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
