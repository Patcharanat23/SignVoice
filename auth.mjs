// Accounts, sessions and request security for server.mjs.
//
// - Passwords: scrypt (N=16384, r=8, p=1, 64-byte key) with a random 16-byte salt per user; compared
//   with timingSafeEqual. Plain passwords are never stored or logged.
// - Sessions: 32 random bytes in an HttpOnly, SameSite=Strict cookie (Secure when served over HTTPS);
//   only the SHA-256 of the token is stored, so a copied database cannot be used to log in.
//   12-hour idle timeout, 7-day maximum; a new token on every login; logout deletes it server-side.
// - Brute force: per-IP limits on login (10 / 15 min) and registration (5 / hour), and an account is
//   locked for 15 minutes after 5 wrong passwords in a row. Errors never say which part was wrong.
// - CSRF: state-changing requests must come from the same origin (Origin / Sec-Fetch-Site check)
//   in addition to SameSite=Strict cookies.
// - Roles: 'admin' or 'user'. The first account becomes admin; SIGNVOICE_ADMINS (comma-separated
//   usernames) are always admins. Only admins can change shared data (vocabulary, samples, training).
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const IDLE_MS = 12 * 3600_000;
const MAX_MS = 7 * 24 * 3600_000;
const COOKIE = 'sv_session';
export const USERNAME = /^[a-z0-9_.]{3,32}$/;

export function createAuth(dbPath, { admins = [] } = {}) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0,
      failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, last_login INTEGER);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, ip TEXT, user_agent TEXT);
    CREATE TABLE IF NOT EXISTS auth_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, event TEXT NOT NULL, username TEXT, ip TEXT);`);
  const adminSet = new Set(admins.map((a) => a.trim().toLowerCase()).filter(Boolean));
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const log = (event, username, ip) => db.prepare('INSERT INTO auth_log(at, event, username, ip) VALUES (?,?,?,?)').run(Date.now(), event, username ?? null, ip ?? null);

  async function hashPassword(password) {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, 64, SCRYPT);
    return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
  }
  async function verifyPassword(password, stored) {
    const [, n, salt, key] = stored.split('$');
    const expected = Buffer.from(key, 'base64');
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { ...SCRYPT, N: Number(n) });
    return timingSafeEqual(actual, expected);
  }
  // A real hash to compare against when the username does not exist, so timing does not reveal it.
  const dummyHash = hashPassword(randomBytes(12).toString('hex'));

  const publicUser = (u) => u && { id: u.id, username: u.username, displayName: u.display_name, role: adminSet.has(u.username) ? 'admin' : u.role };

  function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) return 'รหัสผ่านต้องยาว 8–128 ตัวอักษร';
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข';
    return null;
  }

  async function register({ username, password, displayName }, ip) {
    username = String(username || '').trim().toLowerCase();
    displayName = String(displayName || username).trim().slice(0, 40);
    if (!USERNAME.test(username)) return { error: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a–z 0–9 _ . ยาว 3–32 ตัว' };
    const bad = validatePassword(password);
    if (bad) return { error: bad };
    if (password.toLowerCase().includes(username)) return { error: 'รหัสผ่านต้องไม่มีชื่อผู้ใช้อยู่ข้างใน' };
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return { error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' };
    const first = !db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get();
    const role = first || adminSet.has(username) ? 'admin' : 'user';
    const info = db.prepare('INSERT INTO users(username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)')
      .run(username, displayName || username, await hashPassword(password), role, Date.now());
    log('register', username, ip);
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) };
  }

  async function login({ username, password }, ip, userAgent) {
    username = String(username || '').trim().toLowerCase();
    const fail = { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || typeof password !== 'string' || password.length > 128) {
      await verifyPassword('x', await dummyHash).catch(() => false);
      log('login_fail', username, ip);
      return fail;
    }
    if (user.locked_until > Date.now()) {
      log('login_locked', username, ip);
      return { error: `บัญชีถูกล็อกชั่วคราว ลองใหม่ใน ${Math.ceil((user.locked_until - Date.now()) / 60000)} นาที` };
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      const failed = user.failed_logins + 1;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
        .run(failed >= 5 ? 0 : failed, failed >= 5 ? Date.now() + 15 * 60_000 : 0, user.id);
      log(failed >= 5 ? 'account_locked' : 'login_fail', username, ip);
      return fail;
    }
    if (user.disabled) {
      log('login_disabled', username, ip);
      return { error: 'บัญชีนี้ถูกระงับ ติดต่อผู้ดูแลระบบ' };
    }
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0, last_login = ? WHERE id = ?').run(Date.now(), user.id);
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(token_hash, user_id, created_at, last_seen, ip, user_agent) VALUES (?,?,?,?,?,?)')
      .run(sha(token), user.id, Date.now(), Date.now(), ip, String(userAgent || '').slice(0, 200));
    log('login', username, ip);
    return { token, user: publicUser(user) };
  }

  function sessionUser(token) {
    if (!token) return null;
    const now = Date.now();
    const row = db.prepare(`SELECT s.token_hash, s.created_at, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha(token));
    if (!row) return null;
    if (row.disabled || now - row.last_seen > IDLE_MS || now - row.created_at > MAX_MS) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
      return null;
    }
    if (now - row.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, row.token_hash);
    return publicUser(row);
  }

  const logout = (token) => token && db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));

  // ---- admin ----
  const listUsers = () => db.prepare('SELECT * FROM users ORDER BY id').all().map((u) => ({
    ...publicUser(u), disabled: !!u.disabled, createdAt: u.created_at, lastLogin: u.last_login, locked: u.locked_until > Date.now(),
    envAdmin: adminSet.has(u.username)
  }));
  function updateUser(actor, id, change) {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
    if (!target) return { error: 'ไม่พบผู้ใช้' };
    if (target.id === actor.id) return { error: 'แก้ไขบัญชีของตัวเองจากหน้านี้ไม่ได้' };
    if (change.delete) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    } else {
      if (change.role === 'admin' || change.role === 'user') db.prepare('UPDATE users SET role = ? WHERE id = ?').run(change.role, target.id);
      if (typeof change.disabled === 'boolean') {
        db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(change.disabled ? 1 : 0, target.id);
        if (change.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      }
      if (change.unlock) db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(target.id);
    }
    log(`admin_${change.delete ? 'delete' : 'update'}`, `${actor.username} -> ${target.username}`, null);
    return { users: listUsers() };
  }
  const recentLog = () => db.prepare('SELECT at, event, username, ip FROM auth_log ORDER BY id DESC LIMIT 50').all();
  const cleanup = () => db.prepare('DELETE FROM sessions WHERE last_seen < ? OR created_at < ?').run(Date.now() - IDLE_MS, Date.now() - MAX_MS);

  return { register, login, logout, sessionUser, listUsers, updateUser, recentLog, cleanup, validatePassword, close: () => db.close() };
}

// ---- request helpers ----
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export const sessionToken = (req) => parseCookies(req.headers.cookie)[COOKIE];

// HTTPS when served directly with a certificate, or behind a local TLS proxy such as Cloudflare Tunnel.
export const isHttps = (req) => req.socket.encrypted || (isLoopback(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https');
const isLoopback = (ip = '') => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || trustProxy;
// In Docker the tunnel/proxy is not on loopback. SIGNVOICE_TRUST_PROXY=1 trusts its headers; only safe when
// the port is reachable from the proxy alone (docker-compose.yml publishes it on 127.0.0.1).
const trustProxy = process.env.SIGNVOICE_TRUST_PROXY === '1';
// Behind a local proxy (Cloudflare Tunnel) the visitor's address is in a header the proxy sets.
export const clientIp = (req) => (isLoopback(req.socket.remoteAddress) && (req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())) || req.socket.remoteAddress || '';

export function sessionCookie(req, token, maxAgeMs = MAX_MS) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${isHttps(req) ? '; Secure' : ''}`;
}
export const clearCookie = (req) => sessionCookie(req, '', 0);

/** Same-origin check for state-changing requests (CSRF defence in depth on top of SameSite=Strict). */
export function sameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return !site || site === 'same-origin' || site === 'none';
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Fixed-window counter per key: allow(key) is false once `limit` hits happen within `windowMs`. */
export function rateLimiter(limit, windowMs) {
  const hits = new Map();
  return {
    allow(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || now - entry.start > windowMs) {
        hits.set(key, { start: now, count: 1 });
        if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
        return true;
      }
      entry.count += 1;
      return entry.count <= limit;
    },
    /** True when `key` already used up its attempts (does not count as an attempt). */
    blocked(key) {
      const entry = hits.get(key);
      return !!entry && Date.now() - entry.start <= windowMs && entry.count >= limit;
    },
    retryAfter(key) {
      const entry = hits.get(key);
      return entry ? Math.max(1, Math.ceil((entry.start + windowMs - Date.now()) / 1000)) : 0;
    }
  };
}

/** Security headers for every response. The CSP allows only this origin (MediaPipe needs WebAssembly). */
export function securityHeaders(req, production) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    // microphone=(self): only to list audio output devices by name for the virtual-microphone option
    'permissions-policy': 'camera=(self), microphone=(self), speaker-selection=(self), geolocation=()',
    'cross-origin-opener-policy': 'same-origin'
  };
  if (production) {
    headers['content-security-policy'] = [
      "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:", "media-src 'self' blob:", "connect-src 'self'", "worker-src 'self' blob:",
      "font-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
    ].join('; ');
  }
  if (isHttps(req)) headers['strict-transport-security'] = 'max-age=31536000';
  return headers;
}
