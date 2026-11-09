import './icons.js';
import './theme.js';
import { initTutorial } from './tutorial.js';
// Login / register page. The server does all checks; this only gives quick feedback.
const $ = (id) => document.getElementById(id);
let registering = false;

function setMode(register) {
  registering = register;
  $('tab-login').classList.toggle('on', !register);
  $('tab-register').classList.toggle('on', register);
  $('tab-login').setAttribute('aria-selected', String(!register));
  $('tab-register').setAttribute('aria-selected', String(register));
  for (const el of document.querySelectorAll('.register-only')) el.hidden = !register;
  $('form-title').textContent = register ? 'สร้างบัญชีใหม่' : 'ยินดีต้อนรับกลับ';
  $('form-sub').textContent = register ? 'ตั้งชื่อผู้ใช้และรหัสผ่านเพื่อเริ่มใช้งาน' : 'เข้าสู่ระบบเพื่อเริ่มใช้งาน';
  $('submit').textContent = register ? 'สมัครและเข้าสู่ระบบ' : 'เข้าสู่ระบบ';
  $('password').autocomplete = register ? 'new-password' : 'current-password';
  $('form-error').textContent = '';
}

function strength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Za-z]/.test(password) && /\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password) || /[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  return score;
}

$('tab-login').addEventListener('click', () => setMode(false));
$('tab-register').addEventListener('click', () => setMode(true));
$('toggle-password').addEventListener('click', () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('toggle-password').textContent = show ? 'ซ่อน' : 'แสดง';
});
$('password').addEventListener('input', () => {
  const s = strength($('password').value);
  $('strength-bar').style.width = `${s * 25}%`;
  $('strength-text').textContent = ['อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข', 'อ่อน', 'พอใช้', 'ดี', 'แข็งแรง'][s];
});

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = $('username').value.trim().toLowerCase();
  const password = $('password').value;
  const error = (text) => { $('form-error').textContent = text; };
  if (!/^[a-z0-9_.]{3,32}$/.test(username)) return error('ชื่อผู้ใช้ใช้ได้เฉพาะ a–z 0–9 _ . ยาว 3–32 ตัว');
  if (registering) {
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัว และมีทั้งตัวอักษรและตัวเลข');
    if (password !== $('password2').value) return error('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
  }
  $('submit').disabled = true;
  try {
    const response = await fetch(registering ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ username, password, displayName: $('display-name').value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return error(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
    location.replace('/');
  } catch {
    error('ยังเชื่อมต่อไม่ได้ ลองอีกครั้งสักครู่');
  } finally {
    $('submit').disabled = false;
    $('password').value = '';
    $('password2').value = '';
  }
});

// ---- Slideshow of real screens: arrows, numbered tabs, keyboard, auto-advance (paused on hover) ----
const slides = [...document.querySelectorAll('.slide')];
const tabs = [...document.querySelectorAll('.carousel-tabs [data-slide]')];
let current = 0;
let timer = 0;
function show(index) {
  current = (index + slides.length) % slides.length;
  slides.forEach((s, i) => s.classList.toggle('on', i === current));
  tabs.forEach((t, i) => { t.classList.toggle('on', i === current); t.setAttribute('aria-selected', String(i === current)); });
  $('slide-title').textContent = tabs[current].dataset.title;
  $('slide-text').textContent = tabs[current].dataset.text;
}
const play = () => { clearInterval(timer); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => show(current + 1), 6000); };
tabs.forEach((t) => t.addEventListener('click', () => { show(Number(t.dataset.slide)); play(); }));
$('slide-prev').addEventListener('click', () => { show(current - 1); play(); });
$('slide-next').addEventListener('click', () => { show(current + 1); play(); });
$('carousel').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { show(current - 1); play(); }
  if (e.key === 'ArrowRight') { show(current + 1); play(); }
});
$('carousel').addEventListener('mouseenter', () => clearInterval(timer));
$('carousel').addEventListener('mouseleave', play);
show(0);
play();
initTutorial('login');
