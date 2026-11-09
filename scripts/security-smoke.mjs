// Security checks against a running server (start it with SIGNVOICE_AUTH_DB=<throw-away file>):
//   node scripts/security-smoke.mjs
// Creates the accounts sec_admin / sec_user if missing (the first one in an empty database is admin).
const base = process.env.APP_URL || 'http://127.0.0.1:5174';
// This test creates accounts and triggers the login lockout, so it must never hit the real app.
if (new URL(base).port === '5173' && !process.env.SV_SECURITY_TEST_REAL) {
  console.error('Refusing to run against port 5173 (the real app). Start a test server with SIGNVOICE_AUTH_DB=<temp file> PORT=5174.');
  process.exit(2);
}
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: base, ...headers }, body: JSON.stringify(body) });
const get = (path, headers = {}) => fetch(base + path, { redirect: 'manual', headers });

async function account(username, password) {
  let r = await post('/api/auth/login', { username, password });
  if (!r.ok) r = await post('/api/auth/register', { username, password });
  return { cookie: r.headers.get('set-cookie')?.split(';')[0], setCookie: r.headers.get('set-cookie'), user: (await r.json()).user };
}

const admin = await account('sec_admin', 'Admin-pass-2569');
const user = await account('sec_user', 'User-pass-2569');
check('first account is admin', admin.user?.role === 'admin', admin.user?.role);
check('second account is a normal user', user.user?.role === 'user', user.user?.role);
check('session cookie is HttpOnly + SameSite=Strict', /HttpOnly/.test(admin.setCookie) && /SameSite=Strict/.test(admin.setCookie));

// Pages and API need a session
check('app page redirects to login without a session', (await get('/')).headers.get('location') === '/login.html');
check('admin page redirects to login without a session', (await get('/admin.html')).headers.get('location') === '/login.html');
check('API refuses requests without a session (401)', (await get('/api/user/samples')).status === 401);
check('API refuses a forged session cookie (401)', (await get('/api/user/samples', { cookie: 'sv_session=forged' })).status === 401);
check('logged-in user can use the API', (await get('/api/user/samples', { cookie: user.cookie })).status === 200);

// Roles
check('normal user is sent away from admin.html', (await get('/admin.html', { cookie: user.cookie })).headers.get('location') === '/');
check('normal user cannot call admin API (403)', (await get('/api/admin/users', { cookie: user.cookie })).status === 403);
check('normal user cannot change the vocabulary (403)', (await post('/api/user/words', { label: 'x_user', th: 'x' }, { cookie: user.cookie })).status === 403);
check('normal user cannot start training (403)', (await post('/api/user/finetune', {}, { cookie: user.cookie })).status === 403);
// fetch() normalises "/x/../y" before sending, so these go out as raw HTTP requests.
const { request } = await import('node:http');
const rawPost = (path, cookie) => new Promise((resolve, reject) => {
  const u = new URL(base);
  const r = request({ host: u.hostname, port: u.port, method: 'POST', path, headers: { cookie, origin: base, 'content-type': 'application/json', 'content-length': 2 } }, (res) => { res.resume(); resolve(res.statusCode); });
  r.on('error', reject);
  r.end('{}');
});
for (const trick of ['/api/user/x/../finetune', '/api/user/x/%2e%2e/finetune', '/api/user/x%2f..%2ffinetune', '/api/user/x/../proposals/review']) {
  check(`dot-segment path cannot bypass admin checks: ${trick}`, (await rawPost(trick, user.cookie)) === 400);
}
check('admin can open the admin API', (await get('/api/admin/users', { cookie: admin.cookie })).status === 200);

// CSRF
check('cross-site POST is blocked (403)', (await post('/api/user/finetune', {}, { cookie: admin.cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status === 403);

// Input validation and enumeration
const weak = await post('/api/auth/register', { username: 'weakpw', password: '12345678' });
check('weak password rejected', weak.status === 400);
const a = await (await post('/api/auth/login', { username: 'sec_user', password: 'wrong-pass-1' })).json();
const b = await (await post('/api/auth/login', { username: 'no_such_user', password: 'wrong-pass-1' })).json();
check('same error for wrong password and unknown user', a.error === b.error, a.error);
check('oversized body rejected (400)', (await post('/api/auth/login', { username: 'x', password: 'y'.repeat(20000) })).status === 400);

// Headers
const page = await get('/login.html');
const csp = page.headers.get('content-security-policy') || '';
check('Content-Security-Policy set', csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"));
check('X-Frame-Options DENY + nosniff', page.headers.get('x-frame-options') === 'DENY' && page.headers.get('x-content-type-options') === 'nosniff');

// Logout ends the session server-side
const temp = await account('sec_user', 'User-pass-2569');
await post('/api/auth/logout', {}, { cookie: temp.cookie });
check('session is invalid after logout', (await get('/api/user/samples', { cookie: temp.cookie })).status === 401);

// Brute force: per-IP login limit (10 per 15 min); run last because it blocks further logins from this IP
let limited = false;
for (let i = 0; i < 12 && !limited; i++) limited = (await post('/api/auth/login', { username: 'sec_user', password: `guess-${i}x` })).status === 429;
check('login is rate-limited (429) after repeated attempts', limited);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
