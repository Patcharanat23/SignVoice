// Runs in <head> before the stylesheets paint, so switching pages never flashes the wrong theme.
// (theme.js applies the same value again once the app's modules load.)
(function () {
  var theme = 'light';
  try { theme = localStorage.getItem('signvoice-theme') || 'light'; } catch (e) { /* private mode */ }
  document.documentElement.dataset.theme = theme;
})();
