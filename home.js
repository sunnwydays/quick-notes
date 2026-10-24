// The home screen: category buttons, + project and Write.

// ---------- home ----------

function renderHome() {
  $('write-btn').classList.toggle('primary', writeNext);
  fillCategories($('categories'), (cat) => {
    const btn = document.createElement('button');
    btn.textContent = label(cat);
    onHoldRelease(btn, () => openEditor(cat));
    btn.addEventListener('click', () => {
      if (btn.held) return; // the click that ends a long press
      writeNext ? openEditor(cat) : go({ view: 'entries', cat });
    });
    return btn;
  });
  renderSearch();
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

// Tapping Write again cancels it.
$('write-btn').addEventListener('click', () => {
  writeNext = !writeNext;
  $('write-btn').classList.toggle('primary', writeNext);
});
