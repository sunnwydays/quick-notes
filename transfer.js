// ---------- transfer ----------
// Three blank text boxes for carrying text between computers: paste into one,
// open the app on the other computer and copy it out. Notes are never edited, so
// each save adds the pad's text as a new note and deletes the old one (blanking
// its text so old versions don't pile up on the server); the newest note in the
// pad's category is the pad. It saves after a pause in typing, on switching pads,
// on leaving the screen and when the app is hidden. Each pad has its own address
// (#transfer/1 to #transfer/3) to open or bookmark; a hash is never sent to the
// server, so it's the same cached page and costs nothing extra to load. While the
// screen is open it also syncs every PAD_POLL_MS, so a box edited on another
// computer shows up without reloading, and a line above the box says where
// the text has got to.

const PAD_SAVE_MS = 1000;
const PAD_POLL_MS = 5000;
const padBox = $('pad');
let padIndex = 0;
let padTimer = null;
let padSaved = ''; // what the box held when it was last drawn or saved

for (const [i] of PADS.entries()) {
  const tab = document.createElement('button');
  tab.textContent = i + 1;
  tab.setAttribute('aria-label', `Pad ${i + 1}`);
  tab.addEventListener('click', () => showPad(i));
  $('pad-tabs').append(tab);
}

$('transfer-btn').addEventListener('click', () => go({ view: 'transfer', pad: padIndex }, padHash(padIndex)));

function padHash(i) {
  return `#transfer/${i + 1}`;
}

// The pad (0-based) the address names, or -1.
function padFromHash() {
  const m = /^#transfer\/(\d+)$/.exec(location.hash);
  return m && m[1] >= 1 && m[1] <= PADS.length ? m[1] - 1 : -1;
}

// Switch pads on the Transfer screen, keeping the address in step.
function showPad(i) {
  savePad();
  padIndex = i;
  current = { view: 'transfer', pad: i };
  history.replaceState(current, '', padHash(i));
  renderTransfer();
}

// An address typed into the same tab.
window.addEventListener('hashchange', () => {
  const i = padFromHash();
  if (i < 0 || (current && current.view === 'transfer' && padIndex === i)) return;
  if (current && current.view === 'transfer') return showPad(i);
  padIndex = i;
  current = { view: 'transfer', pad: i };
  history.replaceState(current, '', padHash(i));
  render(current);
});

function renderTransfer() {
  setLabel($('transfer-title'), TRANSFER);
  showPadStatus();
  [...$('pad-tabs').children].forEach((tab, i) => tab.setAttribute('aria-pressed', i === padIndex));
  // Text typed here and not saved yet is newer than anything a sync brought in.
  if (padBox.value !== padSaved) return;
  const note = entriesFor(PADS[padIndex])[0];
  const text = note ? note.text : '';
  if (padBox.value !== text) padBox.value = text;
  padSaved = text;
}

function showPadStatus() {
  let text;
  if (padBox.value !== padSaved) text = 'Not saved yet…';
  else if (!auth) text = 'Saved on this device only. Log in to sync.';
  else if (syncFailed) text = statusText;
  else if (waitingCount()) text = 'Saved on this device, syncing…';
  else if (lastSynced) text = `Saved and synced ${lastSynced.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}.`;
  else text = 'Syncing…';
  $('pad-status').textContent = text;
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
  showPadStatus();
}

padBox.addEventListener('input', () => {
  showPadStatus();
  clearTimeout(padTimer);
  padTimer = setTimeout(savePad, PAD_SAVE_MS);
});
padBox.addEventListener('blur', savePad);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && current && current.view === 'transfer') savePad();
});

function pollPads() {
  if (current && current.view === 'transfer' && document.visibilityState === 'visible') sync();
}
setInterval(pollPads, PAD_POLL_MS);
window.addEventListener('focus', pollPads);

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
