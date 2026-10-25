// ---------- views ----------
// Each screen is a <section>. Opening one pushes a history entry so the
// Android back button returns to the previous screen instead of closing the app.

let current = null; // null = home, or {view, cat}

function show(id) {
  for (const s of document.querySelectorAll('body > section')) s.hidden = s.id !== id;
}

function render(state) {
  current = state;
  hideUndo();
  if (!state) {
    show('home'); // first, so renderHome can measure the free height (fitGlance)
    renderHome();
  } else if (state.view === 'edit') {
    setLabel($('editor-title'), state.cat);
    // Enter adds the note, except in a schedule, where it starts a new line.
    textarea.enterKeyHint = state.cat === SCHEDULE ? 'enter' : 'send';
    $('editor-tools').hidden = state.cat === SCHEDULE;
    renderRecent(state.cat);
    show('editor');
    fitText(true);
  } else if (state.view === 'entries') {
    renderEntries(state.cat);
    show('entries');
  } else if (state.view === 'schedule') {
    renderSchedule(state, true);
    show('schedule');
  } else if (state.view === 'login') {
    show('login');
  } else if (state.view === 'help') {
    show('help');
  }
  window.scrollTo(0, 0);
}

// Redraw the current screen after a sync brought in changes. In the editor only
// the recent notes above the text box are redrawn, so nothing jumps while typing.
function refreshView() {
  if (!current) renderHome();
  else if (current.view === 'entries') renderEntries(current.cat);
  else if (current.view === 'schedule') renderSchedule(current);
  else if (current.view === 'edit') renderRecent(current.cat);
}

function go(state) {
  history.pushState(state, '');
  render(state);
}

window.addEventListener('popstate', (e) => {
  if (current && current.view === 'edit') {
    if (commitEditor()) sync();
    // Saved notes that were already there: say so on the screen we go back to.
    if (skippedMessage() && !pendingUndo) pendingUndo = [skippedMessage()];
  }
  let state = e.state;
  // Back on the schedule screen after saving one: show the day it was saved for.
  if (savedDay && state && state.view === 'schedule') {
    state = { view: 'schedule', date: savedDay === dayKey(new Date()) ? null : savedDay };
    history.replaceState(state, '');
  }
  savedDay = null;
  render(state);
  // Discard leaves the editor through history.back(), so its Undo can only be
  // shown once the home screen has rendered.
  if (pendingUndo) {
    showUndo(...pendingUndo);
    pendingUndo = null;
  }
});

for (const btn of document.querySelectorAll('.back')) {
  btn.addEventListener('click', () => history.back());
}

// ---------- undo ----------
// Deleting a note or discarding a draft happens straight away, with an Undo
// banner instead of a confirm dialog. Only the latest action can be undone, and
// the banner goes away when the screen changes.

let undoAction = null;
let pendingUndo = null; // [message, action] to show after the next popstate

// With no action it's just a message, with no Undo button (a note that was already there).
function showUndo(message, action = null) {
  undoAction = action;
  $('undo-msg').textContent = message;
  $('undo-btn').hidden = !action;
  $('undo-bar').hidden = false;
}

function hideUndo() {
  undoAction = null;
  $('undo-bar').hidden = true;
}

$('undo-btn').addEventListener('click', () => {
  const action = undoAction;
  hideUndo();
  action();
});
