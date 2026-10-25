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

const REPLACE_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/></svg>';

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

// The text of a note, with its time above it when its category shows times.
// Also used by search and the editor.
function entryBody(entry) {
  const body = document.createElement('div');
  body.className = 'entry-body';
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

function renderEntries(cat) {
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
    const body = entryBody(entry);
    const { id } = entry;
    const del = iconButton('Delete', TRASH_ICON);
    del.addEventListener('click', () => {
      const entry = deleteEntry(id);
      if (!entry) return;
      showUndo('Note deleted.', () => restoreEntry(entry));
      renderEntries(cat);
      sync();
    });
    // Replace deletes the note and opens the editor for the next one (tick off a
    // task, write the one after it). Undo, back on this screen, brings the old one back.
    const replace = iconButton('Replace', REPLACE_ICON);
    replace.addEventListener('click', () => {
      const entry = deleteEntry(id);
      if (!entry) return;
      pendingUndo = ['Old note deleted.', () => restoreEntry(entry)];
      openEditor(cat);
      sync();
    });
    div.append(body, replace, del);
    box.append(div);
  }
  box.classList.toggle('with-times', timesShown(cat));
  $('times-btn').textContent = timesShown(cat) ? 'Hide times' : 'Show times';
  $('remove-project-btn').hidden = BUILT_IN.includes(cat);
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
function deleteEntry(id) {
  const entry = data.entries.find((e) => e.id === id);
  if (!entry) return null;
  touch(entry, { deletedAt: new Date().toISOString() });
  persist();
  return entry;
}

// The server treats a delete as final, so Undo brings the note back as a copy
// with a new id. It keeps the original createdAt, so it sorts where it was.
function restoreEntry(entry) {
  const now = new Date().toISOString();
  data.entries.push({ ...entry, id: newId(), updatedAt: now, deletedAt: null, dirty: true });
  persist();
  renderEntries(current.cat);
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
  for (const e of entries) touch(e, { deletedAt: now });
  touch(data.categories.find((c) => c.name === cat), { deletedAt: now });
  persist();
  history.back();
  sync();
});
