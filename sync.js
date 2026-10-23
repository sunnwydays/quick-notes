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
// Bumped so every device downloads everything once more, recovering rows an
// earlier version lost when two tabs were open.
const SYNC_KEY = 'quicknotes-sync-v2';
localStorage.removeItem('quicknotes-sync');
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
      .map((x) => ({ key: t.key(x), row: t.toRow(x), updatedAt: x.updatedAt, deletedAt: x.deletedAt }));
    for (let i = 0; i < sent.length; i += PAGE) {
      const chunk = sent.slice(i, i + PAGE);
      await rest('POST', `${t.table}?on_conflict=${t.conflict}`, chunk.map((s) => s.row));
      // Only clear rows that weren't changed again while the upload was running.
      reload();
      const byKey = new Map(data[kind].map((x) => [t.key(x), x]));
      for (const s of chunk) {
        const x = byKey.get(s.key);
        if (x && x.updatedAt === s.updatedAt && x.deletedAt === s.deletedAt) x.dirty = false;
      }
      persist();
    }
  }
}

async function pullChanges() {
  const cursors = readJSON(SYNC_KEY) || {};
  const fetched = {};
  for (const kind of ['categories', 'entries']) {
    const t = TABLES[kind];
    fetched[kind] = [];
    // Re-read the last minute as well, in case a slow write landed with an
    // earlier timestamp. Merging the same row twice is harmless.
    let since = cursors[kind] ? new Date(Date.parse(cursors[kind]) - 60000).toISOString() : EPOCH;
    for (;;) {
      const rows = await rest(
        'GET',
        `${t.table}?select=*&synced_at=gt.${encodeURIComponent(since)}&order=synced_at.asc&limit=${PAGE}`
      );
      fetched[kind].push(...rows.map(t.fromRow));
      if (rows.length) {
        since = rows[rows.length - 1].synced_at;
        cursors[kind] = since;
      }
      if (rows.length < PAGE) break;
    }
  }
  // Merge and save the rows and the cursor together, with no network wait in
  // between, so the cursor can never move past rows that weren't saved.
  reload();
  let changed = false;
  for (const kind of ['categories', 'entries']) {
    const t = TABLES[kind];
    const byKey = new Map(data[kind].map((x) => [t.key(x), x]));
    for (const remote of fetched[kind]) {
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
  }
  if (applyRenames(data)) changed = true;
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
    // Upload any projects reviveOrphans() brought back and notes applyRenames() moved.
    if (waitingCount()) await pushChanges();
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
