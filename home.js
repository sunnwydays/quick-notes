// The home screen: category buttons, + project and Read.

// ---------- home ----------

function renderHome() {
  $('read-btn').classList.toggle('primary', readNext);
  fillCategories($('categories'), (cat) => {
    const btn = document.createElement('button');
    btn.textContent = label(cat);
    onLongPress(btn, () => go({ view: 'entries', cat }));
    btn.addEventListener('click', () => {
      if (btn.held) return; // the click that ends a long press
      readNext ? go({ view: 'entries', cat }) : openEditor(cat);
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

// Tapping Read again cancels it.
$('read-btn').addEventListener('click', () => {
  readNext = !readNext;
  $('read-btn').classList.toggle('primary', readNext);
});
