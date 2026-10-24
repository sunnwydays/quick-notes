// The home screen: category buttons, the ☰ menu, New project and Write.

// ---------- home ----------

function renderHome() {
  $('write-btn').classList.toggle('primary', writeNext);
  fillCategories($('categories'), (cat) => {
    const btn = document.createElement('button');
    btn.className = 'tile';
    const name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = cat;
    const meta = document.createElement('span');
    meta.className = 'tile-meta';
    meta.textContent = categorySummary(cat);
    btn.append(categoryIcon(cat, 26), name, meta);
    onHoldRelease(btn, () => openEditor(cat));
    btn.addEventListener('click', () => {
      if (btn.held) return; // the click that ends a long press
      if (writeNext) openEditor(cat);
      else go(cat === SCHEDULE ? { view: 'schedule', date: null } : { view: 'entries', cat });
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

// ---------- menu ----------
// New project, Export, Help and Log in live behind the ☰ button. Picking one
// closes the menu. So does tapping anywhere else, and that tap does nothing
// more, so closing it can't open a category by accident.

function setMenu(open) {
  $('menu').hidden = !open;
  $('menu-btn').setAttribute('aria-expanded', open);
}

$('menu-btn').addEventListener('click', () => setMenu($('menu').hidden));
$('menu').addEventListener('click', (e) => {
  if (e.target.closest('button')) setMenu(false);
});
document.addEventListener('click', (e) => {
  if ($('menu').hidden || e.target.closest('#menu, #menu-btn')) return;
  e.preventDefault();
  e.stopPropagation();
  setMenu(false);
}, true);

// Tapping Write again cancels it.
$('write-btn').addEventListener('click', () => {
  writeNext = !writeNext;
  $('write-btn').classList.toggle('primary', writeNext);
});
