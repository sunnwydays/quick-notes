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

// Projects go in their own zigzag on top. The first seven built-ins are the petals of a
// "flower" around Add note, where the thumb rests (CSS places them in BUILT_IN order);
// any after that sit beside Write under it.
function renderHome() {
  $('write-btn').classList.toggle('primary', writeNext);
  const cats = orderedCategories();
  const builtIns = cats.filter((c) => BUILT_IN.includes(c));
  $('projects').replaceChildren(...cats.filter((c) => !BUILT_IN.includes(c)).map(categoryTile));
  for (const box of [$('flower'), $('flower-row')]) box.querySelectorAll('.tile').forEach((t) => t.remove());
  $('flower').prepend(...builtIns.slice(0, 7).map(categoryTile));
  $('flower-row').prepend(...builtIns.slice(7).map(categoryTile));
  renderTodos();
  renderHomeSchedule();
  renderSearch();
  showStatus();
}

// A few to-dos, one line each, at the top of the screen where they're read
// rather than tapped. The newest, except that the last line is the oldest, with
// its age, so an old one can't stay out of sight. Hidden when there are none.
// Tapping opens Todo; holding a line until it turns black ticks it off.
const HOME_TODOS = 3;

function renderTodos() {
  const todos = entriesFor('Todo');
  const oldest = todos.length > HOME_TODOS ? todos[todos.length - 1] : null;
  const shown = oldest ? [...todos.slice(0, HOME_TODOS - 1), oldest] : todos;
  const box = $('home-todos');
  box.hidden = !todos.length;
  const head = document.createElement('span');
  head.className = 'glance-head';
  head.append(categoryIcon('Todo', 18), 'Todo');
  box.replaceChildren(head);
  for (const e of shown) {
    const line = document.createElement('button');
    line.className = 'todo-line';
    onHoldRelease(line, () => removeEntry(e.id, 'done'), HOLD_TO_DONE_MS);
    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = e.text.replace(/^-\s*/, '');
    line.append(text);
    const days = Math.floor((Date.now() - Date.parse(e.createdAt)) / 864e5);
    if (e === oldest && days > 0) {
      const age = document.createElement('span');
      age.className = 'todo-age';
      age.textContent = `${days}d`;
      line.append(age);
    }
    box.append(line);
  }
  if (todos.length > shown.length) {
    const more = document.createElement('span');
    more.className = 'todos-more';
    more.textContent = `+${todos.length - shown.length} more`;
    box.append(more);
  }
}

$('home-todos').addEventListener('click', (e) => {
  const line = e.target.closest('.todo-line');
  if (line && line.held) return; // the click that ends a hold
  go({ view: 'entries', cat: 'Todo' });
});

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
