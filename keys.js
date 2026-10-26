// ---------- keyboard ----------
// Shortcuts for using the app on a computer. The help screen lists them, so
// update its "On a computer" list in index.html when they change.

// Esc goes back, saving the editor first just as Save and the back button do.
// On the home screen it closes the menu or clears the search instead.
function escape() {
  if (current) history.back();
  else if (!$('menu').hidden) setMenu(false);
  else if ($('search').value || document.activeElement === $('search')) {
    clearSearch();
    $('search').blur();
  }
}

// Caught on the way down, so Ctrl+Enter gets here before the text box's own
// Enter handler. It saves even in a schedule, where Enter starts a new line.
document.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (key === 'escape') escape();
  else if (ctrl && (key === 'enter' || key === 's') && current && current.view === 'edit') history.back();
  else return;
  e.preventDefault();
  e.stopPropagation();
}, true);
