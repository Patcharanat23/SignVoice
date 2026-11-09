import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAuth, rateLimiter, sameOrigin, sessionCookie } from './auth.mjs';

function fresh(options) {
  const dir = mkdtempSync(join(tmpdir(), 'sv-auth-'));
  const auth = createAuth(join(dir, 'test.db'), options);
  return { auth, dir, done: () => { auth.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('first account is admin, later ones are users; passwords are stored as scrypt hashes', async () => {
  const { auth, dir, done } = fresh();
  assert.equal((await auth.register({ username: 'Pat', password: 'secret123' })).user.role, 'admin');
  assert.equal((await auth.register({ username: 'friend', password: 'secret456' })).user.role, 'user');
  const db = new DatabaseSync(join(dir, 'test.db'));
  const rows = db.prepare('SELECT username, password_hash FROM users').all();
  db.close();
  assert.equal(rows[0].username, 'pat');  // usernames are case-insensitive
  for (const r of rows) {
    assert.match(r.password_hash, /^scrypt\$16384\$/);
    assert.ok(!r.password_hash.includes('secret'));
  }
  done();
});

test('registration rejects weak passwords, bad names and duplicates', async () => {
  const { auth, done } = fresh();
  assert.ok((await auth.register({ username: 'abc', password: 'short1' })).error);
  assert.ok((await auth.register({ username: 'abc', password: 'onlyletters' })).error);
  assert.ok((await auth.register({ username: 'abc', password: 'abc12345' })).error);  // contains the username
  assert.ok((await auth.register({ username: 'a b<script>', password: 'secret123' })).error);
  assert.ok((await auth.register({ username: 'abc', password: 'secret123' })).user);
  assert.ok((await auth.register({ username: 'ABC', password: 'secret123' })).error);
  done();
});

test('login, session lookup and logout; the stored session is a hash of the token', async () => {
  const { auth, dir, done } = fresh();
  await auth.register({ username: 'pat', password: 'secret123' });
  assert.equal((await auth.login({ username: 'pat', password: 'wrong999' })).error, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  assert.equal((await auth.login({ username: 'nobody', password: 'wrong999' })).error, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');  // same message
  const { token, user } = await auth.login({ username: 'pat', password: 'secret123' });
  assert.equal(user.username, 'pat');
  assert.equal(auth.sessionUser(token).username, 'pat');
  assert.equal(auth.sessionUser(token + 'x'), null);
  const db = new DatabaseSync(join(dir, 'test.db'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(token).n, 0);
  db.close();
  auth.logout(token);
  assert.equal(auth.sessionUser(token), null);
  done();
});

test('5 wrong passwords lock the account for 15 minutes', async () => {
  const { auth, done } = fresh();
  await auth.register({ username: 'pat', password: 'secret123' });
  for (let i = 0; i < 5; i++) await auth.login({ username: 'pat', password: 'wrong999' });
  const locked = await auth.login({ username: 'pat', password: 'secret123' });
  assert.match(locked.error, /ล็อก/);
  done();
});

test('admins can disable users (ending their sessions) but not edit themselves', async () => {
  const { auth, done } = fresh();
  const admin = (await auth.register({ username: 'admin1', password: 'secret123' })).user;
  const friend = (await auth.register({ username: 'friend', password: 'secret456' })).user;
  const { token } = await auth.login({ username: 'friend', password: 'secret456' });
  assert.ok(auth.updateUser(admin, admin.id, { role: 'user' }).error);
  auth.updateUser(admin, friend.id, { disabled: true });
  assert.equal(auth.sessionUser(token), null);
  assert.ok((await auth.login({ username: 'friend', password: 'secret456' })).error);
  auth.updateUser(admin, friend.id, { disabled: false, role: 'admin' });
  assert.equal((await auth.login({ username: 'friend', password: 'secret456' })).user.role, 'admin');
  done();
});

test('SIGNVOICE_ADMINS names are always admins', async () => {
  const { auth, done } = fresh({ admins: ['teacher'] });
  await auth.register({ username: 'first', password: 'secret123' });
  assert.equal((await auth.register({ username: 'teacher', password: 'secret123' })).user.role, 'admin');
  done();
});

test('rate limiter, same-origin check and cookie flags', () => {
  const limit = rateLimiter(3, 60_000);
  assert.deepEqual([1, 2, 3, 4].map(() => limit.allow('ip')), [true, true, true, false]);
  assert.equal(limit.allow('other-ip'), true);
  assert.equal(limit.blocked('ip'), true);
  assert.equal(limit.blocked('other-ip'), false);
  const req = (headers, method = 'POST') => ({ method, headers: { host: 'localhost:5173', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  assert.equal(sameOrigin(req({ origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(sameOrigin(req({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(sameOrigin(req({ origin: 'https://evil.example' })), false);
  assert.equal(sameOrigin(req({ origin: 'https://evil.example' }, 'GET')), true);
  const cookie = sessionCookie(req({}), 'abc');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.doesNotMatch(cookie, /Secure/);
  assert.match(sessionCookie(req({ 'x-forwarded-proto': 'https' }), 'abc'), /Secure/);
});
