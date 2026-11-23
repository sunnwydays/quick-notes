const PLAN_COLOURS = ['#c8efd9', '#ffdcc8', '#e5dcfa', '#fff1ba', '#d5ebff', '#f9d9ea'];
const COLOUR_NAMES = ['Mint', 'Peach', 'Lavender', 'Butter yellow', 'Powder blue', 'Pink'];
const BLOCK_KINDS = {
  '': 'Automatic', study: 'Study', project: 'Project / AI tutor', prep: 'Event prep',
  almost: 'Almost done', fun: 'Open-ended fun', free: 'Free', buffer: 'Buffer',
  exercise: 'Exercise', routine: 'Routine', meal: 'Meal', travel: 'Travel', event: 'Fixed event',
};
const FIRST_WEEK_GOALS = { chess: 6, lab: 2, fitness: 6.5, study: 20 };
const WIND_DOWN = ['22:00', 60, 'Screens off · read, walk or paper'];
const TEMPLATES = {
  Weekday: {
    wake: '07:00', startOffset: 0, deepCap: 4, anchors: [
      ['07:00', 45, 'Wake + breakfast + routine'], ['07:45', 30, 'Walk outside'],
      ['11:30', 50, 'Lunch + dishes + read', 'meal'], ['12:20', 25, 'Free', 'free'],
      ['14:10', 30, 'Afternoon cardio', 'exercise', 30], ['15:10', 45, 'Buffer', 'buffer'],
      ['17:00', 50, 'Dinner + dishes', 'meal'], ['21:30', 15, 'Review'], WIND_DOWN,
    ],
  },
  'Exam / interview': {
    wake: '07:00', startOffset: 0, deepCap: 4, event: true, noNewAfter: 16 * 60,
    hint: 'Light recall only. Allow 30 minutes to get there and settle.',
    anchors: [['12:20', 25, 'Free', 'free'], ['21:30', 15, 'Review'], WIND_DOWN],
  },
  'Recovery / social': {
    wake: '09:00', startOffset: 0, deepCap: 2, workCap: 2, noGhosts: true,
    hint: 'After a late night: up by 09:00, outside early, nap 25 minutes at most, usual bedtime. Two work blocks.',
    anchors: [['09:00', 30, 'Wake + breakfast'], ['09:30', 30, 'Walk outside · morning light'],
      ['11:30', 50, 'Lunch + dishes + read', 'meal'], ['12:20', 25, 'Free', 'free'], ['14:00', 25, 'Nap (25 min max)'],
      ['15:10', 45, 'Buffer', 'buffer'], ['17:00', 50, 'Dinner + dishes', 'meal'], WIND_DOWN],
  },
  'Welding Sunday': {
    wake: '07:00', startOffset: 0, deepCap: 1, workCap: 1, workStart: 17 * 60,
    hint: 'Welding from 09:00 to 17:00, then an evening review.',
    anchors: [['09:00', 480, 'Welding', 'event'], ['21:30', 15, 'Review'], WIND_DOWN],
  },
  'Game day': {
    wake: '07:00', startOffset: 0, deepCap: 4, event: true, workBeforeEvent: true,
    hint: 'Allow 30 minutes for travel. Keep work before the game.',
    anchors: [WIND_DOWN],
  },
};

let monday;
let plan;
let activeDrag;
let editedBlock;
let tileClick;
let templateDate;
let editingGoal;
let restacking;
let selectedDay;
let goalsOpen = false;
let lastPointerType;

function schedulesForWeek(keys) {
  const latest = new Map();
  const wanted = new Set(keys);
  for (const entry of entriesFor(SCHEDULE)) {
    const key = scheduleDay(entry);
    // Only the newest note is useful here, including when older versions have identical text.
    if (wanted.has(key) && !latest.has(key)) latest.set(key, entry);
  }
  return latest;
}

function openPlannerWeek() {
  const key = weekKey(monday);
  const keys = Array.from({ length: 7 }, (_, i) => dayKey(addDays(monday, i)));
  const saved = plannerNote(PLAN_WEEK, key);
  const goals = plannerNote(PLAN_GOALS, key);
  const schedules = schedulesForWeek(keys);
  const sources = {};
  const days = {};
  for (const date of keys) {
    const schedule = schedules.get(date);
    const day = saved?.value.days?.[date];
    days[date] = Array.isArray(day?.blocks) ? day : dayFromSchedule(schedule);
    // Older imports treated every written time range as a pin.
    if (day?.imported && !day.pinLayout && Array.isArray(day.blocks) && day.blocks.some((block) => block.pinned)) {
      days[date] = { ...day, blocks: day.blocks.map((block) => ({ ...block, pinned: null })) };
    }
    sources[date] = Array.isArray(day?.blocks) ? saved.value.sources?.[date] ?? null : schedule?.id ?? null;
  }
  planSnap = null;
  plan = { key, keys, days, sources, schedules, version: saved?.entry.id ?? null, dirtyDays: new Set(), scheduleDirty: new Set(),
    budgets: goals?.value || {}, goalVersion: goals?.entry.id ?? null, goalsDirty: false,
    tray: Array.isArray(saved?.value.tray?.week) ? saved.value.tray.week : [], trayDirty: false, pendingMarks: [],
    savedDates: new Set(Object.keys(saved?.value.days || {})) };
}

function changedInDash(key, schedules = plan.schedules) {
  const current = schedules.get(key);
  const source = plan.sources[key];
  if ((current?.id ?? null) === source) return false;
  return !current || data.entries.find((entry) => entry.id === source)?.text !== current.text;
}

// A saved note overrides the built-in of the same name; a note with `deleted` hides it.
function getTemplate(name) {
  const saved = plannerNote(PLAN_TEMPLATE, name)?.value;
  if (saved) return saved.deleted ? null : saved;
  return Object.hasOwn(TEMPLATES, name) ? TEMPLATES[name] : null;
}

function templateNames() {
  const names = new Set([...Object.keys(TEMPLATES), ...plannerNotes(PLAN_TEMPLATE).keys()]);
  return [...names].filter((name) => getTemplate(name));
}

// The planner saves itself a moment after each edit. `ask` false (the page is closing)
// skips the "changed in Dash" question and leaves those changes unsaved instead.
function saveWeek({ ask = true } = {}) {
  reload();
  const originalStore = localStorage.getItem(STORE_KEY);
  const previous = plannerNote(PLAN_WEEK, plan.key);
  if ((previous?.entry.id ?? null) !== plan.version) {
    $('plan-status').textContent = 'A newer planner version arrived. Reopen the week before saving.';
    return;
  }
  const goalVersion = plannerNote(PLAN_GOALS, plan.key);
  if (plan.goalsDirty && (goalVersion?.entry.id ?? null) !== plan.goalVersion) {
    $('plan-status').textContent = 'A newer goal budget arrived. Reopen the week before saving.';
    return;
  }
  const schedules = schedulesForWeek(plan.keys);
  const notes = [];
  const days = { ...plan.days };
  const sources = { ...plan.sources };
  const dashDays = new Set();
  const syncDays = new Set(plan.scheduleDirty);
  for (const key of plan.keys) {
    const entry = schedules.get(key);
    const changed = changedInDash(key, schedules) && (plan.dirtyDays.has(key) || plan.savedDates.has(key));
    if (changed && !ask) return false;
    if (changed && !confirm(`${dayLabel(key)} changed in Dash. OK keeps the planner version. Cancel uses Dash.`)) {
      days[key] = dayFromSchedule(entry);
      dashDays.add(key);
      syncDays.delete(key);
    } else if (changed) syncDays.add(key);
    else if (changedInDash(key, schedules) && !syncDays.has(key)) days[key] = dayFromSchedule(entry);
  }
  const nextWeeks = carryNextAcrossWeeks(days, notes);
  for (const key of plan.keys) {
    const entry = schedules.get(key);
    if (syncDays.has(key) || nextWeeks.has(key)) {
      if (layoutDay(days[key]).blocks.some((block) => block.start < 0 || block.until > DAY_END)) {
        $('plan-status').textContent = `${dayLabel(key)} has a block outside the day. Adjust its time before saving.`;
        return;
      }
      const text = scheduleText(key, days[key]);
      if ((entry || days[key].blocks.length) && changesSchedule(text)) {
        const note = plannerEntry(SCHEDULE, text, entry);
        notes.push(note);
        sources[key] = note.id;
        continue;
      }
    }
    sources[key] = entry?.id ?? null;
  }
  const marks = plan.pendingMarks.filter((mark) => !dashDays.has(mark.day));
  const text = JSON.stringify({ key: plan.key, value: { days, sources, tray: { week: plan.tray } } });
  const weekNote = text !== previous?.entry.text ? plannerEntry(PLAN_WEEK, text, previous?.entry) : null;
  if (weekNote) notes.push(weekNote);
  let goalNote = null;
  if (plan.goalsDirty) {
    const text = JSON.stringify({ key: plan.key, value: plan.budgets });
    if (text !== goalVersion?.entry.text) notes.push(goalNote = plannerEntry(PLAN_GOALS, text, goalVersion?.entry));
  }
  const templates = new Set(Object.values(days).map((day) => day.template).filter((name) => Object.hasOwn(TEMPLATES, name)));
  for (const name of templates) {
    if (plannerNote(PLAN_TEMPLATE, name)) continue;
    const value = { name, ...TEMPLATES[name] };
    notes.push(plannerEntry(PLAN_TEMPLATE, JSON.stringify({ key: name, value })));
  }
  if (localStorage.getItem(STORE_KEY) !== originalStore) {
    $('plan-status').textContent = 'Notes changed while saving. Try again to review the latest versions.';
    return;
  }
  data.entries.push(...notes);
  data.marks.push(...marks);
  try {
    if (notes.length || marks.length) persist();
  } catch {
    reload();
    $('plan-status').textContent = 'Could not save. Device storage is full or unavailable.';
    return;
  }
  const count = notes.filter((entry) => entry.category === SCHEDULE).length;
  // Keep the open week (and its Undo history) instead of reopening it from the saved notes.
  Object.assign(plan, { days, sources, schedules: schedulesForWeek(plan.keys), savedDates: new Set(plan.keys),
    version: weekNote?.id ?? plan.version, goalVersion: goalNote?.id ?? goalVersion?.entry.id ?? null,
    trayDirty: false, goalsDirty: false, pendingMarks: [] });
  plan.dirtyDays.clear();
  plan.scheduleDirty.clear();
  if (!activeDrag) renderPlanner();
  $('plan-status').textContent = count ? `Saved ${count} ${count === 1 ? 'day' : 'days'} to Dash.` : 'Saved.';
  sync();
  return true;
}

const AUTOSAVE_MS = 1000;
let autosaveTimer = null;

function queueAutosave() {
  clearTimeout(autosaveTimer);
  $('plan-status').textContent = 'Saving…';
  autosaveTimer = setTimeout(autosave, AUTOSAVE_MS);
}

// Wait out drags and open dialogs so a "changed in Dash" question never lands mid-gesture.
function autosave() {
  autosaveTimer = null;
  if (!plan || !isPlannerDirty()) return;
  if (activeDrag || document.querySelector('dialog[open]')) autosaveTimer = setTimeout(autosave, AUTOSAVE_MS);
  else saveWeek();
}

function flushAutosave(ask = true) {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  if (plan && isPlannerDirty()) saveWeek({ ask });
}

function element(tag, className = '', text = '') {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

function plannerButton(text, action, className = '') {
  const button = element('button', className, text);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

function plannerGoals() {
  return entriesFor('Working on');
}

function goalColour(goal) {
  const saved = plan.budgets[goal]?.colour;
  if (PLAN_COLOURS.includes(saved)) return saved;
  const index = plannerGoals().findIndex((entry) => entry.id === goal);
  return index < 0 ? '' : PLAN_COLOURS[index % PLAN_COLOURS.length];
}

function goalHours(entry) {
  if (Object.hasOwn(plan.budgets, entry.id)) return plan.budgets[entry.id]?.hours ?? null;
  return plan.key === '2026-W48' ? FIRST_WEEK_GOALS[bare(entry.text).trim().toLowerCase()] ?? null : null;
}

function isPlannerDirty() {
  return plan.dirtyDays.size > 0 || plan.trayDirty || plan.goalsDirty;
}

// Planner Undo: renderPlanner snapshots the state it drew, so the snapshot taken
// before an edit is what Undo restores. Undo pops a stack, newest edit first.
let planSnap = null;
const undoStack = [];

function snapshotPlan() {
  const { days, tray, budgets, pendingMarks, dirtyDays, scheduleDirty, trayDirty, goalsDirty } = plan;
  return structuredClone({ days, tray, budgets, pendingMarks, dirtyDays, scheduleDirty, trayDirty, goalsDirty });
}

function hidePlanUndo() {
  undoStack.length = 0;
  $('plan-undo-btn').disabled = true;
}

function markEdited() {
  const before = planSnap;
  renderPlanner();
  queueAutosave();
  if (!before) return;
  undoStack.push(before);
  if (undoStack.length > 50) undoStack.shift();
  $('plan-undo-btn').disabled = false;
}

$('plan-undo-btn').onclick = () => {
  const before = undoStack.pop();
  if (!before) return;
  Object.assign(plan, structuredClone(before));
  // The snapshot's dirty flags predate the last save, so mark everything for the autosave to compare.
  for (const key of plan.keys) {
    plan.dirtyDays.add(key);
    plan.scheduleDirty.add(key);
  }
  plan.trayDirty = true;
  plan.goalsDirty = true;
  planSnap = null;
  renderPlanner();
  queueAutosave();
  $('plan-undo-btn').disabled = !undoStack.length;
};

// Ctrl/Cmd+Z undoes like the button, except while typing (that keeps the field's own undo).
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return;
  if (event.target.matches('textarea, select, input:not([type=checkbox]):not([type=radio])')) return;
  if ($('block-editor').open || $('plan-undo-btn').disabled) return;
  event.preventDefault();
  $('plan-undo-btn').click();
});

function removeFromDay(key, day, remaining) {
  storeDay(key, day.imported ? { ...day, blocks: remaining } : editDay(day, remaining));
}

function storeDay(key, day, bumpToTray = false) {
  const { bumped } = layoutDay(day);
  const bumpedIds = new Set(bumped.map((block) => block.id));
  const ended = key < dayKey(new Date());
  const blocks = [];
  for (const block of day.blocks) {
    if (!bumpedIds.has(block.id)) blocks.push(block);
    else if (!ended && !bumpToTray) blocks.push({ ...untimedBlock(block), bumped: true });
    else {
      plan.tray.push({ ...untimedBlock(block), bumped: true, bumpedFrom: key });
      plan.trayDirty = true;
    }
  }
  plan.days[key] = { ...day, blocks };
  plan.dirtyDays.add(key);
  plan.scheduleDirty.add(key);
}

function blockSource(tile) {
  const { id, date, source } = tile.dataset;
  if (date) return { date, block: plan.days[date].blocks.find((block) => block.id === id) };
  if (source === 'parked') return { parked: true, category: 'Todo', block: plan.tray.find((block) => block.id === id) };
  const entry = entriesFor(source).find((item) => item.id === id);
  if (!entry) return null;
  return { copy: true, category: source, entry, block: trayTodo(entry) };
}

// Same delete-plus-new-copy move as the notes screen, between Todo and Someday.
// A parked block with no note behind it becomes a new note with its text.
function moveNote(id, category, fallbackText) {
  const entry = data.entries.find((item) => item.id === id && !item.deletedAt);
  const text = entry?.text ?? fallbackText;
  if (!text) return;
  const now = new Date().toISOString();
  if (entry) touch(entry, { deletedAt: now, deletedHow: 'moved' });
  data.entries.push({ id: newId(), category, text, createdAt: now, updatedAt: now, deletedAt: null, dirty: true });
  persist();
  sync();
  renderPlanner();
}

function trayTodo(entry, goals = plannerGoals()) {
  const text = bare(entry.text).replace(/\s+/g, ' ');
  const size = Number(/\b(30|45|60|90)\s*m(?:in)?\b/i.exec(text)?.[1]) || 45;
  const goal = goals.find((item) => text.toLowerCase().startsWith(`${bare(item.text).trim().toLowerCase()}:`));
  return planBlock(newId(), text, { todoId: entry.id, size, goal: goal?.id ?? null });
}

function pinCollision(block, blocks) {
  const start = block.actualStart ?? planMinutes(block.pinned);
  if (start == null) return false;
  return blocks.some((other) => {
    const at = other.actualStart ?? planMinutes(other.pinned);
    return at != null && start < (other.actualUntil ?? at + blockDuration(other)) &&
      at < (block.actualUntil ?? start + blockDuration(block));
  });
}

// Move a block, building the replacement stacks before changing either day.
// target says where it goes:
//   date    the day (none means the week tray)
//   shelf   the day's Untimed shelf instead of its timeline
//   before  id of the block it stacks in front of
//   at      'HH:MM' to place it at on the timeline
//   pin     true pins it at `at`, false unpins it; left out, it keeps the pin it had
//   copy    (option) leaves the original where it is and drops a new block with a fresh id
function moveBlock(source, target, changes = {}, { copy = false } = {}) {
  if (!source?.block) return 'That block is no longer available.';
  const old = source.block;
  const changed = { ...old, ...changes, bumped: false, bumpedFrom: undefined };
  if (copy) {
    // A duplicate is its own block: no link to the note and no progress carried over.
    changed.id = newId();
    changed.todoId = null;
    changed.done = '';
    delete changed.actualStart;
    delete changed.actualUntil;
  }
  const origin = source.date && plan.days[source.date];
  const remaining = origin?.blocks.filter((block) => block.id !== old.id);
  if (!target.date) {
    if (origin && !copy) removeFromDay(source.date, origin, remaining);
    plan.tray = plan.tray.filter((block) => block.id !== old.id);
    plan.tray.push(untimedBlock(changed));
    plan.trayDirty = true;
    markEdited();
    return '';
  }
  const day = plan.days[target.date];
  const blocks = source.date === target.date && !copy ? remaining : [...day.blocks];
  // A block that is placed or (un)pinned starts fresh: its old actual times no longer apply.
  const moved = !target.shelf && (target.at != null || target.pin != null);
  let block;
  if (target.shelf) block = untimedBlock(changed);
  else if (!moved) block = { ...changed, shelf: false };
  else {
    const { actualStart, actualUntil, ...fresh } = changed;
    const pinned = target.pin ?? planMinutes(changed.pinned) != null;
    block = { ...fresh, shelf: false, pinned: pinned ? target.at ?? changed.pinned : null };
  }
  const placeAt = target.shelf ? null : planMinutes(target.at) ?? planMinutes(block.pinned);
  if (placeAt != null && placeAt + blockDuration(block) > DAY_END) return 'Choose a time that ends by midnight.';
  const probe = placeAt != null ? { ...block, pinned: blockKey(placeAt) } : block;
  const keepsActual = !copy && source.date === target.date && block.actualStart != null;
  if (!keepsActual && pinCollision(probe, blocks)) return 'That time overlaps another pinned block.';
  const index = blocks.findIndex((item) => item.id === target.before);
  blocks.splice(index < 0 ? blocks.length : index, 0, block);
  if (origin && source.date !== target.date && !copy) removeFromDay(source.date, origin, remaining);
  if (source.parked && !copy) {
    plan.tray = plan.tray.filter((item) => item.id !== old.id);
    plan.trayDirty = true;
  }
  storeDay(target.date, moved && placeAt != null ? placeInDay(day, blocks, block, placeAt) : editDay(day, blocks));
  markEdited();
  return '';
}

// A to-do list item is a Dash note, so deleting or ticking it off removes the note, as Dash does.
// A scheduled block linked to a Todo does the same to its note.
function removeNote(id, how) {
  const entry = id && data.entries.find((item) => item.id === id && !item.deletedAt);
  if (!entry) return;
  touch(entry, { deletedAt: new Date().toISOString(), deletedHow: how });
  persist();
  sync();
  renderPlanner();
}

function liveTodo(id) {
  return id ? data.entries.find((entry) => entry.id === id && !entry.deletedAt) ?? null : null;
}

// Sync can't change a note's text, so renaming a linked Todo replaces it with a copy
// (same createdAt, so it keeps its place) and points every block at the copy.
function renameTodo(id, text) {
  const old = liveTodo(id);
  if (!old || bare(old.text).replace(/\s+/g, ' ') === text) return;
  const now = new Date().toISOString();
  const copy = { ...old, id: newId(), text: `${BULLET}${text}`, updatedAt: now, deletedAt: null, deletedHow: null, dirty: true };
  touch(old, { deletedAt: now, deletedHow: 'replaced' });
  data.entries.push(copy);
  for (const [key, day] of Object.entries(plan.days)) {
    if (!day.blocks.some((block) => block.todoId === id)) continue;
    plan.days[key] = { ...day, blocks: day.blocks.map((block) => block.todoId === id ? { ...block, todoId: copy.id } : block) };
    plan.dirtyDays.add(key);
  }
  plan.tray = plan.tray.map((block) => block.todoId === id ? { ...block, todoId: copy.id } : block);
  plan.trayDirty = true;
  persist();
  sync();
  renderPlanner();
}

function deleteBlock(source) {
  if (!source?.block) return;
  if (source.copy) removeNote(source.entry.id, 'deleted');
  else if (source.date) {
    removeNote(source.block.todoId, 'deleted');
    const day = plan.days[source.date];
    removeFromDay(source.date, day, day.blocks.filter((block) => block.id !== source.block.id));
  } else {
    removeNote(source.block.todoId, 'deleted');
    plan.tray = plan.tray.filter((block) => block.id !== source.block.id);
    plan.trayDirty = true;
  }
  markEdited();
}

function fillOptions(select, items, value) {
  select.replaceChildren(...items.map(([id, label]) => new Option(label, id)));
  select.value = value;
}

// Where a block lives decides where the editor puts it: a day's stack, its Untimed shelf, or the week tray.
function blockTarget(source) {
  return source.date ? { date: source.date, shelf: Boolean(source.block.shelf) } : {};
}

// Pressing Delete as the very first thing after opening an existing item deletes it (as does Delete outside a text field).
let quickDelete = false;

function openBlockEditor(source, target = blockTarget(source)) {
  editedBlock = { ...source, target };
  const block = source.block;
  const { date, shelf } = target;
  const timed = Boolean(date && !shelf);
  const fields = $('block-form').elements;
  fields.text.value = block.text;
  fields.next.value = block.next;
  fields.tail.value = block.tail;
  fillOptions(fields.kind, Object.entries(BLOCK_KINDS), block.kind || '');
  fields.size.value = block.duration ?? block.size;
  const goals = plannerGoals().map((item) => [item.id, bare(item.text)]);
  if (block.goal && !goals.some(([id]) => id === block.goal)) goals.push([block.goal, 'Archived goal']);
  fillOptions(fields.goal, [['', 'No goal'], ...goals], block.goal || '');
  const start = target.at ?? block.pinned ??
    (source.date ? blockKey(layoutDay(plan.days[source.date]).blocks.find((b) => b.id === block.id)?.start ?? PLAN_START) : '07:00');
  fields.pin.checked = Boolean(block.pinned);
  fields.time.value = start;
  const end = blockKey(planMinutes(start) + blockDuration(block));
  $('block-where').textContent = !date ? 'This week tray' : `${dayLabel(date)} · ${timed ? `${clock12(start)}–${clock12(end)}` : 'To do'}`;
  $('pin-fields').hidden = !timed;
  $('block-more').open = false;
  // A drag already chose the time and length, so they sit at the top of More there.
  const dragged = Boolean(source.fresh && target.at);
  const more = $('block-more').querySelector('.more-fields');
  if (dragged) {
    more.prepend($('pin-fields'));
    $('pin-fields').prepend($('block-length'));
  }
  else {
    $('block-main-row').prepend($('block-length'));
    more.append($('pin-fields'));
  }
  $('block-main-row').classList.toggle('field-row', !dragged);
  $('block-editor-title').textContent = source.fresh ? 'Add item' : 'Edit item';
  $('block-delete').hidden = Boolean(source.fresh);
  $('block-done').hidden = !source.copy && !liveTodo(block.todoId);
  quickDelete = !$('block-delete').hidden;
  // Existing planned or parked blocks can be copied onto another day of this week.
  $('block-copy-row').hidden = Boolean(source.fresh || source.copy);
  fillOptions($('block-copy'), [['', 'Another day…'],
    ...Object.keys(plan.days).filter((key) => key !== date).map((key) => [key, dayLabel(key)])], '');
  $('block-error').hidden = true;
  updateEditorFields();
  $('block-editor').showModal();
}

// Minute fields are scrub sliders: drag sideways (1 min per SCRUB_PX), click to type, or use the arrows (±5).
// initScrub wraps any <input data-scrub> in the slider; setting .value moves the ticks too.
const SCRUB_PX = 4;
const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

function initScrub(input) {
  const scrub = element('span', 'scrub');
  input.replaceWith(scrub);
  const arrow = (step) => {
    const button = element('button', 'scrub-step');
    button.type = 'button';
    button.dataset.step = step;
    button.setAttribute('aria-label', `${Math.abs(step)} minutes ${step > 0 ? 'more' : 'less'}`);
    return button;
  };
  // Input first: a wrapping label hovers/focuses its first labelable child, which must not be an arrow.
  scrub.append(input, element('span', 'scrub-unit', 'min'), arrow(-5), arrow(5));
  input.inputMode = 'numeric';
  const shift = () => scrub.style.setProperty('--shift', `${-(Number(nativeValue.get.call(input)) || 0) * SCRUB_PX}px`);
  Object.defineProperty(input, 'value', {
    get() { return nativeValue.get.call(this); },
    set(value) { nativeValue.set.call(this, value); shift(); },
  });
  const clamp = (value) => Math.min(Number(input.max || Infinity), Math.max(Number(input.min || 0), value));
  const change = (value, type = 'input') => {
    if (value !== Number(input.value)) input.value = value;
    input.dispatchEvent(new Event(type, { bubbles: true }));
  };
  let drag = null;
  scrub.addEventListener('pointerdown', (event) => {
    if (input.disabled || document.activeElement === input || event.target.closest('.scrub-step')) return;
    event.preventDefault();
    drag = { x: event.clientX, value: Number(input.value) || 0, moved: false };
    scrub.setPointerCapture(event.pointerId);
    scrub.classList.add('dragging');
  });
  scrub.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (!drag.moved) return;
    const value = clamp(drag.value + Math.round(dx / SCRUB_PX));
    if (value !== Number(input.value)) change(value);
  });
  const end = () => {
    if (!drag) return;
    if (drag.moved) change(Number(input.value), 'change');
    else { input.focus(); input.select(); }
    drag = null;
    scrub.classList.remove('dragging');
  };
  scrub.addEventListener('pointerup', end);
  scrub.addEventListener('pointercancel', end);
  // Stops the surrounding label from focusing the field after a drag.
  scrub.addEventListener('click', (event) => { if (event.target === scrub) event.preventDefault(); });
  input.addEventListener('input', shift);
  // The arrows jump to the next multiple of 5 minutes either way.
  for (const button of scrub.querySelectorAll('.scrub-step')) {
    button.addEventListener('click', () => {
      if (input.disabled) return;
      const value = Number(input.value) || 0;
      const step = Number(button.dataset.step);
      const next = step > 0 ? Math.floor(value / 5) * 5 + 5 : Math.ceil(value / 5) * 5 - 5;
      change(clamp(next));
      change(Number(input.value), 'change');
    });
  }
  shift();
}

function updateEditorFields() {
  const fields = $('block-form').elements;
  fields.pin.disabled = $('pin-fields').hidden;
  // A dragged item's time can be adjusted without pinning it.
  fields.time.disabled = fields.pin.disabled || !fields.pin.checked && editedBlock.target.at == null;
  fields.time.required = !fields.time.disabled;
}

function applyBlockEditor(event) {
  event.preventDefault();
  const fields = event.target.elements;
  const text = fields.text.value.trim();
  if (!text) return;
  const { date = null, shelf = false } = editedBlock.target;
  const original = editedBlock.block;
  const pinned = !fields.pin.disabled && fields.pin.checked ? fields.time.value : null;
  const pinChanged = pinned !== (original.pinned ?? null);
  // A dragged item keeps the time it was drawn at (or the one typed over it), pinned or not.
  const time = pinned ?? (editedBlock.target.at == null ? null : fields.time.value);
  const day = plan.days[date];
  const size = Number(fields.size.value);
  const resized = size !== (original.duration ?? original.size);
  // Done and deadline are no longer edited here, so existing values carry over untouched.
  const changes = {
    text, next: fields.next.value.trim(), goal: fields.goal.value || null,
    tail: Number(fields.tail.value), kind: fields.kind.value || undefined,
    ...resized ? { size, duration: undefined } : {},
  };
  const unchanged = (key) => (changes[key] ?? null) === (original[key] ?? null);
  if (!editedBlock.fresh && Object.keys(changes).every(unchanged)) {
    if (!pinChanged) {
      $('block-editor').close();
      return;
    }
    const updated = date && !shelf && toggleBlockPin(day, original.id, pinned);
    if (updated) {
      plan.days[date] = updated;
      plan.dirtyDays.add(date);
      $('block-editor').close();
      markEdited();
      return;
    }
  }
  const oldIndex = day?.blocks.findIndex((block) => block.id === original.id) ?? -1;
  let before = oldIndex < 0 ? undefined : day.blocks[oldIndex + 1]?.id;
  const minute = planMinutes(time);
  if (date && !shelf && minute != null && (pinChanged || oldIndex < 0)) {
    before = layoutDay(day).blocks.find((b) => b.id !== original.id && b.start >= minute)?.id;
  } else if (date && !shelf && (oldIndex < 0 || original.shelf)) {
    const stack = layoutDay(day).blocks;
    const cutoff = Math.max(day.workEnd ?? 17 * 60, day.workStart ?? 0);
    before = stack.find((b) => b.pinned && b.start >= cutoff)?.id;
  }
  const target = { date, shelf, before };
  if (date && (date !== editedBlock.date || pinChanged || resized)) Object.assign(target, { at: time ?? undefined, pin: pinned != null });
  const todo = editedBlock.fresh && !original.todoId && !NOT_TASKS.has(changes.kind) ? linkTodo(text) : null;
  if (todo) changes.todoId = todo.entry.id;
  const error = moveBlock(editedBlock, target, changes);
  if (error) {
    if (todo?.added) data.entries.splice(data.entries.indexOf(todo.entry), 1);
    $('block-error').textContent = error;
    $('block-error').hidden = false;
  } else {
    if (todo?.added) persist();
    if (!editedBlock.fresh && text !== original.text) renameTodo(original.todoId, text);
    $('block-editor').close();
  }
}

// Items added in the planner also land in Dash's Todo, unless they're routine filler.
const NOT_TASKS = new Set(['free', 'buffer', 'meal', 'routine']);

function linkTodo(text) {
  const same = entriesFor('Todo').find((entry) => bare(entry.text).trim().toLowerCase() === text.toLowerCase());
  if (same) return { entry: same, added: false };
  const now = new Date().toISOString();
  const entry = { id: newId(), category: 'Todo', text: `${BULLET}${text}`, createdAt: now, updatedAt: now, deletedAt: null, dirty: true };
  data.entries.push(entry);
  return { entry, added: true };
}

function templateAnchor([pinned, duration, text, kind = 'routine', tail = 0]) {
  return planBlock(newId(), text, { pinned, duration, kind, tail, tier: 'fixed', templateAnchor: true });
}

function recoverySuggested(key) {
  return entriesFor('Journal').some((entry) => {
    const timestamp = new Date(entry.createdAt);
    const minute = timestamp.getHours() * 60 + timestamp.getMinutes();
    return dayKey(timestamp) === key && minute > 30 && minute < PLAN_START;
  });
}

function defaultTemplate(key) {
  return recoverySuggested(key) ? 'Recovery / social' : keyDate(key).getDay() === 0 ? 'Welding Sunday' : 'Weekday';
}

// Week routine: pick a template per day in one dialog. `routineChoice` maps day key → template name ('' = none).
let routineChoice = {};
let routineDay = null;

function routineDays() {
  const today = dayKey(new Date());
  return plan.keys.filter((key) => key >= today);
}

function openRoutineEditor() {
  const open = routineDays();
  if (!open.length) {
    $('plan-status').textContent = 'This week is over. Go to next week to set its routine.';
    return;
  }
  routineChoice = Object.fromEntries(open.map((key) => [key, plan.days[key].template || 'Weekday']));
  routineDay = open[0];
  $('routine-error').hidden = true;
  renderRoutineEditor();
  $('routine-editor').showModal();
  drawRoutineLink();
}

function renderRoutineEditor() {
  const open = new Set(routineDays());
  const days = plan.keys.map((key) => {
    const past = !open.has(key);
    const button = element('button', 'routine-day');
    button.type = 'button';
    button.disabled = past;
    button.setAttribute('aria-pressed', String(key === routineDay));
    const name = past ? plan.days[key].template : routineChoice[key];
    button.append(element('b', '', dayLabel(key, false)), element('span', 'muted', name || 'No template'));
    button.addEventListener('click', () => {
      routineDay = key;
      renderRoutineEditor();
    });
    return button;
  });
  $('routine-days').replaceChildren(...days);
  const names = ['', ...templateNames().filter((name) => !getTemplate(name).event)];
  const choices = names.map((name) => {
    const label = element('label', 'choice');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'routine';
    input.value = name;
    input.checked = routineChoice[routineDay] === name;
    input.addEventListener('change', () => {
      routineChoice[routineDay] = name;
      renderRoutineEditor();
    });
    label.append(input, element('b', '', name || 'No template'));
    return label;
  });
  $('routine-choices').replaceChildren(element('p', 'muted', dayLabel(routineDay)), ...choices);
  drawRoutineLink();
}

// Joins the selected day to its chosen template: a line out of the day, a highlighted stretch of the divider, a line into the choice.
function drawRoutineLink() {
  const grid = document.querySelector('.routine-grid');
  while (grid.querySelectorAll('.routine-link').length < 3) grid.append(element('div', 'routine-link'));
  const [left, mid, right] = grid.querySelectorAll('.routine-link');
  const day = $('routine-days').querySelector('[aria-pressed="true"]');
  const choice = $('routine-choices').querySelector('input:checked')?.parentElement;
  const hidden = !day || !choice || !grid.offsetWidth;
  for (const line of [left, mid, right]) line.hidden = hidden;
  if (hidden) return;
  const base = grid.getBoundingClientRect();
  const dayBox = day.getBoundingClientRect();
  const choiceBox = choice.getBoundingClientRect();
  const x = $('routine-choices').getBoundingClientRect().left - base.left;
  const y1 = dayBox.top + dayBox.height / 2 - base.top;
  const y2 = choiceBox.top + choiceBox.height / 2 - base.top;
  const place = (line, l, t, w, h) => Object.assign(line.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px` });
  place(left, dayBox.right - base.left, y1 - 1, x - (dayBox.right - base.left), 2);
  place(mid, x - 1, Math.min(y1, y2) - 1, 2, Math.abs(y2 - y1) + 2);
  place(right, x, y2 - 1, choiceBox.left - base.left - x, 2);
}

function applyRoutineEditor(event) {
  event.preventDefault();
  const changed = [];
  const clashes = [];
  for (const [key, name] of Object.entries(routineChoice)) {
    if (name === (plan.days[key].template || '')) continue;
    const result = replaceTemplate(plan.days[key], name, name ? getTemplate(name) : null, null);
    if (result.error) clashes.push(dayLabel(key, false));
    else changed.push([key, result.day]);
  }
  if (clashes.length) {
    $('routine-error').textContent = `${clashes.join(', ')}: the routine overlaps a pinned block. Move the pin or pick another routine.`;
    $('routine-error').hidden = false;
    return;
  }
  $('routine-editor').close();
  if (!changed.length) return;
  for (const [key, day] of changed) storeDay(key, day);
  markEdited(`Routine set for ${changed.length} day${changed.length === 1 ? '' : 's'}.`);
}

function openTemplateEditor(key) {
  templateDate = key;
  const day = plan.days[key];
  const fields = $('template-form').elements;
  renderTemplateChoices(day.template || defaultTemplate(key));
  const event = day.blocks.find((block) => block.templateAnchor && block.kind === 'event');
  fields.event.value = event?.text || '';
  fields.start.value = event?.pinned || '';
  fields.duration.value = event?.duration || 60;
  $('template-error').hidden = true;
  updateTemplateFields();
  $('template-editor').showModal();
}

function describeTemplate(template) {
  if (template.hint) return template.hint;
  const count = template.anchors?.length || 0;
  return [`Wake ${clock12(template.wake || '07:00')}`, count ? `${count} fixed block${count === 1 ? '' : 's'}` : 'blank day',
    template.event && 'asks for an event'].filter(Boolean).join(' · ');
}

function renderTemplateChoices(selected) {
  const rows = [['', 'No template', 'Remove the template anchors and keep your blocks.'],
    ...templateNames().map((name) => [name, name, describeTemplate(getTemplate(name))])];
  const choices = rows.map(([value, title, text]) => {
    const label = element('label', 'choice');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'template';
    input.value = value;
    input.checked = value === selected;
    label.append(input, element('b', '', title), element('span', 'muted', text));
    return label;
  });
  if (!choices.some((label) => label.firstChild.checked)) choices[0].firstChild.checked = true;
  $('template-choices').replaceChildren(...choices);
}

const ANCHOR_KINDS = ['routine', 'meal', 'exercise', 'free', 'buffer', 'event'];
let editingTemplate = null;
// The template being edited, laid out like a day: { id, start, duration, text, kind, tail }.
let tplBlocks = [];
let tplSelected = null;
let tplDrag = null;
let tplPointer = '';
let tplSkipClick = false;

function templateField(name) {
  return $('template-block').querySelector(`[data-f="${name}"]`);
}

function templateRange() {
  const wake = planMinutes($('template-def-form').elements.wake.value) ?? PLAN_START;
  return [Math.floor(Math.min(wake, PLAN_START, ...tplBlocks.map((block) => block.start)) / 60) * 60, DAY_END];
}

function halfHourLine(minute) {
  const line = element('span', 'hour half');
  line.style.setProperty('--minute', minute);
  return line;
}

function renderTemplateDay() {
  const timeline = $('template-day');
  const [from, until] = templateRange();
  timeline.dataset.from = from;
  timeline.dataset.until = until;
  timeline.style.setProperty('--minutes', until - from);
  const parts = [];
  for (let hour = from; hour < until; hour += 60) {
    const line = element('span', 'hour');
    line.append(element('span', 'hour-label', clock12(hour).replace(':00', '')));
    line.style.setProperty('--minute', hour - from);
    parts.push(line);
    if (hour + 30 < until) parts.push(halfHourLine(hour + 30 - from));
  }
  for (const block of tplBlocks) {
    const tile = renderTile(planBlock(block.id, block.text || 'Untitled', { kind: block.kind, tier: 'fixed' }));
    timeTile(tile, block.start, block.start + block.duration + block.tail, from);
    if (block.tail > 0) {
      tile.style.setProperty('--tail', block.tail);
      tile.append(element('span', 'tail', `+${block.tail}m`));
    }
    tile.classList.toggle('selected', block.id === tplSelected);
    parts.push(tile);
  }
  if (tplDrag?.preview) parts.push(tplDrag.preview);
  timeline.replaceChildren(...parts);
}

function showTemplateBlock() {
  const block = tplBlocks.find((item) => item.id === tplSelected);
  $('template-block').hidden = !block;
  $('template-block-hint').hidden = Boolean(block);
  if (!block) return;
  templateField('text').value = block.text;
  templateField('time').value = blockKey(block.start);
  templateField('mins').value = block.duration;
  templateField('tail').value = block.tail;
  const kinds = ANCHOR_KINDS.includes(block.kind) ? ANCHOR_KINDS : [...ANCHOR_KINDS, block.kind];
  fillOptions(templateField('kind'), kinds.map((kind) => [kind, kind]), block.kind);
}

function selectTemplateBlock(id, focus = false) {
  tplSelected = id;
  renderTemplateDay();
  showTemplateBlock();
  if (focus) templateField('text').focus();
}

function addTemplateBlock(start, duration = 30) {
  const block = { id: newId(), start: Math.max(0, Math.min(start, DAY_END - duration)), duration, text: '', kind: 'routine', tail: 0 };
  tplBlocks.push(block);
  selectTemplateBlock(block.id, true);
}

function editTemplateBlock(event) {
  const block = tplBlocks.find((item) => item.id === tplSelected);
  const field = event.target.dataset.f;
  if (!block || !field) return;
  const value = event.target.value;
  if (field === 'text') block.text = value;
  if (field === 'kind') block.kind = value;
  if (field === 'time' && planMinutes(value) != null) block.start = planMinutes(value);
  if (field === 'mins' && Number.isInteger(Number(value)) && Number(value) >= 5) block.duration = Number(value);
  if (field === 'tail' && Number.isInteger(Number(value)) && Number(value) >= 0) block.tail = Number(value);
  renderTemplateDay();
}

function templateEdges(skipId) {
  return tplBlocks.filter((block) => block.id !== skipId)
    .flatMap((block) => [block.start, block.start + block.duration + block.tail]);
}

function deleteTemplateBlock() {
  tplBlocks = tplBlocks.filter((block) => block.id !== tplSelected);
  selectTemplateBlock(null);
}

// Like a day column: drag on empty space sketches a block, drag a block to move it.
function templatePointerDown(event) {
  tplPointer = event.pointerType;
  if (event.button !== 0 || tplDrag) return;
  const timeline = $('template-day');
  const edge = tileBottomEdgeAt(event);
  const tile = edge ?? event.target.closest('.tile[data-id]');
  if (edge) {
    event.preventDefault();
    tplDrag = { resize: true, id: edge.dataset.id, y: event.clientY, moved: false, pointer: event.pointerId };
  } else if (tile) {
    event.preventDefault();
    const grab = event.clientY - tile.getBoundingClientRect().top;
    tplDrag = { id: tile.dataset.id, grab, y: event.clientY, moved: false, pointer: event.pointerId };
  } else {
    if (event.pointerType === 'touch') return;
    event.preventDefault();
    const anchor = Math.min(timelineMinute(timeline, event.clientY, { round: Math.floor, edges: templateEdges() }), DAY_END - 15);
    tplDrag = { sketch: true, anchor, current: anchor, y: event.clientY, moved: false, pointer: event.pointerId };
  }
  timeline.setPointerCapture(event.pointerId);
}

function templatePointerMove(event) {
  if (tplDrag?.pointer !== event.pointerId) return;
  if (!tplDrag.moved && Math.abs(event.clientY - tplDrag.y) < 6) return;
  tplDrag.moved = true;
  const timeline = $('template-day');
  if (tplDrag.resize) {
    const block = tplBlocks.find((item) => item.id === tplDrag.id);
    const end = Math.min(timelineMinute(timeline, event.clientY, { edges: templateEdges(block.id) }), DAY_END);
    const duration = Math.max(15, end - block.start - block.tail);
    if (duration === block.duration && tplSelected === block.id) return;
    block.duration = duration;
    selectTemplateBlock(block.id);
    return;
  }
  if (tplDrag.sketch) {
    tplDrag.current = timelineMinute(timeline, event.clientY, { edges: templateEdges() });
    const [start, end] = draftRange(tplDrag);
    tplDrag.preview ??= element('div', 'tile timed draft');
    tplDrag.preview.style.setProperty('--minute', start - Number(timeline.dataset.from));
    tplDrag.preview.style.setProperty('--duration', end - start);
    tplDrag.preview.textContent = `${clock12(start)}–${clock12(end)}`;
    if (!tplDrag.preview.isConnected) timeline.append(tplDrag.preview);
    return;
  }
  const block = tplBlocks.find((item) => item.id === tplDrag.id);
  const edges = movingEdges(templateEdges(block.id), block.duration + block.tail);
  const start = Math.min(timelineMinute(timeline, event.clientY - tplDrag.grab, { edges }), DAY_END - block.duration - block.tail);
  if (start === block.start && tplSelected === block.id) return;
  block.start = start;
  selectTemplateBlock(block.id);
}

function templatePointerUp(event) {
  if (tplDrag?.pointer !== event.pointerId) return;
  const drag = tplDrag;
  tplDrag = null;
  drag.preview?.remove();
  if (event.type !== 'pointerup') return;
  tplSkipClick = true;
  setTimeout(() => { tplSkipClick = false; }, 0);
  if (!drag.sketch || drag.resize) selectTemplateBlock(drag.id);
  else if (!drag.moved) addTemplateBlock(drag.anchor);
  else {
    const [start, end] = draftRange(drag);
    addTemplateBlock(start, end - start);
  }
}

function templateDayClick(event) {
  if (tplSkipClick) return;
  const tile = event.target.closest('.tile[data-id]');
  // Keyboard activation selects a block; on a phone a tap on empty space adds one.
  if (tile) selectTemplateBlock(tile.dataset.id);
  else if (tplPointer === 'touch') addTemplateBlock(timelineMinute($('template-day'), event.clientY, { round: Math.floor, edges: templateEdges() }));
}

function openTemplateDef(name) {
  editingTemplate = name;
  const template = name == null ? { wake: '07:00', anchors: [] } : getTemplate(name);
  const fields = $('template-def-form').elements;
  $('template-def-title').textContent = name == null ? 'New template' : 'Edit template';
  fields.name.value = name ?? '';
  fields.hint.value = template.hint ?? '';
  fields.wake.value = template.wake || '07:00';
  fields.event.checked = Boolean(template.event);
  tplBlocks = (template.anchors || []).filter(([pinned]) => planMinutes(pinned) != null)
    .map(([pinned, duration, text, kind = 'routine', tail = 0]) => ({ id: newId(), start: planMinutes(pinned), duration, text, kind, tail }));
  $('template-def-delete').hidden = name == null;
  $('template-def-error').hidden = true;
  $('template-def').showModal();
  selectTemplateBlock(null);
  // Open scrolled to the first block or the wake time.
  const timeline = $('template-day');
  const [from, until] = templateRange();
  const first = Math.min(planMinutes(fields.wake.value) ?? PLAN_START, ...tplBlocks.map((block) => block.start));
  timeline.parentElement.scrollTop = (first - from) * (timeline.clientHeight - 8) / (until - from) - 16;
}

function templateDefError(message) {
  $('template-def-error').textContent = message;
  $('template-def-error').hidden = false;
}

// Template notes are saved straight away, not with the week. Newest version wins.
function writeTemplates(...changes) {
  reload();
  data.entries.push(...changes.map(([name, value]) =>
    plannerEntry(PLAN_TEMPLATE, JSON.stringify({ key: name, value }), plannerNote(PLAN_TEMPLATE, name)?.entry)));
  try {
    persist();
  } catch {
    reload();
    return false;
  }
  sync();
  return true;
}

function saveTemplateDef(event) {
  event.preventDefault();
  const fields = event.target.elements;
  const name = fields.name.value.trim();
  if (!name) return templateDefError('Give the template a name.');
  if (name !== editingTemplate && getTemplate(name)) return templateDefError('A template with that name already exists.');
  const blocks = [...tplBlocks].sort((a, b) => a.start - b.start);
  const fail = (block, message) => {
    selectTemplateBlock(block.id);
    templateDefError(message);
  };
  for (const [i, block] of blocks.entries()) {
    if (!block.text.trim()) return fail(block, 'Give every block a title.');
    if (block.start + block.duration + block.tail > DAY_END) return fail(block, `${block.text} runs past midnight.`);
    const before = blocks[i - 1];
    if (before && block.start < before.start + before.duration + before.tail) return fail(block, `${block.text} overlaps ${before.text}.`);
  }
  const anchors = blocks.map((block) => [blockKey(block.start), block.duration, block.text.trim(), block.kind,
    ...(block.tail ? [block.tail] : [])]);
  const { deleted, ...base } = (editingTemplate == null ? null : getTemplate(editingTemplate)) ?? {};
  const value = { ...base, name, hint: fields.hint.value.trim() || undefined, wake: fields.wake.value,
    event: fields.event.checked || undefined, anchors };
  if (!fields.event.checked) delete value.workBeforeEvent;
  const changes = [[name, value]];
  if (editingTemplate != null && editingTemplate !== name) changes.push([editingTemplate, { name: editingTemplate, deleted: true }]);
  if (!writeTemplates(...changes)) return templateDefError('Could not save. Device storage is full or unavailable.');
  $('template-def').close();
  renderTemplateChoices(name);
  updateTemplateFields();
}

function deleteTemplateDef() {
  if (!confirm(`Delete "${editingTemplate}"? Days already using it keep their blocks.`)) return;
  if (!writeTemplates([editingTemplate, { name: editingTemplate, deleted: true }])) {
    return templateDefError('Could not save. Device storage is full or unavailable.');
  }
  $('template-def').close();
  renderTemplateChoices('');
  updateTemplateFields();
}

function updateTemplateFields() {
  const fields = $('template-form').elements;
  const template = getTemplate(fields.template.value);
  $('template-edit').disabled = !template;
  const needsEvent = Boolean(template?.event);
  $('event-fields').hidden = !needsEvent;
  for (const field of [fields.event, fields.start, fields.duration]) {
    field.disabled = !needsEvent;
    field.required = needsEvent;
  }
}

function replaceTemplate(day, name, template, event) {
  const positions = new Map(layoutDay(day).blocks.map((block) => [block.id, block.start]));
  const kept = day.blocks.filter((block) => !block.templateAnchor);
  let anchors = (template?.anchors || []).map(templateAnchor);
  const eventAt = event ? planMinutes(event.start) : null;
  if (event) {
    const travel = template.workBeforeEvent ? 'Travel to game' : 'Go + settle';
    const eventAnchors = [
      templateAnchor([blockKey(eventAt - 30), 30, travel, 'travel']),
      templateAnchor([event.start, event.duration, event.text, 'event']),
    ];
    anchors = [...anchors.filter((anchor) => !pinCollision(anchor, eventAnchors)), ...eventAnchors];
  }
  for (const anchor of anchors) {
    if (pinCollision(anchor, [...kept, ...anchors.filter((block) => block !== anchor)])) {
      return { error: `${anchor.text} overlaps a pinned block. Move the pin or choose another event time.` };
    }
    positions.set(anchor.id, planMinutes(anchor.pinned));
  }
  const blocks = [...kept, ...anchors].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
  return { day: editDay({
    ...day, template: name, wake: template?.wake || '07:00', startOffset: template?.startOffset,
    deepCap: template?.deepCap, workStart: template?.workStart, workCap: template?.workCap,
    workEnd: template?.workBeforeEvent ? eventAt - 30 : undefined,
    noNewAfter: template?.noNewAfter, noGhosts: template?.noGhosts,
  }, blocks) };
}

function applyTemplateEditor(event) {
  event.preventDefault();
  const fields = event.target.elements;
  const name = fields.template.value;
  const template = getTemplate(name);
  const details = template?.event ? { text: fields.event.value.trim(), start: fields.start.value, duration: Number(fields.duration.value) } : null;
  const at = details && planMinutes(details.start);
  let result;
  if (details && (!details.text || at == null || at < 30 || at + details.duration > DAY_END)) {
    result = { error: 'Enter an event name and a time that leaves room for travel and ends by midnight.' };
  } else {
    result = replaceTemplate(plan.days[templateDate], name, template, details);
  }
  if (result.error) {
    $('template-error').textContent = result.error;
    $('template-error').hidden = false;
    return;
  }
  storeDay(templateDate, result.day);
  $('template-editor').close();
  markEdited();
}

function blockColour(block) {
  const kind = blockKind(block);
  const text = block.text || '';
  const routineCue = /^(?:wake|breakfast|walk outside|nap|screens off|wind down|bedtime|shower)\b/i;
  if (kind === 'study' || (!block.kind && STUDY_SUBJECT.test(text))) return '#e7ddfa';
  if (kind === 'routine' || kind === 'meal' || (!block.kind && routineCue.test(text))) return '#fbe5d5';
  if (kind === 'free' || kind === 'buffer') return '#e9f6e6';
  return goalColour(block.goal) || '#f6f8fa';
}

function carryProjectNext(days, today, minute) {
  const updates = {};
  const nextByGoal = new Map();
  const update = (key, id, changes) => {
    const day = updates[key] ?? days[key];
    updates[key] = { ...day, blocks: day.blocks.map((block) => block.id === id ? { ...block, ...changes } : block) };
  };
  for (const key of Object.keys(days).sort().reverse()) {
    for (const block of layoutDay(days[key]).blocks.slice().reverse()) {
      if (!block.goal) continue;
      const target = nextByGoal.get(block.goal);
      const next = block.next?.trim();
      if (target && blockKind(block) === 'project' && next && block.nextApplied !== next) {
        if (!target.claimed) update(target.key, target.id, { text: next, kind: target.kind });
        target.claimed = true;
        update(key, block.id, { nextApplied: next });
      }
      if (key > today || (key === today && block.start >= minute)) {
        nextByGoal.set(block.goal, { key, id: block.id, kind: blockKind(block) || undefined });
      }
    }
  }
  return updates;
}

function carryNextAcrossWeeks(days, notes) {
  const weeks = plannerNotes(PLAN_WEEK);
  weeks.delete(plan.key);
  const dates = [...weeks.values()].flatMap(({ value }) => Object.keys(value.days ?? {}));
  const schedules = schedulesForWeek(dates);
  const allDays = { ...days };
  const external = new Map();
  for (const [key, saved] of weeks) {
    const ownDays = {};
    for (const [date, day] of Object.entries(saved.value.days ?? {})) {
      const schedule = schedules.get(date);
      if (Array.isArray(day?.blocks) && (schedule?.id ?? null) === (saved.value.sources?.[date] ?? null)) {
        ownDays[date] = day;
      }
    }
    if (!Object.keys(ownDays).length) continue;
    Object.assign(allDays, ownDays);
    external.set(key, saved);
  }
  const now = new Date();
  const updates = carryProjectNext(allDays, dayKey(now), now.getHours() * 60 + now.getMinutes());
  const changed = new Set();
  for (const key of Object.keys(days)) {
    if (!updates[key]) continue;
    days[key] = updates[key];
    changed.add(key);
    delete updates[key];
  }
  for (const [key, { entry, value }] of external) {
    const revised = { ...value, days: { ...value.days }, sources: { ...value.sources } };
    let dirty = false;
    for (const date of Object.keys(value.days)) {
      if (!updates[date]) continue;
      const day = revised.days[date] = updates[date];
      const text = scheduleText(date, day);
      if (changesSchedule(text)) {
        const note = plannerEntry(SCHEDULE, text, schedules.get(date));
        notes.push(note);
        revised.sources[date] = note.id;
      }
      dirty = true;
    }
    if (dirty) notes.push(plannerEntry(PLAN_WEEK, JSON.stringify({ key, value: revised }), entry));
  }
  return changed;
}

function reviewMarks(key) {
  const marks = marksOn(key);
  for (const mark of plan.pendingMarks) {
    if (mark.day !== key) continue;
    if (!marks.has(mark.blockStart) || marks.get(mark.blockStart).markedAt <= mark.markedAt) marks.set(mark.blockStart, mark);
  }
  return marks;
}

function refreshReviewStatus(layouts) {
  const now = new Date();
  const today = dayKey(now);
  const minute = now.getHours() * 60 + now.getMinutes();
  $('day-review').hidden = minute < REVIEW_START;
  let unmarked = 0;
  for (const [i, key] of plan.keys.entries()) {
    if (key > today) continue;
    const marks = reviewMarks(key);
    const blocks = layouts?.[i].blocks ?? layoutDay(plan.days[key]).blocks;
    unmarked += blocks.filter((block) => (key < today || block.until <= minute) && !marks.has(blockKey(block.start))).length;
  }
  $('week-unmarked').textContent = `${unmarked} ${unmarked === 1 ? 'block' : 'blocks'} unmarked`;
}

function refreshReviewRows() {
  if (!$('review-editor').open) return;
  const key = $('review-form').dataset.day;
  const blocks = new Map(layoutDay(plan.days[key]).blocks.map((block) => [block.id, block]));
  const marks = reviewMarks(key);
  const schedule = plan.schedules.get(key);
  const saved = new Map((schedule ? parseSchedule(schedule.text).blocks : []).map((block) => [block.start, block]));
  for (const row of $('review-list').children) {
    const block = blocks.get(row.dataset.id);
    if (!block) continue;
    const lines = [block.done ? `${block.text} (done = ${block.done})` : block.text];
    const scheduled = saved.get(block.start);
    const matching = scheduled?.lines[0] === scheduleProse(lines[0]);
    const view = { ...block, end: block.until, lines };
    row.firstElementChild.replaceWith(blockRow(view, '', marks.get(blockKey(block.start)), matching ? key : null));
  }
}

function openDayReview() {
  const key = dayKey(new Date());
  if (!plan.days[key]) changePlannerWeek(weekMonday(keyDate(key)));
  if (!plan.days[key]) return;
  $('review-form').dataset.day = key;
  $('review-title').textContent = `Review · ${dayLabel(key)}`;
  const blocks = layoutDay(plan.days[key]).blocks;
  const rows = blocks.map((block) => {
    const row = element('div', 'review-row');
    row.dataset.id = block.id;
    row.append(element('div'));
    if (blockKind(block) === 'project' && block.goal) {
      const label = element('label', '', 'NEXT');
      const input = element('input');
      input.value = block.next ?? '';
      input.placeholder = 'First step for the next block';
      label.append(input);
      row.append(label);
    }
    return row;
  });
  $('review-list').replaceChildren(...rows);
  $('review-empty').hidden = Boolean(rows.length);
  $('review-editor').showModal();
  refreshReviewRows();
}

function applyDayReview(event) {
  event.preventDefault();
  const key = event.target.dataset.day;
  const fields = new Map([...$('review-list').children].flatMap((row) => {
    const input = row.querySelector('input');
    return input ? [[row.dataset.id, input.value.trim()]] : [];
  }));
  const day = plan.days[key];
  if (day.blocks.some((block) => fields.has(block.id) && fields.get(block.id) !== (block.next ?? ''))) {
    plan.days[key] = { ...day, blocks: day.blocks.map((block) => fields.has(block.id)
      ? { ...block, next: fields.get(block.id),
        nextApplied: fields.get(block.id) === block.next ? block.nextApplied : undefined } : block) };
    plan.dirtyDays.add(key);
    plan.scheduleDirty.add(key);
    markEdited();
  }
  $('review-editor').close();
}

function urgentTodos() {
  const copies = new Set(Object.values(plan.days).flatMap((day) => day.blocks.map((block) => block.todoId)));
  return entriesFor('Todo').filter((entry) => !copies.has(entry.id) && /^now:\s*\S/i.test(bare(entry.text)));
}

function fillPopupFields() {
  const fields = $('now-form').elements;
  const text = bare(urgentTodos().find((entry) => entry.id === fields.todo.value)?.text ?? '').replace(/^now:\s*/i, '');
  const duration = /\s+\(?([1-9]\d*)\s*m(?:in(?:utes?)?)?\)?$/i.exec(text);
  fields.title.value = duration ? text.slice(0, duration.index).trim() : text;
  fields.duration.value = duration ? Math.min(180, Number(duration[1])) : 15;
}

function openPopup(todoId = '') {
  const today = new Date();
  const key = dayKey(today);
  if (!plan.days[key]) changePlannerWeek(weekMonday(today));
  if (!plan.days[key]) return;
  const todos = urgentTodos();
  fillOptions($('now-form').elements.todo, [['', 'New interruption'], ...todos.map((entry) =>
    [entry.id, bare(entry.text).replace(/^now:\s*/i, '')])], todoId || todos[0]?.id || '');
  $('now-source').hidden = !todos.length;
  $('now-error').hidden = true;
  fillPopupFields();
  $('now-editor').showModal();
}

function applyPopup(event) {
  event.preventDefault();
  const fields = event.target.elements;
  const now = new Date();
  const key = dayKey(now);
  const text = fields.title.value.trim();
  const duration = fields.duration.valueAsNumber;
  if (!text || !plan.days[key] || !Number.isInteger(duration) || duration < 1 || duration > 180) return;
  const popup = planBlock(newId(), text, { duration, tier: 'must', todoId: fields.todo.value || null });
  const result = insertPopup(plan.days[key], popup, now.getHours() * 60 + now.getMinutes());
  if (!result) {
    $('now-error').textContent = 'No room left today for that length.';
    $('now-error').hidden = false;
    return;
  }
  if (popup.todoId && plan.tray.some((block) => block.todoId === popup.todoId)) {
    plan.tray = plan.tray.filter((block) => block.todoId !== popup.todoId);
    plan.trayDirty = true;
  }
  storeDay(key, result.day, duration > 15);
  $('now-editor').close();
  markEdited();
  if (result.bumped.length && duration > 15) {
    $('plan-status').textContent = `Bumped from today · ${result.bumped.map((block) => block.text).join(', ')} · Unsaved`;
  }
}

function acceptGhost({ key, block, shelf }) {
  const day = plan.days[key];
  const { blocks, bumped } = layoutDay(day);
  const { start, until, ...fields } = block;
  const placed = { ...fields, bumped: false, bumpedFrom: undefined };
  const all = [...day.blocks.filter((item) => !shelf || item.id !== block.id), placed];
  if (plan.tray.some((item) => item.id === block.id)) {
    plan.tray = plan.tray.filter((item) => item.id !== block.id);
    plan.trayDirty = true;
  }
  storeDay(key, keepDayTimes(day, all, [...blocks, { ...placed, start, until }].sort((a, b) => a.start - b.start), bumped));
  markEdited(`Added ${block.text.length > 40 ? block.text.slice(0, 40) + '…' : block.text}.`);
}

function dayWarnings(key, day, blocks) {
  const warnings = new Set();
  const work = blocks.filter(workBlock);
  const cap = day.deepCap ?? 4;
  if (work.filter((b) => ['high', 'must'].includes(b.tier)).length > cap) warnings.add(`More than ${cap} deep blocks`);
  if (work.length && blocks.filter((b) => blockKind(b) === 'buffer').reduce((sum, b) => sum + b.until - b.start, 0) < 45) {
    warnings.add('Less than 45m of buffer');
  }
  for (const [i, block] of blocks.entries()) {
    const next = blocks[i + 1];
    if (next && next.start - block.until < 5 && !(next.templateAnchor && block.templateAnchor && next.start === block.until)) {
      warnings.add(next.start < block.until ? 'Overlapping pins' : 'Gap under 5m');
    }
    if (block.actualUntil > block.until) warnings.add('Ran into a fixed time');
  }
  return [...warnings];
}

function hoursText(minutes) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(minutes / 60) + 'h';
}

function meter(value, label) {
  const bar = element('span', 'meter');
  bar.setAttribute('role', 'meter');
  bar.setAttribute('aria-label', label);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const percent = Math.min(100, Math.round(value * 100));
  bar.setAttribute('aria-valuenow', String(percent));
  const fill = element('span', 'meter-fill');
  fill.style.width = `${percent}%`;
  bar.append(fill);
  return bar;
}

function openGoalEditor(entry) {
  editingGoal = entry.id;
  $('goal-title').textContent = bare(entry.text);
  const fields = $('goal-form').elements;
  fields.hours.value = goalHours(entry) ?? '';
  fillOptions(fields.colour, PLAN_COLOURS.map((colour, i) => [colour, COLOUR_NAMES[i]]), goalColour(entry.id));
  $('goal-editor').showModal();
}

function applyGoalEditor(event) {
  event.preventDefault();
  const fields = event.target.elements;
  plan.budgets = { ...plan.budgets, [editingGoal]: { hours: fields.hours.value === '' ? null : Number(fields.hours.value), colour: fields.colour.value } };
  plan.goalsDirty = true;
  $('goal-editor').close();
  markEdited();
}

function openRestack(key, id = null) {
  const day = plan.days[key];
  const block = id == null ? null : layoutDay(day).blocks.find((block) => block.id === id);
  if (id != null && !block) return;
  restacking = { key, id };
  const fields = $('restack-form').elements;
  $('restack-title').textContent = block ? 'Ran over until…' : 'Woke at…';
  $('restack-text').textContent = block ? block.text : dayLabel(key);
  $('restack-reason').hidden = !block;
  $('restack-error').hidden = true;
  const now = new Date();
  const minute = key === dayKey(now) ? now.getHours() * 60 + now.getMinutes() : 0;
  fields.time.value = block ? blockKey(Math.min(1439, Math.max(block.actualUntil ?? block.until, minute))) : day.wake;
  fields.reason.value = '';
  $('restack-editor').showModal();
}

function applyRestack(event) {
  event.preventDefault();
  const fields = event.target.elements;
  const { key, id } = restacking;
  const day = plan.days[key];
  const time = fields.time.value;
  if (id == null) {
    storeDay(key, restackBeforeScreensOff(applyWake(day, time)));
  } else {
    const result = applyOverrun(day, id, planMinutes(time));
    if (!result) {
      $('restack-error').textContent = 'Choose an end time after the block started.';
      $('restack-error').hidden = false;
      return;
    }
    storeDay(key, restackBeforeScreensOff(result.day));
    const mark = makeBlockMark(key, { start: result.timed.start, lines: [result.timed.text] }, {
      status: 'over', endedAt: time, reason: fields.reason.value.trim() || null,
    });
    plan.pendingMarks = plan.pendingMarks.filter((item) => item.day !== key || item.blockStart !== mark.blockStart);
    plan.pendingMarks.push(mark);
  }
  $('restack-editor').close();
  markEdited();
}

function renderGoals(layouts, loads) {
  const blocks = layouts.flatMap((layout) => layout.blocks);
  const items = plannerGoals().map((entry) => {
    const minutes = goalMinutes(blocks, entry.id);
    const budget = goalHours(entry);
    const chip = plannerButton('', () => openGoalEditor(entry), 'goal-chip');
    const colour = goalColour(entry.id);
    chip.style.background = colour;
    chip.append(element('strong', '', bare(entry.text)));
    if (budget != null || minutes) chip.append(element('span', 'goal-hours', budget == null
      ? hoursText(minutes) : `${hoursText(minutes)} / ${budget}h`));
    if (budget != null) chip.append(meter(budget ? minutes / (budget * 60) : Number(minutes > 0), 'Goal progress'));
    chip.classList.toggle('over-budget', budget != null && minutes > budget * 60);
    return chip;
  });
  if (!items.length) items.push(element('span', 'muted', 'No Working on notes'));
  const placed = loads.reduce((sum, load) => sum + load.placed, 0);
  const usable = loads.reduce((sum, load) => sum + load.usable, 0);
  const toggle = plannerButton(`Goals · ${hoursText(placed)} / ${hoursText(usable)} ${goalsOpen ? '▴' : '▾'}`, () => {
    goalsOpen = !goalsOpen;
    renderPlanner();
  }, 'goals-toggle');
  toggle.setAttribute('aria-expanded', String(goalsOpen));
  $('goals').classList.toggle('open', goalsOpen);
  $('goals').replaceChildren(toggle, element('h3', '', 'Working on'), ...items);
  $('week-load').textContent = `${hoursText(placed)} of ${hoursText(usable)} placed`;
}

function renderTray() {
  const tray = element('div', 'panel tray-box');
  tray.dataset.tray = '';
  const addItem = () => openBlockEditor({ fresh: true, block: planBlock(newId(), '') }, {});
  const add = plannerButton('+', addItem, 'day-add');
  add.setAttribute('aria-label', 'Add an item to To Do');
  tray.append(element('h3', '', 'To Do'), add);
  tray.addEventListener('click', (event) => {
    if (!event.target.closest('button, summary')) addItem();
  });
  const someday = element('details', 'panel tray-box someday');
  someday.open = $('tray').querySelector('.someday')?.open ?? false;
  someday.append(element('summary', '', 'Back burner'));
  // Anything already on a day leaves the tray, so it can't be dragged in twice.
  const placed = new Set(Object.values(plan.days).flatMap((day) => day.blocks.map((block) => block.todoId)));
  const parked = new Set(plan.tray.map((block) => block.todoId));
  const now = Date.now();
  const todos = entriesFor('Todo');
  const old = new Set(todos.filter((entry) => now - Date.parse(entry.createdAt) >= 5 * 86400000).map((entry) => entry.id));
  const splitPrompt = (tile) => tile.append(element('span', 'split-prompt', '✂ Split into a first step'));
  for (const [category, section] of [['Todo', tray], [BACK_BURNER, someday]]) {
    const entries = entriesFor(category).filter((entry) => !parked.has(entry.id) && !placed.has(entry.id));
    if (!entries.length && (category !== 'Todo' || !plan.tray.length)) {
      section.append(element('p', 'muted', `No ${category} notes`));
    }
    for (const entry of entries) {
      const text = bare(entry.text);
      const tile = element('button', 'tile tray-tile');
      tile.append(element('span', 'tile-title', text));
      tile.title = text;
      tile.type = 'button';
      tile.style.setProperty('--tile-colour', blockColour({ text }));
      Object.assign(tile.dataset, { id: entry.id, source: category });
      if (category === 'Todo' && old.has(entry.id)) splitPrompt(tile);
      section.append(tile);
    }
  }
  for (const block of plan.tray) {
    const tile = renderTile(block);
    tile.classList.add('tray-tile');
    tile.dataset.source = 'parked';
    if (old.has(block.todoId)) splitPrompt(tile);
    tray.append(tile);
  }
  $('tray').replaceChildren(tray, someday);
}

function lengthLabel(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

function renderTile(block, date) {
  const tile = element('button', 'tile');
  tile.type = 'button';
  tile.dataset.id = block.id;
  if (date) tile.dataset.date = date;
  tile.classList.toggle('fixed', block.tier === 'fixed');
  tile.style.setProperty('--tile-colour', blockColour(block));
  tile.append(element('span', 'tile-title', block.text));
  if (block.bumped) tile.append(element('span', 'bumped', block.bumpedFrom
    ? ` · Bumped from ${block.bumpedFrom === dayKey(new Date()) ? 'today' : dayLabel(block.bumpedFrom, false)}` : ' · Bumped'));
  if (!date || block.shelf) tile.append(element('span', 'tile-size', lengthLabel(block.duration ?? block.size)));
  if (planMinutes(block.pinned) != null) {
    const pin = element('span', 'pin', '📌');
    pin.title = `Pinned at ${clock12(block.pinned)}`;
    tile.append(pin);
  }
  tile.title = [block.text, block.done && `Done = ${block.done}`, block.next,
    block.actualUntil != null && `Ran over until ${clock12(block.actualUntil)}`].filter(Boolean).join('\n');
  return tile;
}

// Places a tile on a timeline and puts its start–end time above the title.
function timeTile(tile, start, until, from) {
  tile.classList.add('timed');
  tile.style.setProperty('--minute', start - from);
  tile.style.setProperty('--duration', until - start);
  const range = `${clock12(start)}–${clock12(until)}`;
  const time = element('time', 'tile-time', clock12(start));
  time.append(element('span', 'tile-end', `–${clock12(until)}`));
  const label = element('span', 'timed-label');
  label.append(time, tile.firstElementChild);
  tile.prepend(label);
  tile.title = `${range}\n${tile.title}`;
  return time;
}

function closeDayMenus() {
  for (const menu of document.querySelectorAll('.day-menu:not([hidden])')) {
    menu.hidden = true;
    menu.previousElementSibling.querySelector('.day-menu-toggle').setAttribute('aria-expanded', 'false');
  }
}

function toggleDayMenu(menu) {
  const open = menu.hidden;
  closeDayMenus();
  menu.hidden = !open;
  menu.previousElementSibling.querySelector('.day-menu-toggle').setAttribute('aria-expanded', String(open));
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('.day-head h3, .day-menu')) closeDayMenus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDayMenus();
});

function renderDay(key,{ blocks, bumped }, load, from, until, ghosts) {
  const date = keyDate(key);
  const day = plan.days[key];
  const column = element('article', 'panel day');
  column.dataset.day = key;
  const head = element('header', 'day-head');
  // The header itself opens the day's setup menu, so its buttons don't repeat down the week.
  const heading = element('h3');
  const toggle = plannerButton('', () => toggleDayMenu(menu), 'day-menu-toggle');
  toggle.setAttribute('aria-haspopup', 'menu');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.title = 'Day options';
  const name = element('span', 'day-name', date.toLocaleDateString(undefined, { weekday: 'short' }));
  name.append(element('span', 'day-date', date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
  const info = [day.wake?.replace(/^0(?=\d:)/, ''), day.template].filter(Boolean);
  toggle.append(name, element('span', 'day-info', `${info.join(' ')} ▾`));
  heading.append(toggle);
  const menu = element('div', 'day-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const menuItem = (text, action) => {
    const item = plannerButton(text, () => { closeDayMenus(); action(); });
    item.setAttribute('role', 'menuitem');
    return item;
  };
  menu.append(menuItem('Template…', () => openTemplateEditor(key)), menuItem('Woke at…', () => openRestack(key)));
  const title = element('div', 'day-title');
  title.append(heading, menu);
  head.append(title);
  if (changedInDash(key)) head.append(element('span', 'warning', 'Changed on phone'));
  const events = blocks.filter((block) => block.pinned && (block.kind === 'event' || block.tier === 'fixed' && !block.templateAnchor));
  for (const event of events) head.append(element('p', 'day-info day-event', `★ ${event.pinned} ${event.text}`));
  const dayActions = element('div', 'day-actions');
  if (recoverySuggested(key) && !day.template) dayActions.append(plannerButton('Recovery?', () => openTemplateEditor(key), 'day-action'));
  if (dayActions.children.length) head.append(dayActions);
  const shelf = element('div', 'shelf');
  shelf.dataset.shelf = '';
  shelf.append(element('h4', 'shelf-title', 'To do'));
  for (const block of day.blocks.filter((block) => block.shelf)) shelf.append(renderTile(block, key));
  for (const block of bumped) {
    const tile = renderTile(block, key);
    if (!block.bumped) tile.append(element('span', 'bumped', ' · Bumped'));
    shelf.append(tile);
  }
  const timeline = element('div', 'timeline');
  timeline.dataset.from = from;
  timeline.dataset.until = until;
  const addUntimed = () => openBlockEditor({ fresh: true, block: planBlock(newId(), '') }, { date: key, shelf: true });
  const add = plannerButton('+', addUntimed, 'day-add');
  add.setAttribute('aria-label', `Add an untimed item for ${dayLabel(key)}`);
  shelf.append(add);
  shelf.addEventListener('click', (event) => {
    if (!event.target.closest('button')) addUntimed();
  });
  timeline.style.setProperty('--minutes', until - from);
  for (let hour = from; hour < until; hour += 60) {
    const line = element('span', 'hour');
    line.append(element('span', 'hour-label', clock12(hour).replace(':00', '')));
    line.style.setProperty('--minute', hour - from);
    timeline.append(line);
    if (hour + 30 < until) timeline.append(halfHourLine(hour + 30 - from));
  }
  if (key === dayKey(new Date())) {
    column.classList.add('today');
    timeline.append(element('span', 'now-line'));
  }
  for (const [i, block] of blocks.entries()) {
    const tile = renderTile(block, key);
    Object.assign(tile.dataset, { start: block.start, until: block.until });
    tile.classList.toggle('late', afterDeadline(key, block));
    const time = timeTile(tile, block.start, block.until, from);
    if (block.actualUntil != null) time.append(element('span', 'over-badge', '↗'));
    if (block.tail > 0) {
      tile.style.setProperty('--tail', block.tail);
      tile.append(element('span', 'tail', `+${block.tail}m`));
    }
    timeline.append(tile);
    const gap = Math.min(gapAfter(block), (blocks[i + 1]?.start ?? until) - block.until);
    if (gap > 0 && blocks[i + 1]) {
      const strip = element('span', 'gap');
      strip.style.setProperty('--minute', block.until - from);
      strip.style.setProperty('--duration', gap);
      strip.title = `${gap} min gap`;
      timeline.append(strip);
    }
  }
  for (const ghost of ghosts) {
    const { block } = ghost;
    const tile = plannerButton('', () => acceptGhost(ghost), 'tile ghost');
    tile.append(element('span', 'tile-title', block.text));
    tile.title = `Tap to schedule\n${block.text}`;
    tile.style.setProperty('--tile-colour', blockColour(block));
    timeTile(tile, block.start, block.until, from);
    timeline.append(tile);
  }
  const footer = element('footer', 'day-footer');
  footer.classList.toggle('amber', load.ratio >= .75);
  footer.classList.toggle('coral', load.ratio >= .9);
  footer.append(element('p', 'day-info', `Load ${Math.round(load.ratio * 100)}% · ${hoursText(load.placed)}`), meter(load.ratio, `${dayLabel(key)} load`));
  for (const warning of dayWarnings(key, day, blocks)) footer.append(element('span', 'warning', warning));
  column.append(head, shelf, timeline, footer);
  return column;
}

function renderPlanner() {
  const end = addDays(monday, 6);
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  $('week-range').textContent = formatter.formatRange(monday, end);
  $('week-today').hidden = dayKey(monday) === dayKey(homeMonday());
  const layouts = plan.keys.map((key) => layoutDay(plan.days[key]));
  const loads = layouts.map((layout, i) => dayLoad(plan.days[plan.keys[i]], layout.blocks));
  renderGoals(layouts, loads);
  refreshReviewStatus(layouts);
  refreshReviewRows();
  const all = layouts.flatMap((layout) => layout.blocks);
  const from = Math.floor(Math.min(PLAN_START, ...all.map((b) => b.start)) / 60) * 60;
  const until = Math.ceil(Math.max(DEFAULT_TIMELINE_END, ...all.map((b) => b.until)) / 60) * 60;
  const goals = plannerGoals();
  const parked = new Set(plan.tray.map((block) => block.todoId));
  const todos = entriesFor('Todo').filter((entry) => !parked.has(entry.id)).map((entry) => trayTodo(entry, goals));
  const now = new Date();
  const today = dayKey(now);
  const earliest = Object.fromEntries(plan.keys.map((key) => [key,
    key < today ? Infinity : key === today ? now.getHours() * 60 + now.getMinutes() : 0]));
  const budgets = Object.fromEntries(goals.map((entry) => [entry.id, goalHours(entry)]));
  const ghosts = suggestGhosts(plan.days, [...plan.tray, ...todos], budgets, earliest,
    Object.fromEntries(plan.keys.map((key, i) => [key, layouts[i]])));
  if (!plan.keys.includes(selectedDay)) selectedDay = plan.keys.includes(today) ? today : plan.keys[0];
  $('day-tabs').replaceChildren(...plan.keys.map((key) => {
    const date = keyDate(key);
    const tab = plannerButton('', () => selectDay(key), 'day-tab');
    tab.dataset.tabDay = key;
    tab.append(element('span', '', date.toLocaleDateString(undefined, { weekday: 'short' })),
      element('span', 'day-tab-date', String(date.getDate())));
    tab.setAttribute('aria-pressed', String(key === selectedDay));
    tab.classList.toggle('today', key === today);
    return tab;
  }));
  const scroll = $('week').querySelector('.day.selected')?.scrollTop ?? 0;
  const trayScroll = $('tray').querySelector('.tray-box')?.scrollTop ?? 0;
  const gutter = element('div', 'time-gutter');
  gutter.setAttribute('aria-hidden', 'true');
  gutter.style.setProperty('--minutes', until - from);
  for (let hour = from; hour < until; hour += 60) {
    const label = element('span', 'gutter-label', clock12(hour).replace(':00', ''));
    label.style.setProperty('--minute', hour - from);
    gutter.append(label);
  }
  renderTray();
  $('week').replaceChildren(gutter, ...plan.keys.map((key, i) => {
    const column = renderDay(key, layouts[i], loads[i], from, until, ghosts.filter((ghost) => ghost.key === key));
    column.classList.toggle('selected', key === selectedDay);
    return column;
  }));
  $('week').querySelector('.day.selected').scrollTop = scroll;
  $('tray').querySelector('.tray-box').scrollTop = trayScroll;
  planSnap = snapshotPlan();
  showNow();
}

// Google Calendar style: a line at the current time, and the running block brighter.
function showNow() {
  const now = new Date();
  const today = dayKey(now);
  const minute = now.getHours() * 60 + now.getMinutes();
  for (const tile of $('week').querySelectorAll('.tile.timed[data-date]')) {
    const { date, start, until } = tile.dataset;
    tile.classList.toggle('current', date === today && Number(start) <= minute && minute < Number(until));
  }
  const line = $('week').querySelector('.day.today .now-line');
  if (!line) return;
  const timeline = line.parentElement;
  const at = minute - Number(timeline.dataset.from);
  line.hidden = at < 0 || minute > Number(timeline.dataset.until);
  line.style.setProperty('--minute', at);
}

function selectDay(key) {
  if (key === selectedDay) return;
  selectedDay = key;
  renderPlanner();
  $('week').querySelector('.day.selected').scrollTop = 0;
}

function refreshView() {
  if (plan && isPlannerDirty()) {
    plan.schedules = schedulesForWeek(plan.keys);
    if (!plan.goalsDirty) {
      const goals = plannerNote(PLAN_GOALS, plan.key);
      plan.budgets = goals?.value || {};
      plan.goalVersion = goals?.entry.id ?? null;
    }
  }
  else openPlannerWeek();
  if (!activeDrag) renderPlanner();
}

function plannerDropTarget(event, source) {
  const under = document.elementFromPoint(event.clientX, event.clientY);
  const tab = under?.closest('[data-tab-day]');
  if (tab) return { date: tab.dataset.tabDay, pin: false, indicator: tab };
  const inside = (el) => {
    const r = el.getBoundingClientRect();
    return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
  };
  const box = (source.copy || source.parked) && [...document.querySelectorAll('.tray-box')].find(inside);
  if (box) {
    const category = box.matches('.someday') ? BACK_BURNER : 'Todo';
    return category === source.category ? null : { moveTo: category, indicator: box };
  }
  const slot = under?.closest('[data-shelf], .timeline');
  if (!slot) {
    return source.date && under?.closest('#planner') ? { indicator: $('tray').querySelector('[data-tray]') } : null;
  }
  const date = slot.closest('[data-day]').dataset.day;
  const tile = under.closest('.tile[data-id]');
  if (tile && date === source.date && tile.dataset.id === source.block.id) return null;
  if (slot.matches('[data-shelf]')) return { date, shelf: true, before: tile?.dataset.id, indicator: slot };
  const stack = layoutDay(plan.days[date]).blocks;
  if (tile) {
    const index = stack.findIndex((block) => block.id === tile.dataset.id);
    const rect = tile.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const next = stack.slice(index + Number(after)).find((block) => block.id !== source.block.id);
    return { date, before: next?.id, pin: false, indicator: tile, after };
  }
  const dragged = activeDrag?.tile;
  const length = dragged?.dataset.until ? Number(dragged.dataset.until) - Number(dragged.dataset.start) : 0;
  const edges = movingEdges(timelineEdges(slot, source.block.id), length);
  const time = Math.min(PLAN_END - 5, timelineMinute(slot, event.clientY, { edges }));
  const before = stack.find((block) => block.start >= time && block.id !== source.block.id);
  return { date, at: blockKey(time), before: before?.id, indicator: slot };
}

function showDropTarget(target) {
  const last = activeDrag.target?.indicator;
  last?.classList.remove('drop-target', 'drop-after');
  const indicator = target?.indicator;
  indicator?.classList.add('drop-target');
  if (target?.after) indicator.classList.add('drop-after');
  if (target?.at != null) indicator.style.setProperty('--drop-minute', planMinutes(target.at) - Number(indicator.dataset.from));
  activeDrag.target = target;
}

// Times are free to the minute, but land on a nearby edge (another block's start or
// end) when the pointer is within a finger's width of it, so blocks still stack flush.
const EDGE_SNAP_PX = 10;

function timelineMinute(timeline, clientY, { round = Math.round, edges = [] } = {}) {
  const rect = timeline.getBoundingClientRect();
  const from = Number(timeline.dataset.from);
  const until = Number(timeline.dataset.until);
  const scale = (rect.height - 8) / (until - from);
  const raw = from + (clientY - rect.top) / scale;
  let minute = from + round(raw - from);
  let best = EDGE_SNAP_PX / scale;
  for (const edge of edges) {
    if (Math.abs(edge - raw) <= best) { minute = edge; best = Math.abs(edge - raw); }
  }
  return Math.max(from, Math.min(until, minute));
}

// Start and end minutes of the timed blocks on a planner timeline, apart from one.
function timelineEdges(timeline, skipId) {
  return [...timeline.querySelectorAll('.tile.timed[data-id]')]
    .filter((tile) => tile.dataset.id !== skipId)
    .flatMap((tile) => [Number(tile.dataset.start), Number(tile.dataset.until)]);
}

// For a moved block, its top may snap to an edge or its bottom may, so offer both.
function movingEdges(edges, length) {
  return length ? [...edges, ...edges.map((edge) => edge - length)] : edges;
}

// Press on an empty part of a day and drag to sketch a new item, like a calendar.
function draftRange({ anchor, current }) {
  return current > anchor ? [anchor, current] : [current, anchor + 15];
}

function openDraft(date, start, duration) {
  const fields = duration == null ? {} : PLAN_SIZES.includes(duration) ? { size: duration } : { duration };
  openBlockEditor({ fresh: true, block: planBlock(newId(), '', fields) }, { date, at: blockKey(start) });
}

function startDraft(event) {
  const timeline = event.target.closest('.timeline');
  if (!timeline || event.target.closest('.tile') || event.pointerType === 'touch') return;
  event.preventDefault();
  const edges = timelineEdges(timeline);
  const anchor = Math.min(timelineMinute(timeline, event.clientY, { round: Math.floor, edges }), PLAN_END - 15);
  const preview = element('div', 'tile timed draft');
  activeDrag = { draft: true, timeline, preview, edges, anchor, current: anchor, pointer: event.pointerId, y: event.clientY, moved: false };
}

function moveDraft(event) {
  if (!activeDrag.moved && Math.abs(event.clientY - activeDrag.y) < 6) return;
  if (!activeDrag.moved) activeDrag.timeline.append(activeDrag.preview);
  activeDrag.moved = true;
  activeDrag.current = Math.min(timelineMinute(activeDrag.timeline, event.clientY, { edges: activeDrag.edges }), PLAN_END);
  const [start, end] = draftRange(activeDrag);
  const from = Number(activeDrag.timeline.dataset.from);
  activeDrag.preview.style.setProperty('--minute', start - from);
  activeDrag.preview.style.setProperty('--duration', end - start);
  activeDrag.preview.textContent = `${clock12(start)}–${clock12(end)}`;
}

function endDraft(event) {
  const drag = activeDrag;
  activeDrag = null;
  drag.preview.remove();
  if (event.type !== 'pointerup') return;
  const date = drag.timeline.closest('[data-day]').dataset.day;
  if (!drag.moved) openDraft(date, drag.anchor);
  else {
    const [start, end] = draftRange(drag);
    openDraft(date, start, end - start);
  }
}

// The grab zone for resizing: just inside the bottom edge of a timed tile and a little below it.
function tileBottomEdgeAt(event) {
  if (event.pointerType === 'touch') {
    const inside = event.target.closest('.tile.timed[data-id]');
    if (!inside) return null;
    const bottom = inside.getBoundingClientRect().bottom;
    return event.clientY >= bottom - 14 ? inside : null;
  }
  const timeline = event.target.closest('.timeline');
  if (!timeline) return null;
  let best = null;
  let bestGap = Infinity;
  for (const tile of timeline.querySelectorAll('.tile.timed[data-id]')) {
    const box = tile.getBoundingClientRect();
    const gap = Math.abs(event.clientY - box.bottom);
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.bottom - 8 || event.clientY > box.bottom + 8) continue;
    if (gap < bestGap) { best = tile; bestGap = gap; }
  }
  return best;
}

function startDrag(event) {
  lastPointerType = event.pointerType;
  if (event.button !== 0 || activeDrag) return;
  const edgeTile = tileBottomEdgeAt(event);
  if (edgeTile) {
    const tile = edgeTile;
    const source = blockSource(tile);
    if (!source?.block) return;
    event.preventDefault();
    clearTimeout(tileClick);
    tile.setPointerCapture(event.pointerId);
    activeDrag = { resize: true, tile, source, timeline: tile.closest('.timeline'), pointer: event.pointerId,
      start: Number(tile.dataset.start), until: Number(tile.dataset.until), moved: false };
    activeDrag.end = activeDrag.until;
    return;
  }
  const tile = event.target.closest('.tile[data-id]');
  if (!tile) {
    startDraft(event);
    return;
  }
  const source = blockSource(tile);
  if (!source?.block) return;
  activeDrag = { tile, source, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
}

function moveDrag(event) {
  if (activeDrag?.pointer !== event.pointerId) return;
  if (activeDrag.draft) {
    moveDraft(event);
    return;
  }
  if (activeDrag.resize) {
    event.preventDefault();
    const drag = activeDrag;
    const tail = drag.source.block.tail ?? 0;
    drag.edges ??= timelineEdges(drag.timeline, drag.source.block.id);
    drag.end = Math.min(Math.max(timelineMinute(drag.timeline, event.clientY, { edges: drag.edges }), drag.start + tail + 15), DAY_END);
    drag.moved = true;
    drag.tile.style.setProperty('--duration', drag.end - drag.start);
    return;
  }
  if (!activeDrag.moved) {
    if (Math.hypot(event.clientX - activeDrag.x, event.clientY - activeDrag.y) < 6) return;
    clearTimeout(tileClick);
    activeDrag.moved = true;
    const bounds = activeDrag.tile.getBoundingClientRect();
    const preview = activeDrag.tile.cloneNode(true);
    preview.classList.add('drag-preview');
    preview.setAttribute('aria-hidden', 'true');
    preview.tabIndex = -1;
    preview.style.width = `${bounds.width}px`;
    preview.style.height = `${bounds.height}px`;
    document.body.append(preview);
    activeDrag.preview = preview;
    activeDrag.tile.classList.add('dragging');
    activeDrag.tile.setPointerCapture(event.pointerId);
    requestAnimationFrame(scrollDuringDrag);
  }
  event.preventDefault();
  activeDrag.position = { clientX: event.clientX, clientY: event.clientY };
  activeDrag.preview.style.left = `${event.clientX + 10}px`;
  activeDrag.preview.style.top = `${event.clientY + 10}px`;
  showDropTarget(plannerDropTarget(event, activeDrag.source));
}

function scrollDuringDrag() {
  if (!activeDrag?.moved) return;
  const point = activeDrag.position;
  const board = [...document.querySelectorAll('#week > .day.selected, #tray .tray-box, .board-scroll')].find((el) => {
    const box = el.getBoundingClientRect();
    return el.scrollHeight > el.clientHeight + 1 && point && point.clientX >= box.left && point.clientX <= box.right;
  }) ?? document.querySelector('.board-scroll');
  const bounds = board.getBoundingClientRect();
  if (point && point.clientX >= bounds.left && point.clientX <= bounds.right &&
      point.clientY >= bounds.top && point.clientY <= bounds.bottom) {
    const edge = (at, low, high) => at - low < 34 ? -12 : high - at < 34 ? 12 : 0;
    const x = edge(point.clientX, bounds.left, bounds.right);
    const y = edge(point.clientY, bounds.top, bounds.bottom);
    if (x || y) {
      board.scrollBy(x, y);
      showDropTarget(plannerDropTarget(point, activeDrag.source));
    }
  }
  requestAnimationFrame(scrollDuringDrag);
}

function endDrag(event) {
  if (activeDrag?.pointer !== event.pointerId) return;
  if (activeDrag.draft) {
    endDraft(event);
    return;
  }
  if (activeDrag.resize) {
    const { tile, source, moved, end, until } = activeDrag;
    activeDrag = null;
    tile.dataset.dragged = 'true';
    setTimeout(() => delete tile.dataset.dragged, 0);
    if (!moved || event.type !== 'pointerup' || end === until) {
      tile.style.setProperty('--duration', until - Number(tile.dataset.start));
      return;
    }
    const day = plan.days[source.date];
    const duration = end - Number(tile.dataset.start) - (source.block.tail ?? 0);
    const resized = { ...source.block, duration };
    const blocks = day.blocks.map((block) => block.id === resized.id ? resized : block);
    storeDay(source.date, placeInDay(day, blocks, resized, Number(tile.dataset.start)));
    markEdited();
    return;
  }
  const { tile, source, moved, preview } = activeDrag;
  showDropTarget(null);
  activeDrag = null;
  preview?.remove();
  tile.classList.remove('dragging');
  if (!moved || event.type !== 'pointerup') return;
  tile.dataset.dragged = 'true';
  setTimeout(() => delete tile.dataset.dragged, 0);
  const target = plannerDropTarget(event, source);
  if (target?.moveTo) {
    if (source.parked) {
      plan.tray = plan.tray.filter((block) => block.id !== source.block.id);
      plan.trayDirty = true;
      markEdited();
    }
    moveNote(source.entry?.id ?? source.block.todoId, target.moveTo, source.block.text);
    return;
  }
  // Shift or Ctrl while dropping copies a planned or parked block instead of moving it.
  const copy = (event.shiftKey || event.ctrlKey) && !source.copy;
  const error = target && moveBlock(source, target, {}, { copy });
  if (!error && target?.indicator?.matches('[data-tab-day]')) selectDay(target.date);
  if (error) {
    tile.classList.add('invalid-drop');
    tile.addEventListener('animationend', () => tile.classList.remove('invalid-drop'), { once: true });
    $('plan-status').textContent = error;
  }
}

// After screens-off the day is over, so the planner opens on tomorrow's week.
function homeMonday() {
  const now = new Date();
  return weekMonday(now.getHours() * 60 + now.getMinutes() >= SCREENS_OFF ? addDays(now, 1) : now);
}

function changePlannerWeek(next) {
  if (dayKey(next) === dayKey(monday)) return;
  flushAutosave();
  if (isPlannerDirty() && !confirm('Leave this week and discard unsaved changes?')) return;
  monday = next;
  plan = null;
  hidePlanUndo();
  selectedDay = null;
  $('plan-status').textContent = '';
  refreshView();
  document.querySelector('.board-scroll').scrollTo(0, 0);
}

function showPlannerScreen(state) {
  const login = state?.view === 'login';
  $('login').hidden = !login;
  $('planner').hidden = login;
  if (login) $('email').focus();
}

function go(state) {
  history.pushState(state, '');
  showPlannerScreen(state);
}

function registerPlannerWorker() {
  if (!navigator.serviceWorker) return;
  let timer;
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data !== 'updated') return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if ((!plan || !isPlannerDirty()) && !activeDrag && $('login').hidden && !document.querySelector('dialog[open]')) {
        location.reload();
      }
    }, 2000);
  });
  navigator.serviceWorker.register('sw.js');
}

function startPlanner() {
  registerPlannerWorker();
  monday = homeMonday();
  $('hard-refresh').addEventListener('click', async () => {
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations()) || [];
      await Promise.all(regs.map((r) => r.unregister()));
      await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    } catch {}
    location.reload();
  });
  $('login-back').addEventListener('click', () => history.back());
  $('week-prev').addEventListener('click', () => changePlannerWeek(addDays(monday, -7)));
  $('week-next').addEventListener('click', () => changePlannerWeek(addDays(monday, 7)));
  $('week-today').addEventListener('click', () => changePlannerWeek(homeMonday()));
  $('plan-now').addEventListener('click', () => openPopup());
  $('week-routine').addEventListener('click', openRoutineEditor);
  $('routine-form').addEventListener('submit', applyRoutineEditor);
  $('routine-cancel').addEventListener('click', () => $('routine-editor').close());
  $('now-form').addEventListener('submit', applyPopup);
  $('now-form').elements.todo.addEventListener('change', fillPopupFields);
  $('now-cancel').addEventListener('click', () => $('now-editor').close());
  $('day-review').addEventListener('click', openDayReview);
  $('review-form').addEventListener('submit', applyDayReview);
  $('review-cancel').addEventListener('click', () => $('review-editor').close());
  $('block-form').addEventListener('submit', applyBlockEditor);
  for (const input of document.querySelectorAll('input[data-scrub]')) initScrub(input);
  $('block-form').addEventListener('change', updateEditorFields);
  $('block-cancel').addEventListener('click', () => $('block-editor').close());
  $('block-delete').addEventListener('click', () => { deleteBlock(editedBlock); $('block-editor').close(); });
  $('block-copy').addEventListener('change', (event) => {
    const date = event.target.value;
    if (!date) return;
    const { block } = editedBlock;
    const error = moveBlock(editedBlock, { date, shelf: Boolean(block.shelf) }, {}, { copy: true });
    if (!error) { $('block-editor').close(); selectDay(date); return; }
    event.target.value = '';
    $('block-error').textContent = error;
    $('block-error').hidden = false;
  });
  // On the document, since clicking a blank part of the dialog can leave focus on <body>.
  document.addEventListener('keydown', (event) => {
    if (!$('block-editor').open || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    const armed = quickDelete;
    quickDelete = false;
    // Outside a text field, Delete always deletes.
    const typing = event.target.matches('textarea, select, input:not([type=checkbox]):not([type=radio])');
    if ((armed || !typing) && event.key === 'Delete' && !event.repeat && !$('block-delete').hidden) {
      event.preventDefault();
      $('block-delete').click();
    }
  });
  $('block-editor').addEventListener('pointerdown', () => { quickDelete = false; });
  $('block-done').addEventListener('click', () => {
    removeNote(editedBlock.copy ? editedBlock.entry.id : editedBlock.block.todoId, 'done');
    $('block-editor').close();
  });
  $('template-form').addEventListener('submit', applyTemplateEditor);
  $('template-form').addEventListener('change', updateTemplateFields);
  $('template-cancel').addEventListener('click', () => $('template-editor').close());
  $('template-edit').addEventListener('click', () => openTemplateDef($('template-form').elements.template.value));
  $('template-new').addEventListener('click', () => openTemplateDef(null));
  $('template-def-form').addEventListener('submit', saveTemplateDef);
  $('template-def-cancel').addEventListener('click', () => $('template-def').close());
  $('template-def-delete').addEventListener('click', deleteTemplateDef);
  $('template-block').addEventListener('input', editTemplateBlock);
  $('template-block-delete').addEventListener('click', deleteTemplateBlock);
  $('template-def-form').elements.wake.addEventListener('input', renderTemplateDay);
  $('template-day').addEventListener('pointerdown', templatePointerDown);
  $('template-day').addEventListener('pointermove', (event) => {
    if (tplDrag || event.pointerType === 'touch') return;
    $('template-day').classList.toggle('resizing', Boolean(tileBottomEdgeAt(event)));
  });
  $('template-day').addEventListener('pointermove', templatePointerMove);
  $('template-day').addEventListener('pointerup', templatePointerUp);
  $('template-day').addEventListener('pointercancel', templatePointerUp);
  $('template-day').addEventListener('click', templateDayClick);
  $('goal-form').addEventListener('submit', applyGoalEditor);
  $('goal-cancel').addEventListener('click', () => $('goal-editor').close());
  $('restack-form').addEventListener('submit', applyRestack);
  $('restack-cancel').addEventListener('click', () => $('restack-editor').close());
  for (const dialog of document.querySelectorAll('dialog')) {
    // Close on a press and release that both land on the backdrop, not on a text drag that ends outside.
    const outside = (event) => {
      const box = dialog.getBoundingClientRect();
      return event.target === dialog && (event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom);
    };
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (event) => { pressedOutside = outside(event); });
    dialog.addEventListener('click', (event) => {
      if (pressedOutside && outside(event)) dialog.close();
      pressedOutside = false;
    });
  }
  const board = document.querySelector('.board-scroll');
  board.addEventListener('scroll', () => board.classList.toggle('scrolled', board.scrollTop > 0), { passive: true });
  // The tray and the days, which tiles get dragged between.
  const tilesArea = document.querySelector('.board');
  tilesArea.addEventListener('pointerdown', startDrag);
  tilesArea.addEventListener('pointermove', (event) => {
    if (activeDrag || event.pointerType === 'touch') return;
    tilesArea.classList.toggle('resizing', Boolean(tileBottomEdgeAt(event)));
  });
  window.addEventListener('pointermove', moveDrag, { passive: false });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  tilesArea.addEventListener('click', (event) => {
    const timeline = event.target.closest('.timeline');
    // Phones scroll on a drag, so a tap on an empty part of a day adds an item there.
    if (lastPointerType === 'touch' && timeline && !event.target.closest('.tile')) {
      openDraft(timeline.closest('[data-day]').dataset.day, Math.min(timelineMinute(timeline, event.clientY, { round: Math.floor, edges: timelineEdges(timeline) }), PLAN_END - 15));
      return;
    }
    const tile = event.target.closest('.tile[data-id]');
    if (!tile || tile.dataset.dragged || event.detail > 1) return;
    const open = () => {
      const source = blockSource(tile);
      if (tile.dataset.source === 'Todo' && urgentTodos().some((entry) => entry.id === tile.dataset.id)) openPopup(tile.dataset.id);
      else if (source?.block) openBlockEditor(source);
    };
    if (event.detail === 0) open();
    else tileClick = setTimeout(open, 260);
  });
  tilesArea.addEventListener('dblclick', (event) => {
    const tile = event.target.closest('.tile[data-id]');
    if (!tile) return;
    clearTimeout(tileClick);
    if ($('block-editor').open) $('block-editor').close();
    deleteBlock(blockSource(tile));
  });
  window.addEventListener('beforeunload', (event) => {
    flushAutosave(false);
    if (plan && isPlannerDirty()) event.preventDefault();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAutosave(false); });
  window.addEventListener('popstate', (event) => showPlannerScreen(event.state));
  showPlannerScreen(history.state);
  refreshView();
  const url = new URL(location.href);
  if (url.searchParams.get('review') === '1') {
    url.searchParams.delete('review');
    history.replaceState(history.state, '', url);
    openDayReview();
  }
  setInterval(() => {
    refreshReviewStatus();
    showNow();
  }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshReviewStatus(); });
  showStatus();
  sync();
  navigator.storage?.persist?.();
}

if (typeof document !== 'undefined') startPlanner();
