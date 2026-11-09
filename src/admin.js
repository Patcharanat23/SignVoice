import './icons.js';
// Admin page. Every value from the database is shown with textContent (never innerHTML), so a
// display name like "<img onerror=...>" is shown as text instead of running.
import './theme.js';
import { initTutorial } from './tutorial.js';
const $ = (id) => document.getElementById(id);
const when = (ms) => (ms ? new Date(ms).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const EVENTS = { login: 'เข้าสู่ระบบ', login_fail: 'รหัสผิด', login_locked: 'ถูกล็อกอยู่', account_locked: 'ล็อกบัญชี', login_disabled: 'บัญชีถูกระงับ', register: 'สมัครสมาชิก', admin_update: 'แอดมินแก้ไข', admin_delete: 'แอดมินลบ' };
let me = null;

function cell(row, text, className) {
  const td = row.insertCell();
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function button(label, onClick, className = 'ghost small') {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

async function change(user, body, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  const response = await fetch(`/api/admin/users/${user.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  $('admin-error').textContent = response.ok ? '' : data.error;
  if (response.ok) renderUsers(data.users);
}

function renderUsers(users) {
  $('stat-users').textContent = users.length;
  const body = $('users').tBodies[0];
  body.replaceChildren();
  for (const u of users) {
    const row = body.insertRow();
    cell(row, u.username, 'mono');
    cell(row, u.displayName);
    cell(row, u.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้', u.role === 'admin' ? 'badge' : '');
    cell(row, u.disabled ? 'ถูกระงับ' : u.locked ? 'ล็อกชั่วคราว' : 'ปกติ', u.disabled || u.locked ? 'warn' : 'muted');
    cell(row, when(u.createdAt), 'muted');
    cell(row, when(u.lastLogin), 'muted');
    const actions = row.insertCell();
    actions.className = 'actions';
    if (u.id === me.id) { actions.textContent = '(คุณ)'; continue; }
    if (!u.envAdmin) actions.append(button(u.role === 'admin' ? 'ลดเป็นผู้ใช้' : 'ตั้งเป็นแอดมิน', () => change(u, { role: u.role === 'admin' ? 'user' : 'admin' })));
    if (u.locked) actions.append(button('ปลดล็อก', () => change(u, { unlock: true })));
    actions.append(button(u.disabled ? 'เปิดใช้' : 'ระงับ', () => change(u, { disabled: !u.disabled })));
    actions.append(button('ลบ', () => change(u, { delete: true }, `ลบบัญชี ${u.username}? ย้อนกลับไม่ได้`), 'danger small'));
  }
}

async function load() {
  const meResponse = await fetch('/api/auth/me');
  if (!meResponse.ok) return location.replace('/login.html');
  me = (await meResponse.json()).user;
  if (me.role !== 'admin') return location.replace('/');
  if ($('me')) $('me').textContent = `${me.displayName} (${me.username})`;
  if (location.pathname === '/admin.html' || document.body.classList.contains('admin-view')) initTutorial('admin');
  const data = await (await fetch('/api/admin/users')).json();
  renderUsers(data.users);
  const log = $('auth-log').tBodies[0];
  log.replaceChildren();
  for (const e of data.log) {
    const row = log.insertRow();
    cell(row, when(e.at), 'muted');
    cell(row, EVENTS[e.event] || e.event, e.event.includes('fail') || e.event.includes('lock') ? 'warn' : '');
    cell(row, e.username || '—', 'mono');
    cell(row, e.ip || '', 'muted mono');
  }
  try {
    const stats = await (await fetch('/api/admin/stats')).json();
    $('stat-translations').textContent = stats.translations;
    $('stat-corrected').textContent = stats.corrected;
    $('stat-samples').textContent = stats.samples;
    $('stat-runs').textContent = stats.training_runs;
    $('stat-pending').textContent = stats.pending ?? 0;
    const list = $('confusions');
    list.replaceChildren();
    for (const line of stats.top_confusions.length ? stats.top_confusions : ['ยังไม่มีการแก้คำ']) {
      const li = document.createElement('li');
      li.textContent = line.replace(/_[^ ]*/g, '');
      list.append(li);
    }
  } catch { /* the ML service may still be starting */ }
}

$('logout')?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.replace('/login.html');
});

// ---- Proposed samples from non-admin users: preview, approve, reject ----
// Landmark layout per frame (543 x 3): face 0-467, left hand 468-488, pose 489-521, right hand 522-542.
const HAND = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const ARMS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];
let proposals = [];
let playing = 0;

function wordOf(p) { return p.th || p.label.split('_')[0]; }

function drawClip(frames, name) {
  const canvas = $('proposal-canvas');
  const ctx = canvas.getContext('2d');
  const n = frames.length / (543 * 3);
  const pt = (f, i) => {
    const o = (f * 543 + i) * 3;
    const x = frames[o], y = frames[o + 1];
    return Number.isNaN(x) ? null : [(1 - x) * canvas.width, y * canvas.height];  // mirrored like the camera view
  };
  const line = (f, a, b) => { const p = pt(f, a), q = pt(f, b); if (p && q) { ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke(); } };
  let f = 0;
  cancelAnimationFrame(playing);
  let last = 0;
  const tick = (t) => {
    if (t - last > 66) {  // ~15 fps, the speed the app records at
      last = t;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2;
      for (const [a, b] of ARMS) line(f, 489 + a, 489 + b);
      ctx.strokeStyle = '#fff';
      for (const base of [468, 522]) for (const [a, b] of HAND) line(f, base + a, base + b);
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '12px sans-serif';
      ctx.fillText(`${f + 1}/${n}`, 8, canvas.height - 8);
      f = (f + 1) % n;
    }
    playing = requestAnimationFrame(tick);
  };
  playing = requestAnimationFrame(tick);
  $('preview-label').textContent = `${name} · ${n} เฟรม`;
}

async function preview(p, row) {
  for (const r of $('proposals').tBodies[0].rows) r.classList.toggle('on', r === row);
  const response = await fetch(`/api/user/proposals/${p.id}/frames`);
  if (!response.ok) return;
  drawClip(new Float32Array(await response.arrayBuffer()), wordOf(p));
}

async function review(ids, action) {
  if (!ids.length) return;
  const response = await fetch('/api/user/proposals/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, action }) });
  const data = await response.json();
  $('admin-error').textContent = response.ok ? '' : data.error;
  if (response.ok) { renderProposals(data.proposals); load(); }
}

function renderProposals(list) {
  proposals = list;
  $('pending-count').textContent = list.length ? `(${list.length})` : '';
  const body = $('proposals').tBodies[0];
  body.replaceChildren();
  if (!list.length) {
    const row = body.insertRow();
    const td = row.insertCell(); td.colSpan = 5; td.className = 'muted'; td.textContent = 'ไม่มีท่าที่รออนุมัติ';
    return;
  }
  for (const p of list) {
    const row = body.insertRow();
    cell(row, `${wordOf(p)}${p.en ? ` (${p.en})` : ''}${p.label.endsWith('_user') && p.th ? ' · คำใหม่' : ''}`);
    cell(row, p.by || '—', 'mono');
    cell(row, when(p.at * 1000), 'muted');
    const ratio = p.hand_frames / p.frames;
    cell(row, `${Math.round(ratio * 100)}% ของ ${p.frames} เฟรม`, ratio < 0.3 ? 'warn' : 'muted');
    const actions = row.insertCell();
    actions.className = 'actions';
    actions.append(button('อนุมัติ', (e) => { e.stopPropagation(); review([p.id], 'approve'); }), button('ปฏิเสธ', (e) => { e.stopPropagation(); review([p.id], 'reject'); }, 'danger small'));
    row.addEventListener('click', () => preview(p, row));
  }
}

async function loadProposals() {
  const response = await fetch('/api/user/proposals');
  if (response.ok) renderProposals((await response.json()).proposals);
}
$('approve-all').addEventListener('click', () => review(proposals.map((p) => p.id), 'approve'));
$('reject-all').addEventListener('click', () => { if (confirm(`ปฏิเสธทั้งหมด ${proposals.length} ท่า?`)) review(proposals.map((p) => p.id), 'reject'); });
export function mountAdmin() {
  void load();
  void loadProposals();
}

export function unmountAdmin() {
  cancelAnimationFrame(playing);
  playing = 0;
}

if (location.pathname === '/admin.html') mountAdmin();
