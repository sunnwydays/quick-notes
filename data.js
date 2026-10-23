// Constants, the saved data and helpers for reading it. Loaded first: every
// other file shares these globals (the files are plain scripts, not modules).

const STORE_KEY = 'quicknotes';
const DRAFT_KEY = 'quicknotes-draft';
const BACKUP_KEY = 'quicknotes-backup-v1';
// In button order: left to right, then down.
const BUILT_IN = ['Todo', 'Working on', 'Thought', 'Random projects', 'Bring from home', 'Journal'];
// Display only; the stored (and synced) category name stays plain text.
const EMOJI = {
  Todo: '✅', 'Working on': '🛠️', Thought: '💭', 'Random projects': '💡', 'Bring from home': '🏠', Journal: '📓',
};
// Built-in categories that were renamed: old name -> new name.
const RENAMED = { 'Random thought': 'Thought' };
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

function label(cat) {
  return EMOJI[cat] ? `${EMOJI[cat]} ${cat}` : cat;
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
