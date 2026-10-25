// The home screen: category buttons, the ☰ menu, New project and Write.

// ---------- home ----------

function categoryTile(cat) {
  const btn = document.createElement('button');
  btn.className = 'tile';
  const name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = cat;
  btn.append(categoryIcon(cat, 26), name);
  onHoldRelease(btn, () => openEditor(cat));
  btn.addEventListener('click', () => {
    if (btn.held) return; // the click that ends a long press
    if (writeNext) openEditor(cat);
    else go(cat === SCHEDULE ? { view: 'schedule', date: null } : { view: 'entries', cat });
  });
  return btn;
}

// Projects go in their own grid on top. The built-ins form a 3×3 "flower" with
// Add note in the middle and Write in the last corner, where the thumb rests;
// CSS pins those two, and the tiles fill the other cells in BUILT_IN order.
function renderHome() {
  $('write-btn').classList.toggle('primary', writeNext);
  const cats = orderedCategories();
  $('projects').replaceChildren(...cats.filter((c) => !BUILT_IN.includes(c)).map(categoryTile));
  $('flower').querySelectorAll('.tile').forEach((t) => t.remove());
  $('flower').prepend(...cats.filter((c) => BUILT_IN.includes(c)).map(categoryTile));
  renderSearch();
  showStatus();
}

$('add-project-btn').addEventListener('click', () => {
  const name = (prompt('Project name') || '').trim();
  if (!name) return;
  if ([...categoryNames(), AUTO].some((c) => c.toLowerCase() === name.toLowerCase())) {
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

// Add note skips picking a category: each note is filed by its first words (autofile.js).
$('add-any-btn').addEventListener('click', () => openEditor(AUTO));

// Tapping Write again cancels it.
$('write-btn').addEventListener('click', () => {
  writeNext = !writeNext;
  $('write-btn').classList.toggle('primary', writeNext);
});
