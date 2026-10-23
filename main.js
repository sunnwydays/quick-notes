// ---------- startup ----------

// A reload can leave us on an old history entry; always start from home.
history.replaceState(null, '');
render(null);

// Reopen an unsaved draft if the app was closed mid-note.
try {
  const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
  const cat = draft && (RENAMED[draft.cat] || draft.cat);
  if (draft && cleanText(draft.text) && categoryNames().includes(cat)) {
    textarea.value = draft.text;
    go({ view: 'edit', cat });
  }
} catch {}

sync();

// Ask the browser not to auto-clear our storage when space runs low.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
