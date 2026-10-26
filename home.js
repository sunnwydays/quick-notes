// The home screen: category buttons, the ☰ menu and New project.

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
    openCategory(cat);
  });
  return btn;
}

function openCategory(cat) {
  go(cat === SCHEDULE ? { view: 'schedule', date: null } : { view: 'entries', cat });
}

// Projects go in their own zigzag on top. The seven built-ins are the petals of a
// "flower" around Add note, where the thumb rests (CSS places them in BUILT_IN order).
function renderHome() {
  const cats = orderedCategories();
  $('projects').replaceChildren(...cats.filter((c) => !BUILT_IN.includes(c)).map(categoryTile));
  $('flower').querySelectorAll('.tile').forEach((t) => t.remove());
  $('flower').prepend(...cats.filter((c) => BUILT_IN.includes(c)).map(categoryTile));
  fitGlance();
  renderSearch();
  showStatus();
}

// A few to-dos, one line each, at the top of the screen where they're read
// rather than tapped. The newest, except that the last line is the oldest, with
// its age, so an old one can't stay out of sight. Hidden when there are none.
// Tapping opens Todo; holding a line until it turns black ticks it off.
// Both columns get glanceLines lines: three, or more when there's room (fitGlance).
const HOME_LINES = 3;
let glanceLines = HOME_LINES;

// On a phone the category buttons sit at the bottom, which leaves a gap under the
// columns: the auto margin above #categories, which is 0 once nothing's spare.
// Draw them with three lines each, then add as many lines as fit in that gap,
// keeping GLANCE_ROOM px of it on top of #glance's own margin. Every line is the same height, so one
// measurement is enough. What's still left (less than a line, or more when there
// are no more to show) goes to the biggest of GLANCE_SIZES that fits: the text's
// size and the least space above and below each line. Then what's left after that
// is shared out as more space round each line, up to GLANCE_PAD_MAX, so none of it
// sits unused between the columns and the buttons. Elsewhere there's no gap and they
// stay at three, at the usual size.
const GLANCE_ROOM = 4;
const GLANCE_SIZES = [[21, 10], [20, 8], [19, 0]];
const GLANCE_PAD_MAX = 10;

function fitGlance() {
  const glance = $('glance');
  const size = (font, pad) => {
    glance.style.setProperty('--glance-font', `${font}px`);
    glance.style.setProperty('--glance-pad', `${pad}px`);
  };
  size(19, 0);
  glanceLines = HOME_LINES;
  renderTodos();
  renderHomeSchedule();
  const line = glance.querySelector('.todo-line, .glance-block');
  if (!line || !line.offsetHeight) return; // nothing to show, or hidden while searching
  const room = () => parseFloat(getComputedStyle($('categories')).marginTop) - GLANCE_ROOM;
  const extra = Math.floor(room() / line.offsetHeight);
  if (extra > 0) {
    glanceLines += extra;
    renderTodos();
    renderHomeSchedule();
  }
  for (const [font, pad] of GLANCE_SIZES) {
    size(font, pad);
    const spare = room();
    if (spare < 0) continue;
    // How much taller the columns get per 1px more padding (twice the lines in the longer one).
    const height = glance.getBoundingClientRect().height;
    size(font, pad + 1);
    const perPx = glance.getBoundingClientRect().height - height;
    const more = perPx > 0 ? Math.floor((spare / perPx) * 4) / 4 : 0;
    size(font, Math.max(pad, Math.min(GLANCE_PAD_MAX, pad + more)));
    return;
  }
  size(19, 0);
}

// The free height changes when the keyboard closes or the phone turns.
window.addEventListener('resize', () => {
  if (!current) fitGlance();
});

function renderTodos() {
  const todos = entriesFor('Todo');
  const oldest = todos.length > glanceLines ? todos[todos.length - 1] : null;
  const shown = oldest ? [...todos.slice(0, glanceLines - 1), oldest] : todos;
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
