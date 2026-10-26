// ---------- keyboard ----------
// Shortcuts for using the app on a computer. The help screen lists them, so
// update its "On a computer" list in index.html when they change.

// Esc goes back, saving the editor first just as Save and the back button do.
// On the home screen it closes the menu or clears the search instead.
function onEscape() {
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
  if (key === 'escape') onEscape();
  else if (ctrl && (key === 'enter' || key === 's') && current && current.view === 'edit') history.back();
  else return;
  e.preventDefault();
  e.stopPropagation();
}, true);

// Clicks a button if it's showing, the same as tapping it. Returns false if it isn't.
function press(id) {
  const btn = $(id);
  if (btn.hidden || btn.style.visibility === 'hidden') return false;
  btn.click();
  return true;
}

// Single keys, for when nothing's being typed. Returns false for a key that does
// nothing here, so the browser gets it. The editor's focus() works from a key
// press as it does from a tap.
function shortcut(key) {
  const view = current ? current.view : 'home';
  if (key === '?' && view !== 'help') go({ view: 'help' });
  else if ((key === 'u' || key === 'ctrl+z') && !$('undo-bar').hidden && !$('undo-btn').hidden) $('undo-btn').click();
  else if (view === 'home') {
    setMenu(false);
    // 1 to 7 are the built-in categories in BUILT_IN order, clockwise from Todo at the top.
    if (key === 'a' || key === 'e') openEditor(AUTO);
    else if (key === '/') $('search').focus();
    else if (key >= '1' && key <= String(BUILT_IN.length)) openCategory(BUILT_IN[key - 1]);
    else return false;
  } else if (view === 'entries') {
    if (key === 'a' || key === 'e') openEditor(current.cat);
    else if (key === 't') $('times-btn').click();
    else return false;
  } else if (view === 'schedule') {
    if (key === 'e') return press('schedule-edit-btn') || press('schedule-new-btn');
    if (key === 'a' || key === 'n') return press('schedule-new-btn');
    if (key === 's') return press('schedule-past-btn');
    if (key === 'arrowleft' || key === 'arrowright') return press(key === 'arrowleft' ? 'day-prev' : 'day-next');
    return false;
  } else return false;
  return true;
}

document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.altKey || e.target.matches('input, textarea')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  // The only shortcut with Ctrl is Ctrl+Z, so the browser's own Ctrl shortcuts still work.
  if (ctrl && key !== 'z') return;
  if (shortcut(ctrl ? 'ctrl+z' : key)) e.preventDefault();
});
