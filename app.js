const STORE_KEY = 'quicknotes';
const DRAFT_KEY = 'quicknotes-draft';
const BUILT_IN = ['Todo', 'Journal', 'Random thought', 'Bring from home'];
const BULLET = '- ';

const $ = (id) => document.getElementById(id);
const textarea = $('text');

// ---------- storage ----------

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Array.isArray(saved.categories) && Array.isArray(saved.entries)) return saved;
  } catch {}
  return { categories: [...BUILT_IN], entries: [] };
}

let data = load();

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

// Projects first (each is its own button), then the built-in categories.
function orderedCategories() {
  return [
    ...data.categories.filter((c) => !BUILT_IN.includes(c)),
    ...data.categories.filter((c) => BUILT_IN.includes(c)),
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
    .filter((e) => e.category === cat)
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
  }
  window.scrollTo(0, 0);
}

function go(state) {
  history.pushState(state, '');
  render(state);
}

window.addEventListener('popstate', (e) => {
  if (current && current.view === 'edit') commitEditor();
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
}

$('add-project-btn').addEventListener('click', () => {
  const name = (prompt('Project name') || '').trim();
  if (!name) return;
  if (data.categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
    alert(`"${name}" already exists.`);
    return;
  }
  data.categories.push(name);
  persist();
  renderHome();
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

function commitEditor() {
  const text = cleanText(textarea.value);
  if (text) {
    data.entries.push({
      id: newId(),
      category: current.cat,
      text,
      createdAt: new Date().toISOString(),
    });
    persist();
  }
  localStorage.removeItem(DRAFT_KEY);
  textarea.value = '';
  textarea.blur();
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
      data.entries = data.entries.filter((e) => e.id !== entry.id);
      persist();
      renderEntries(cat);
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
  const count = entriesFor(cat).length;
  const msg = count
    ? `Remove "${cat}" and its ${count} note(s)? Export first if you want a copy.`
    : `Remove "${cat}"?`;
  if (!confirm(msg)) return;
  data.categories = data.categories.filter((c) => c !== cat);
  data.entries = data.entries.filter((e) => e.category !== cat);
  persist();
  history.back();
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

// ---------- startup ----------

// A reload can leave us on an old history entry; always start from home.
history.replaceState(null, '');
render(null);

// Reopen an unsaved draft if the app was closed mid-note.
try {
  const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
  if (draft && cleanText(draft.text) && data.categories.includes(draft.cat)) {
    textarea.value = draft.text;
    go({ view: 'edit', cat: draft.cat });
  }
} catch {}

// Ask the browser not to auto-clear our storage when space runs low.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
