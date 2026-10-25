// Constants, the saved data and helpers for reading it. Loaded first: every
// other file shares these globals (the files are plain scripts, not modules).

const STORE_KEY = 'quicknotes';
const DRAFT_KEY = 'quicknotes-draft';
const BACKUP_KEY = 'quicknotes-backup-v1';
// Opens its own screen instead of the notes list (schedule.js).
const SCHEDULE = 'Schedule';
// The editor opened by Add note on the home screen. Not a category: each note
// goes to the folder its first words name (autofile.js).
const AUTO = 'Add note';
// In button order: left to right, then down.
const BUILT_IN = ['Todo', 'Working on', SCHEDULE, 'Thought', 'Random projs', 'Bring', 'Journal'];
// Line icons (SVG path data, 24x24), drawn in the text colour so they stay crisp
// on e-ink and turn white on a black button. Display only; the stored (and
// synced) category name stays plain text. Projects all share the folder.
const ICONS = {
  Todo: 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM8 12l3 3 5-6',
  'Working on': 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  Thought: 'M7.9 20A9 9 0 1 0 4 16.1L2 22z',
  'Random projs': 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4',
  Bring: 'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  Journal: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  [SCHEDULE]: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  [AUTO]: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
};
const PROJECT_ICON = 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z';
// Built-in categories that were renamed: old name -> new name.
const RENAMED = {
  'Random thought': 'Thought',
  'Random projects': 'Random projs',
  'Bring from home': 'Bring',
};
const BULLET = '- ';
const EPOCH = '1970-01-01T00:00:00.000Z';

const $ = (id) => document.getElementById(id);
// ---------- storage ----------
// Categories are {name, updatedAt, deletedAt, dirty} and entries are
// {id, category, text, createdAt, updatedAt, deletedAt, dirty}.
// Deleting sets deletedAt instead of removing the row, so the delete can sync
// to other devices. dirty = changed here and not yet uploaded.

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function load() {
  let saved = readJSON(STORE_KEY);
  if (!saved || !Array.isArray(saved.categories) || !Array.isArray(saved.entries)) {
    saved = { categories: [], entries: [] };
  }
  return migrate(saved);
}

// Older versions stored categories as plain names and had no sync fields.
// Anything missing counts as live and not yet uploaded.
function migrate(d) {
  if (d.categories.some((c) => typeof c === 'string') && !localStorage.getItem(BACKUP_KEY)) {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(d));
  }
  const now = new Date().toISOString();
  d.categories = d.categories.map((c) =>
    typeof c === 'string'
      ? { name: c, updatedAt: BUILT_IN.includes(c) ? EPOCH : now, deletedAt: null, dirty: true }
      : c
  );
  for (const e of d.entries) {
    if (!e.updatedAt) Object.assign(e, { updatedAt: e.createdAt, deletedAt: null, dirty: true });
  }
  for (const name of BUILT_IN) {
    if (!d.categories.some((c) => c.name === name)) {
      d.categories.push({ name, updatedAt: EPOCH, deletedAt: null, dirty: true });
    }
  }
  applyRenames(d);
  return d;
}

// Move notes under a renamed category's new name and remove the old category.
// Also runs after each download, in case a device on an older version still
// saves notes under the old name.
function applyRenames(d) {
  let changed = false;
  for (const e of d.entries) {
    if (RENAMED[e.category]) {
      touch(e, { category: RENAMED[e.category] });
      changed = true;
    }
  }
  for (const c of d.categories) {
    if (RENAMED[c.name] && !c.deletedAt) {
      touch(c, { deletedAt: new Date().toISOString() });
      changed = true;
    }
  }
  return changed;
}

let data = load();

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

// Every open tab or window of the app shares this storage but keeps its own
// copy in memory. Re-read it before saving after a network wait, so one copy
// never saves its stale data over rows another copy just downloaded.
function reload() {
  data = load();
}

window.addEventListener('storage', (e) => {
  if (e.key !== STORE_KEY) return;
  reload();
  refreshView();
});

// Record a local change so the next sync uploads it.
function touch(item, fields) {
  Object.assign(item, fields, { updatedAt: new Date().toISOString(), dirty: true });
}

function categoryIcon(cat, size = 28) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML =
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${ICONS[cat] || PROJECT_ICON}"/></svg>`;
  return span;
}

// Fill a title or heading with the category's icon and name (or other text).
function setLabel(el, cat, text = cat) {
  el.replaceChildren(categoryIcon(cat), text);
}

function categoryNames() {
  return data.categories.filter((c) => !c.deletedAt).map((c) => c.name);
}

// Projects first (each is its own button), then the built-in categories in BUILT_IN order.
function orderedCategories() {
  const names = categoryNames();
  return [
    ...names.filter((c) => !BUILT_IN.includes(c)),
    ...BUILT_IN.filter((c) => names.includes(c)),
  ];
}

// One button per category, with a divider line between projects and the built-ins.
function fillCategories(box, makeButton) {
  box.replaceChildren();
  const cats = orderedCategories();
  cats.forEach((cat, i) => {
    if (i > 0 && BUILT_IN.includes(cat) && !BUILT_IN.includes(cats[i - 1])) {
      box.append(document.createElement('hr'));
    }
    box.append(makeButton(cat));
  });
}

function entriesFor(cat) {
  return data.entries
    .filter((e) => e.category === cat && !e.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
