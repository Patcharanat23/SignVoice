// Light (default) or dark theme, remembered per browser. Any element with [data-theme-toggle] switches it.
import { icon } from './icons.js';
const KEY = 'signvoice-theme';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export function applyTheme(theme = read() || 'light') {
  document.documentElement.dataset.theme = theme;
  for (const b of document.querySelectorAll('[data-theme-toggle]')) {
    b.innerHTML = icon(theme === 'light' ? 'moon' : 'sun');
    b.title = theme === 'light' ? 'ธีมดำ' : 'ธีมขาว';
  }
  return theme;
}
applyTheme();
document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-theme-toggle]')) return;
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem(KEY, next); } catch { /* private mode: not remembered */ }
  applyTheme(next);
});
