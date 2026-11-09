// First thing in <body> of index.html: pick the speak layout before anything paints, so
// "/?view=speak" never shows the teach layout for a moment. main.js sets the same class later.
const initialView = new URLSearchParams(location.search).get('view');
if (initialView === 'speak') document.body.classList.add('speak-view');
if (initialView === 'admin') document.body.classList.add('admin-view');
