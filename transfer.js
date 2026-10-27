// ---------- transfer ----------
// Three blank text boxes for carrying text between computers: paste into one,
// open the app on the other computer and copy it out. Notes are never edited, so
// each save adds the pad's text as a new note and deletes the old one (blanking
// its text so old versions don't pile up on the server); the newest note in the
// pad's category is the pad. It saves after a pause in typing, on switching pads,
// on leaving the screen and when the app is hidden.

const PAD_SAVE_MS = 1000;
const padBox = $('pad');
let padIndex = 0;
let padTimer = null;
let padSaved = ''; // what the box held when it was last drawn or saved

for (const [i] of PADS.entries()) {
  const tab = document.createElement('button');
  tab.textContent = i + 1;
  tab.setAttribute('aria-label', `Pad ${i + 1}`);
  tab.addEventListener('click', () => {
    savePad();
    padIndex = i;
    renderTransfer();
  });
  $('pad-tabs').append(tab);
}

$('transfer-btn').addEventListener('click', () => go({ view: 'transfer' }));

function renderTransfer() {
  setLabel($('transfer-title'), TRANSFER);
  [...$('pad-tabs').children].forEach((tab, i) => tab.setAttribute('aria-pressed', i === padIndex));
  // Text typed here and not saved yet is newer than anything a sync brought in.
  if (padBox.value !== padSaved) return;
  const note = entriesFor(PADS[padIndex])[0];
  const text = note ? note.text : '';
  if (padBox.value !== text) padBox.value = text;
  padSaved = text;
}

function savePad() {
  clearTimeout(padTimer);
  if (padBox.value === padSaved) return;
  const cat = PADS[padIndex];
  const now = new Date().toISOString();
  for (const e of entriesFor(cat)) touch(e, { text: '', deletedAt: now, deletedHow: 'replaced' });
  if (padBox.value) {
    data.entries.push({
      id: newId(), category: cat, text: padBox.value,
      createdAt: now, updatedAt: now, deletedAt: null, dirty: true,
    });
  }
  padSaved = padBox.value;
  persist();
  sync();
}

padBox.addEventListener('input', () => {
  clearTimeout(padTimer);
  padTimer = setTimeout(savePad, PAD_SAVE_MS);
});
padBox.addEventListener('blur', savePad);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && current && current.view === 'transfer') savePad();
});

$('pad-copy-btn').addEventListener('click', () => {
  navigator.clipboard
    .writeText(padBox.value)
    .then(() => showUndo('Copied.'))
    .catch(() => showUndo('Copy failed.'));
});

$('pad-clear-btn').addEventListener('click', () => {
  const old = padBox.value;
  if (!old) return;
  padBox.value = '';
  savePad();
  showUndo('Cleared.', () => {
    padBox.value = old;
    savePad();
  });
});
