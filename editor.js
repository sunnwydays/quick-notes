const textarea = $('text');

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

$('add-btn').addEventListener('click', () => openEditor(current.cat));

// The latest notes in the category sit above the text box, newest first, in the
// same place as on the notes screen. Older ones scroll.
const RECENT_COUNT = 30;

function renderRecent(cat) {
  const box = $('editor-recent');
  box.replaceChildren();
  const entries = entriesFor(cat);
  if (!entries.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No notes yet.';
    box.append(p);
  }
  for (const entry of entries.slice(0, RECENT_COUNT)) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.append(entryBody(entry));
    box.append(div);
  }
  box.classList.toggle('with-times', timesShown(cat));
}

// Once the text outgrows its box (a long schedule, say), the recent notes are
// hidden and the box takes the whole screen. It stays that way until the editor
// closes or Enter clears the box, so it doesn't flip back and forth.
function fitText(reset = false) {
  const editor = $('editor');
  if (reset) editor.classList.remove('full');
  if (textarea.scrollHeight > textarea.clientHeight) editor.classList.add('full');
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

// Saves what's in the text box. Returns true if there was anything to save.
function saveNotes() {
  const text = cleanText(textarea.value);
  if (!text) return false;
  // Each line is its own note (a pasted list, say); a schedule is split by day instead.
  const notes = current.cat === SCHEDULE ? splitDays(text).filter(changesSchedule)
    : text.split('\n').filter((line) => line.trim());
  // Split notes are a millisecond apart, first line newest, so the list
  // (newest first) shows them in the order they were typed.
  const base = Date.now();
  notes.forEach((note, i) => {
    const now = new Date(base - i).toISOString();
    data.entries.push({
      id: newId(),
      category: current.cat,
      text: note.trim(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      dirty: true,
    });
  });
  // For a multi-day paste, the first day.
  if (current.cat === SCHEDULE && notes.length) savedDay = scheduleDay(data.entries[data.entries.length - notes.length]);
  persist();
  return true;
}

// Returns true if a note was saved.
function commitEditor() {
  const saved = saveNotes();
  localStorage.removeItem(DRAFT_KEY);
  textarea.value = '';
  textarea.blur();
  return saved;
}

// Enter adds the note and starts the next one, with the keyboard still up. A
// schedule is one note, so there it starts a new "- " line instead.
function enter() {
  if (current.cat === SCHEDULE) {
    const { selectionStart, selectionEnd } = textarea;
    textarea.setRangeText('\n' + BULLET, selectionStart, selectionEnd, 'end');
  } else {
    if (saveNotes()) {
      renderRecent(current.cat);
      sync();
    }
    textarea.value = BULLET;
    textarea.setSelectionRange(BULLET.length, BULLET.length);
  }
  fitText(current.cat !== SCHEDULE);
  saveDraft();
}

// Physical keyboards are caught on keydown; Gboard often reports keydown as
// key code 229, so beforeinput catches it there.
textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    enter();
  }
});
textarea.addEventListener('beforeinput', (e) => {
  if ((e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') && e.cancelable) {
    e.preventDefault();
    enter();
  }
});
textarea.addEventListener('input', (e) => {
  // Fallback: the line break got through uncancelled.
  if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
    if (current.cat === SCHEDULE) textarea.setRangeText(BULLET, textarea.selectionStart, textarea.selectionEnd, 'end');
    else enter();
  }
  fitText();
  saveDraft();
});

// Pasting "- foo" right after a "- " would give "- - foo", so drop the pasted bullet.
textarea.addEventListener('paste', (e) => {
  const pasted = e.clipboardData.getData('text/plain');
  const { selectionStart, selectionEnd } = textarea;
  if (!pasted.startsWith(BULLET) || !textarea.value.slice(0, selectionStart).endsWith(BULLET)) return;
  e.preventDefault();
  textarea.setRangeText(pasted.slice(BULLET.length), selectionStart, selectionEnd, 'end');
  fitText();
  saveDraft();
});

// Saving happens in the popstate handler, so Save and the back button behave the same.
$('save-btn').addEventListener('click', () => history.back());
// Undo reopens the editor with the draft, from the Undo tap so the keyboard comes up.
$('discard-btn').addEventListener('click', () => {
  const { cat } = current;
  const text = textarea.value;
  if (cleanText(text)) {
    pendingUndo = ['Note discarded.', () => openEditor(cat, text)];
  }
  textarea.value = '';
  history.back();
});
