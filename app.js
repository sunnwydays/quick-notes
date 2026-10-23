const STORE_KEY = 'quicknotes';
const DRAFT_KEY = 'quicknotes-draft';
const BACKUP_KEY = 'quicknotes-backup-v1';
const BUILT_IN = ['Todo', 'Journal', 'Random thought', 'Bring from home'];
const BULLET = '- ';
const EPOCH = '1970-01-01T00:00:00.000Z';

const $ = (id) => document.getElementById(id);
const textarea = $('text');

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
  return d;
}

let data = load();

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

// Record a local change so the next sync uploads it.
function touch(item, fields) {
  Object.assign(item, fields, { updatedAt: new Date().toISOString(), dirty: true });
}

function categoryNames() {
  return data.categories.filter((c) => !c.deletedAt).map((c) => c.name);
}

// Projects first (each is its own button), then the built-in categories.
function orderedCategories() {
  const names = categoryNames();
  return [
    ...names.filter((c) => !BUILT_IN.includes(c)),
    ...names.filter((c) => BUILT_IN.includes(c)),
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

// ---------- views ----------
// Each screen is a <section>. Opening one pushes a history entry so the
// Android back button returns to the previous screen instead of closing the app.

let current = null; // null = home, or {view, cat}

function show(id) {
  for (const s of document.querySelectorAll('body > section')) s.hidden = s.id !== id;
}

function render(state) {
  current = state;
  if (!state) {
    renderHome();
    show('home');
  } else if (state.view === 'edit') {
    $('editor-title').textContent = state.cat;
    show('editor');
  } else if (state.view === 'read') {
    renderReadList();
    show('read');
  } else if (state.view === 'entries') {
    renderEntries(state.cat);
    show('entries');
  } else if (state.view === 'login') {
    show('login');
  }
  window.scrollTo(0, 0);
}

// Redraw the current screen after a sync brought in changes. Leaves the editor
// and login screens alone so nothing jumps while typing.
function refreshView() {
  if (!current) renderHome();
  else if (current.view === 'read') renderReadList();
  else if (current.view === 'entries') renderEntries(current.cat);
}

function go(state) {
  history.pushState(state, '');
  render(state);
}

window.addEventListener('popstate', (e) => {
  if (current && current.view === 'edit' && commitEditor()) sync();
  render(e.state);
});

for (const btn of document.querySelectorAll('.back')) {
  btn.addEventListener('click', () => history.back());
}

// ---------- home ----------

function renderHome() {
  fillCategories($('categories'), (cat) => {
    const btn = document.createElement('button');
    btn.textContent = cat;
    btn.addEventListener('click', () => openEditor(cat));
    return btn;
  });
  showStatus();
}

$('add-project-btn').addEventListener('click', () => {
  const name = (prompt('Project name') || '').trim();
  if (!name) return;
  if (categoryNames().some((c) => c.toLowerCase() === name.toLowerCase())) {
    alert(`"${name}" already exists.`);
    return;
  }
  const removed = data.categories.find((c) => c.name === name);
  if (removed) touch(removed, { deletedAt: null });
  else data.categories.push({ name, updatedAt: new Date().toISOString(), deletedAt: null, dirty: true });
  persist();
  renderHome();
  sync();
});

$('read-btn').addEventListener('click', () => go({ view: 'read' }));
$('export-btn').addEventListener('click', downloadExport);

// ---------- editor ----------

// Called straight from the category button's click handler. Focusing inside a
// real tap is what lets Android raise the keyboard.
function openEditor(cat, text = BULLET) {
  textarea.value = text;
  go({ view: 'edit', cat });
  textarea.focus();
  textarea.setSelectionRange(text.length, text.length);
  saveDraft();
}

function saveDraft() {
  if (!current || current.view !== 'edit') return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ cat: current.cat, text: textarea.value }));
}

// Drop empty "- " lines and surrounding whitespace.
function cleanText(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '-')
    .join('\n')
    .trim();
}

// Returns true if a note was saved.
function commitEditor() {
  const text = cleanText(textarea.value);
  if (text) {
    const now = new Date().toISOString();
    data.entries.push({
      id: newId(),
      category: current.cat,
      text,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      dirty: true,
    });
    persist();
  }
  localStorage.removeItem(DRAFT_KEY);
  textarea.value = '';
  textarea.blur();
  return Boolean(text);
}

function insertBullet() {
  const { selectionStart, selectionEnd } = textarea;
  textarea.setRangeText('\n' + BULLET, selectionStart, selectionEnd, 'end');
  saveDraft();
}

// Enter starts a new "- " line. Physical keyboards are caught on keydown;
// Gboard often reports keydown as key code 229, so beforeinput catches it there.
textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    insertBullet();
  }
});
textarea.addEventListener('beforeinput', (e) => {
  if ((e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') && e.cancelable) {
    e.preventDefault();
    insertBullet();
  }
});
textarea.addEventListener('input', (e) => {
  // Fallback: the line break got through uncancelled, so add the bullet after it.
  if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
    textarea.setRangeText(BULLET, textarea.selectionStart, textarea.selectionEnd, 'end');
  }
  saveDraft();
});

// Saving happens in the popstate handler, so Save and the back button behave the same.
$('save-btn').addEventListener('click', () => history.back());
$('discard-btn').addEventListener('click', () => {
  if (cleanText(textarea.value) && !confirm('Discard this note?')) return;
  textarea.value = '';
  history.back();
});

// ---------- read ----------

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

function renderReadList() {
  fillCategories($('read-list'), (cat) => {
    const btn = document.createElement('button');
    btn.textContent = `${cat} (${entriesFor(cat).length})`;
    btn.addEventListener('click', () => go({ view: 'entries', cat }));
    return btn;
  });
}

function renderEntries(cat) {
  $('entries-title').textContent = cat;
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
    const head = document.createElement('div');
    head.className = 'entry-head';
    const time = document.createElement('time');
    time.textContent = formatShort(entry.createdAt);
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      if (!confirm('Delete this note?')) return;
      touch(entry, { deletedAt: new Date().toISOString() });
      persist();
      renderEntries(cat);
      sync();
    });
    head.append(time, del);
    const p = document.createElement('p');
    p.textContent = entry.text;
    div.append(head, p);
    box.append(div);
  }
  $('remove-project-btn').hidden = BUILT_IN.includes(cat);
}

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

// ---------- export ----------

function exportText() {
  return orderedCategories()
    .map((cat) => {
      const items = entriesFor(cat).map((e) => `[${formatFull(e.createdAt)}]\n${e.text}`);
      return items.length ? `# ${cat}\n\n${items.join('\n\n')}` : null;
    })
    .filter(Boolean)
    .join('\n\n\n');
}

function downloadExport() {
  const blob = new Blob([exportText()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `quick-notes-${formatFull(new Date().toISOString()).slice(0, 10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('copy-btn').addEventListener('click', () => {
  navigator.clipboard
    .writeText(exportText())
    .then(() => alert('Copied all notes.'))
    .catch(() => alert('Copy failed. Use Export on the home screen instead.'));
});

// ---------- sync ----------
// Supabase keeps a copy of every category and note. A sync uploads rows marked
// dirty, then downloads rows the server has received since the last download.
// Notes are only ever added or deleted, never edited, so combining both sides
// is a union by id, and a delete always wins. Categories can be removed and
// re-added, so for those the newer change wins.
// Everything is plain fetch() calls to Supabase's REST and Auth endpoints, so
// there's no library to load and nothing breaks offline.

const SUPABASE_URL = 'https://zcsfiovwomnkdhnfkoqk.supabase.co';
// Public by design: row-level security limits each account to its own rows.
const SUPABASE_KEY = 'sb_publishable_cg6T49bzij-iV46Wha2AaA_cVnfbHMx';
const AUTH_KEY = 'quicknotes-auth';
const SYNC_KEY = 'quicknotes-sync';
const PAGE = 1000;

let auth = readJSON(AUTH_KEY); // {access_token, refresh_token, expires_at, user: {id, email}}
let syncing = false;
let syncAgain = false;
let syncFailed = false;
let lastSynced = null;
let logoutReason = null;

// Server timestamps come back as "…+00:00" with microseconds; local ones are
// toISOString(). Normalise so string comparison and sorting stay correct.
const iso = (t) => (t ? new Date(t).toISOString() : null);

const TABLES = {
  categories: {
    table: 'qn_categories',
    conflict: 'user_id,name',
    key: (x) => x.name,
    toRow: (c) => ({
      user_id: auth.user.id, name: c.name, updated_at: c.updatedAt, deleted_at: c.deletedAt,
    }),
    fromRow: (r) => ({ name: r.name, updatedAt: iso(r.updated_at), deletedAt: iso(r.deleted_at) }),
    merge(local, remote) {
      if (remote.updatedAt <= local.updatedAt) return false;
      Object.assign(local, remote, { dirty: false });
      return true;
    },
  },
  entries: {
    table: 'qn_entries',
    conflict: 'id',
    key: (x) => x.id,
    toRow: (e) => ({
      id: e.id, user_id: auth.user.id, category: e.category, text: e.text,
      created_at: e.createdAt, updated_at: e.updatedAt, deleted_at: e.deletedAt,
    }),
    fromRow: (r) => ({
      id: r.id, category: r.category, text: r.text, createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at), deletedAt: iso(r.deleted_at),
    }),
    merge(local, remote) {
      if (!remote.deletedAt || local.deletedAt) return false;
      Object.assign(local, { deletedAt: remote.deletedAt, updatedAt: remote.updatedAt });
      return true;
    },
  },
};

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(json.msg || json.error_description || json.message || `Error ${res.status}`, res.status);
  }
  return json;
}

function saveSession(s) {
  auth = {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + s.expires_in,
    user: { id: s.user.id, email: s.user.email },
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

// The access token lasts about an hour; the refresh token swaps for a new one,
// which is how the app stays logged in indefinitely.
async function accessToken() {
  if (auth.expires_at - 60 > Date.now() / 1000) return auth.access_token;
  try {
    saveSession(await authRequest('token?grant_type=refresh_token', { refresh_token: auth.refresh_token }));
  } catch (err) {
    if ([400, 401, 403].includes(err.status)) logOut('Logged out. Log in again to sync.');
    throw err;
  }
  return auth.access_token;
}

async function rest(method, path, body, retried = false) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: body && JSON.stringify(body),
  });
  // A wrong device clock can make an expired token look fresh: refresh and retry once.
  if (res.status === 401 && !retried && auth) {
    auth.expires_at = 0;
    return rest(method, path, body, true);
  }
  if (!res.ok) throw new HttpError(`Sync error ${res.status}`, res.status);
  return method === 'GET' ? res.json() : null;
}

async function pushChanges() {
  for (const kind of ['categories', 'entries']) {
    const t = TABLES[kind];
    const sent = data[kind]
      .filter((x) => x.dirty)
      .map((x) => ({ x, updatedAt: x.updatedAt, deletedAt: x.deletedAt }));
    for (let i = 0; i < sent.length; i += PAGE) {
      const chunk = sent.slice(i, i + PAGE);
      await rest('POST', `${t.table}?on_conflict=${t.conflict}`, chunk.map((s) => t.toRow(s.x)));
      // Only clear rows that weren't changed again while the upload was running.
      for (const s of chunk) {
        if (s.x.updatedAt === s.updatedAt && s.x.deletedAt === s.deletedAt) s.x.dirty = false;
      }
      persist();
    }
  }
}

async function pullChanges() {
  const cursors = readJSON(SYNC_KEY) || {};
  let changed = false;
  for (const kind of ['categories', 'entries']) {
    const t = TABLES[kind];
    const byKey = new Map(data[kind].map((x) => [t.key(x), x]));
    // Re-read the last minute as well, in case a slow write landed with an
    // earlier timestamp. Merging the same row twice is harmless.
    let since = cursors[kind] ? new Date(Date.parse(cursors[kind]) - 60000).toISOString() : EPOCH;
    for (;;) {
      const rows = await rest(
        'GET',
        `${t.table}?select=*&synced_at=gt.${encodeURIComponent(since)}&order=synced_at.asc&limit=${PAGE}`
      );
      for (const row of rows) {
        const remote = t.fromRow(row);
        const local = byKey.get(t.key(remote));
        if (!local) {
          const added = { ...remote, dirty: false };
          data[kind].push(added);
          byKey.set(t.key(added), added);
          changed = true;
        } else if (t.merge(local, remote)) {
          changed = true;
        }
      }
      if (rows.length) {
        since = rows[rows.length - 1].synced_at;
        cursors[kind] = since;
      }
      if (rows.length < PAGE) break;
    }
  }
  if (reviveOrphans()) changed = true;
  persist();
  localStorage.setItem(SYNC_KEY, JSON.stringify(cursors));
  return changed;
}

// A note written offline into a project that the other device removed would be
// hidden. Bring the project back so no note is ever lost.
function reviveOrphans() {
  const live = new Set(categoryNames());
  let revived = false;
  for (const e of data.entries) {
    if (e.deletedAt || live.has(e.category)) continue;
    const cat = data.categories.find((c) => c.name === e.category);
    if (cat) touch(cat, { deletedAt: null });
    else data.categories.push({ name: e.category, updatedAt: new Date().toISOString(), deletedAt: null, dirty: true });
    live.add(e.category);
    revived = true;
  }
  return revived;
}

// Runs in the background; never awaited by UI code. If a sync is already
// running, one more runs after it so the latest change is included.
async function sync() {
  if (!auth) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  showStatus();
  try {
    await pushChanges();
    const changed = await pullChanges();
    // Upload any projects reviveOrphans() brought back.
    if (data.categories.some((c) => c.dirty)) await pushChanges();
    syncFailed = false;
    lastSynced = new Date();
    if (changed) refreshView();
  } catch {
    syncFailed = true;
  }
  syncing = false;
  showStatus();
  if (syncAgain) {
    syncAgain = false;
    sync();
  }
}

function waitingCount() {
  return data.entries.filter((e) => e.dirty).length + data.categories.filter((c) => c.dirty).length;
}

function showStatus() {
  $('login-btn').textContent = auth ? 'Log out' : 'Log in';
  let text;
  if (!auth) {
    text = logoutReason || 'Not syncing. Notes stay on this device.';
  } else if (syncing) {
    text = 'Syncing…';
  } else if (syncFailed) {
    const waiting = waitingCount();
    text = navigator.onLine ? "Can't reach sync server." : 'Offline.';
    text += waiting ? ` ${waiting} change(s) will sync later.` : ' Will sync later.';
  } else if (lastSynced) {
    text = `Synced ${lastSynced.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } else {
    text = 'Not synced yet.';
  }
  $('sync-status').textContent = text;
}

function logOut(reason = null) {
  auth = null;
  syncFailed = false;
  logoutReason = reason;
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(SYNC_KEY);
  showStatus();
}

// ---------- login ----------
// Email one-time code: Supabase emails a code, and entering it returns a session.

let loginEmail = '';

function loginMessage(text) {
  $('login-msg').textContent = text;
}

function loginError(err) {
  return err instanceof HttpError ? err.message : 'No internet connection.';
}

$('login-btn').addEventListener('click', () => {
  if (auth) {
    if (confirm(`Log out ${auth.user.email}? Your notes stay on this device.`)) logOut();
    return;
  }
  $('code-form').hidden = true;
  loginMessage('');
  go({ view: 'login' });
});

$('email-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  loginEmail = $('email').value.trim();
  loginMessage('Sending code…');
  try {
    await authRequest('otp', { email: loginEmail, create_user: false });
    $('code-sent').textContent = `Code sent to ${loginEmail}. Check your email.`;
    $('code').value = '';
    $('code-form').hidden = false;
    loginMessage('');
  } catch (err) {
    loginMessage(loginError(err));
  }
});

$('code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  loginMessage('Checking code…');
  try {
    saveSession(await authRequest('verify', { type: 'email', email: loginEmail, token: $('code').value.trim() }));
  } catch (err) {
    loginMessage(loginError(err));
    return;
  }
  // Upload everything on this device once; the server keeps whichever side is newer.
  for (const x of [...data.categories, ...data.entries]) x.dirty = true;
  persist();
  localStorage.removeItem(SYNC_KEY);
  logoutReason = null;
  history.back();
  sync();
});

// Sync when the app opens, comes back to the foreground, or gets a connection.
window.addEventListener('online', sync);
window.addEventListener('offline', showStatus);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync();
});

// ---------- startup ----------

// A reload can leave us on an old history entry; always start from home.
history.replaceState(null, '');
render(null);

// Reopen an unsaved draft if the app was closed mid-note.
try {
  const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
  if (draft && cleanText(draft.text) && categoryNames().includes(draft.cat)) {
    textarea.value = draft.text;
    go({ view: 'edit', cat: draft.cat });
  }
} catch {}

sync();

// Ask the browser not to auto-clear our storage when space runs low.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
