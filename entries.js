// ---------- read ----------
// Times are hidden by default to keep the list compact. The choice is per
// category and per device: {categoryName: true} for the ones showing times.

const TIMES_KEY = 'quicknotes-times-by-category';
localStorage.removeItem('quicknotes-show-times');
const showTimes = readJSON(TIMES_KEY) || {};

function timesShown(cat) {
  return showTimes[cat] === true;
}

const TRASH_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/></svg>';

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 12l5 5L20 6"/></svg>';

// Lists of things to get done, and every project. Their notes get a tick, which
// marks one done, instead of the trash button; swiping a note sideways deletes it instead.
const CHECK_OFF = ['Todo', 'Buy', 'Bring', 'Working on', 'Random projs'];
const checksOff = (cat) => CHECK_OFF.includes(cat) || !BUILT_IN.includes(cat);

const REPLACE_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/></svg>';

// Notes here aren't tasks to swap for the next one, so they get no Replace button.
const NO_REPLACE = ['Journal', 'Thought', 'Random projs', 'Bring'];
const replaces = (cat) => !NO_REPLACE.includes(cat);

function formatShort(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatFull(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// The text of a note, with its time above it when its category shows times, and
// its folder above that when withFolder is set (the Add note editor).
// Also used by search and the editor.
function entryBody(entry, withFolder = false) {
  const body = document.createElement('div');
  body.className = 'entry-body';
  if (withFolder) {
    const folder = document.createElement('span');
    folder.className = 'entry-folder';
    folder.append(categoryIcon(entry.category, 16), entry.category);
    body.append(folder);
  }
  if (timesShown(entry.category)) {
    const time = document.createElement('time');
    time.textContent = formatShort(entry.createdAt);
    body.append(time);
  }
  const p = document.createElement('p');
  p.textContent = entry.text;
  body.append(p);
  return body;
}

// fresh = just opened, so no note is picked yet.
function renderEntries(cat, fresh = false) {
  if (fresh) picked = -1;
  setLabel($('entries-title'), cat);
  const box = $('entries-list');
  box.replaceChildren();
  const entries = entriesFor(cat);
  if (!entries.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No notes yet.';
    box.append(p);
  }
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.dataset.id = entry.id;
    const body = entryBody(entry);
    const { id } = entry;
    const checkOff = checksOff(cat);
    const del = checkOff ? iconButton('Done', CHECK_ICON) : iconButton('Delete', TRASH_ICON);
    del.addEventListener('click', () => removeEntry(id, checkOff ? 'done' : 'deleted'));
    if (checkOff) {
      div.classList.add('swipe');
      onSwipe(div, () => removeEntry(id, 'deleted'));
    }
    // Replace deletes the note and opens the editor for the next one (tick off a
    // task, write the one after it). Undo, back on this screen, brings the old one back.
    div.append(body);
    if (replaces(cat)) {
      const replace = iconButton('Replace', REPLACE_ICON);
      replace.addEventListener('click', () => {
        const entry = deleteEntry(id, 'replaced');
        if (!entry) return;
        pendingUndo = ['Old note deleted.', () => restoreEntry(entry)];
        openEditor(cat);
        sync();
      });
      div.append(replace);
    }
    div.append(del);
    box.append(div);
  }
  box.classList.toggle('with-times', timesShown(cat));
  $('times-btn').textContent = timesShown(cat) ? 'Hide times' : 'Show times';
  $('remove-project-btn').hidden = BUILT_IN.includes(cat);
  showPicked();
}

// ---------- picking a note from the keyboard ----------
// On a computer, ↓ and ↑ outline a note for keys.js to tick off, delete or
// replace. After one goes, the outline stays at the same place in the list,
// on the note that took its place, so a run of them can be ticked off in a row.
let picked = -1; // index in the list, or -1 for none

function showPicked(scroll = false) {
  const notes = $('entries-list').querySelectorAll('.entry');
  picked = Math.min(picked, notes.length - 1);
  notes.forEach((n, i) => n.classList.toggle('picked', i === picked));
  if (scroll && picked >= 0) notes[picked].scrollIntoView({ block: 'nearest' });
}

function movePick(step) {
  picked = Math.max(0, picked + step);
  showPicked(true);
}

function pickedNote() {
  return $('entries-list').querySelector('.entry.picked');
}

function iconButton(label, icon) {
  const btn = document.createElement('button');
  btn.className = 'entry-btn quiet';
  btn.setAttribute('aria-label', label);
  btn.innerHTML = icon;
  return btn;
}

// Looks the note up again, since `data` may have been reloaded since the list
// was drawn. Returns the deleted note, or null if it's already gone.
// `how` records what removed it ('deleted', 'done' or 'replaced'), for looking
// back at how notes get dealt with; the app itself doesn't use it.
function deleteEntry(id, how) {
  const entry = data.entries.find((e) => e.id === id);
  if (!entry) return null;
  touch(entry, { deletedAt: new Date().toISOString(), deletedHow: how });
  persist();
  return entry;
}

// Delete or tick off a note, with an Undo, and redraw whichever screen it was on.
function removeEntry(id, how) {
  const entry = deleteEntry(id, how);
  if (!entry) return;
  showUndo(how === 'done' ? 'Done.' : 'Note deleted.', () => restoreEntry(entry));
  refreshView();
  sync();
}

// The server treats a delete as final, so Undo brings the note back as a copy
// with a new id. It keeps the original createdAt, so it sorts where it was.
// The old row stays deleted, tagged 'undone'.
function restoreEntry(entry) {
  const now = new Date().toISOString();
  const old = data.entries.find((e) => e.id === entry.id);
  if (old) touch(old, { deletedHow: 'undone' });
  data.entries.push({ ...entry, id: newId(), updatedAt: now, deletedAt: null, deletedHow: null, dirty: true });
  persist();
  refreshView();
  sync();
}

$('times-btn').addEventListener('click', () => {
  if (timesShown(current.cat)) delete showTimes[current.cat];
  else showTimes[current.cat] = true;
  localStorage.setItem(TIMES_KEY, JSON.stringify(showTimes));
  renderEntries(current.cat);
});

$('remove-project-btn').addEventListener('click', () => {
  const cat = current.cat;
  const entries = entriesFor(cat);
  const msg = entries.length
    ? `Remove "${cat}" and its ${entries.length} note(s)? Export first if you want a copy.`
    : `Remove "${cat}"?`;
  if (!confirm(msg)) return;
  const now = new Date().toISOString();
  for (const e of entries) touch(e, { deletedAt: now, deletedHow: 'project_removed' });
  touch(data.categories.find((c) => c.name === cat), { deletedAt: now });
  persist();
  history.back();
  sync();
});
