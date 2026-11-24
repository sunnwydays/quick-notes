const PLAN_COLOURS = ['#8adcbb', '#f5a35c', '#c2b1f2', '#f2c230', '#5aa9f0', '#ef7fb4'];
// Old pastel picks saved before the palette got stronger, mapped to their replacements.
const LEGACY_COLOURS = { '#c8efd9': PLAN_COLOURS[0], '#ffdcc8': PLAN_COLOURS[1], '#e5dcfa': PLAN_COLOURS[2], '#fff1ba': PLAN_COLOURS[3], '#d5ebff': PLAN_COLOURS[4], '#f9d9ea': PLAN_COLOURS[5] };
const COLOUR_NAMES = ['Teal', 'Orange', 'Violet', 'Gold', 'Blue', 'Pink'];
const BLOCK_KINDS = {
  '': 'Automatic', study: 'Study', project: 'Project / AI tutor',
  fun: 'Open-ended fun', free: 'Free', buffer: 'Buffer',
  exercise: 'Exercise', routine: 'Routine', meal: 'Meal', travel: 'Travel',
};
const FIRST_WEEK_GOALS = { chess: 6, lab: 2, fitness: 6.5, study: 20 };
const WIND_DOWN = ['22:00', 60, 'Screens off · read, walk or paper'];
const TEMPLATES = {
  Weekday: {
    wake: '07:00', startOffset: 0, deepCap: 4, anchors: [
      ['07:00', 45, 'Wake + breakfast + routine'], ['07:45', 30, 'Walk outside'],
      ['11:30', 50, 'Lunch + dishes + read', 'meal'], ['12:20', 25, 'Free', 'free'],
      ['14:10', 60, 'Afternoon cardio', 'exercise'], ['15:10', 45, 'Buffer', 'buffer'],
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
    anchors: [['09:00', 480, 'Welding', '', 0, true], ['21:30', 15, 'Review'], WIND_DOWN],
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
let templateDate;
let editingGoal;
let restacking;
let selectedDay;
let dropChoices = null;
let goalsOpen = false;
let lastPointerType;
let mealConnectorObserver;
const mealLineStops = new WeakMap();

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
    const stored = saved?.value.days?.[date];
    const day = Array.isArray(stored?.blocks)
      ? { ...stored, blocks: stored.blocks.filter((block) => !tickedOff(block)).map(foldTail).map(dropStaleFixed) } : stored;
    days[date] = Array.isArray(day?.blocks) ? day : dayFromSchedule(schedule);
    // Older imports treated every written time range as a pin.
    if (day?.imported && !day.pinLayout && Array.isArray(day.blocks) && day.blocks.some((block) => block.pinned)) {
      days[date] = { ...day, blocks: day.blocks.map((block) => ({ ...block, pinned: null })) };
    }
    sources[date] = Array.isArray(day?.blocks) ? saved.value.sources?.[date] ?? null : schedule?.id ?? null;
  }
  for (const date of keys) if (Array.isArray(days[date]?.blocks)) days[date] = { ...days[date], blocks: days[date].blocks.map(withExamGoal) };
  planSnap = null;
  plan = { key, keys, days, sources, schedules, version: saved?.entry.id ?? null, dirtyDays: new Set(), scheduleDirty: new Set(),
    budgets: goals?.value || {}, goalVersion: goals?.entry.id ?? null, goalsDirty: false,
    tray: Array.isArray(saved?.value.tray?.week) ? saved.value.tray.week : [], trayDirty: false, pendingMarks: [],
    savedDates: new Set(Object.keys(saved?.value.days || {})) };
}

// A shelf item whose Todo was ticked off, here or in Dash, is finished, so it leaves the shelf.
function tickedOff(block) {
  return block.shelf && block.todoId && data.entries.some((entry) => entry.id === block.todoId && entry.deletedHow === 'done');
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
  // Keep the open week (and its Undo history) instead of reopening it from the saved notes.
  Object.assign(plan, { days, sources, schedules: schedulesForWeek(plan.keys), savedDates: new Set(plan.keys),
    version: weekNote?.id ?? plan.version, goalVersion: goalNote?.id ?? goalVersion?.entry.id ?? null,
    trayDirty: false, goalsDirty: false, pendingMarks: [] });
  plan.dirtyDays.clear();
  plan.scheduleDirty.clear();
  if (!activeDrag) renderPlanner();
  $('plan-status').textContent = '';
  sync();
  return true;
}

const AUTOSAVE_MS = 1000;
let autosaveTimer = null;

function queueAutosave() {
  clearTimeout(autosaveTimer);
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

// Every study block belongs to the exam goal unless it already has one.
function examGoalId() {
  return plannerGoals().find((entry) => /95\+/.test(entry.text))?.id ?? null;
}

function withExamGoal(block) {
  if (block.goal || blockKind(block) !== 'study') return block;
  const goal = examGoalId();
  return goal ? { ...block, goal } : block;
}

function goalColour(goal) {
  const saved = plan.budgets[goal]?.colour;
  if (PLAN_COLOURS.includes(saved)) return saved;
  if (LEGACY_COLOURS[saved]) return LEGACY_COLOURS[saved];
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
  dropChoices = null;
  const before = planSnap;
  renderPlanner();
  queueAutosave();
  if (!before) return;
  undoStack.push(before);
  if (undoStack.length > 50) undoStack.shift();
  $('plan-undo-btn').disabled = false;
}

$('plan-undo-btn').onclick = () => {
  dropChoices = null;
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

function removeFromDay(key, id) {
  const day = plan.days[key];
  storeDay(key, lockShownTimes(day, day.blocks.filter((block) => block.id !== id)));
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
  // Every other block keeps the time it shows now; only this one moves.
  const sameDay = source.date === target.date && !copy;
  if (sameDay) {
    const shown = layoutDay(plan.days[source.date]).blocks.find((block) => block.id === old.id);
    if (shown && !old.pinned && old.actualStart == null) changed.restackStart = shown.start;
  } else {
    delete changed.restackStart;
    delete changed.restackUntil;
  }
  const origin = source.date && plan.days[source.date];
  const remaining = origin?.blocks.filter((block) => block.id !== old.id);
  if (!target.date) {
    if (origin && !copy) removeFromDay(source.date, old.id);
    plan.tray = plan.tray.filter((block) => block.id !== old.id);
    plan.tray.push(untimedBlock(changed));
    plan.trayDirty = true;
    markEdited();
    return '';
  }
  const day = plan.days[target.date];
  let blocks = source.date === target.date && !copy ? remaining : [...day.blocks];
  // A block that is placed or (un)pinned starts fresh: its old actual times no longer apply.
  const moved = !target.shelf && (target.at != null || target.pin != null);
  let block;
  let stay = null;
  if (target.shelf) block = untimedBlock(changed);
  else if (!moved) block = { ...changed, shelf: false };
  else {
    const { actualStart, actualUntil, restackStart, restackUntil, ...fresh } = changed;
    const pinned = target.pin ?? planMinutes(changed.pinned) != null;
    block = dropStaleFixed({ ...fresh, shelf: false, pinned: pinned ? target.at ?? changed.pinned : null });
    // Unpinning without a new time leaves the block where it was.
    if (sameDay && target.at == null) stay = restackStart ?? planMinutes(changed.pinned);
  }
  // Compare with the saved block: the editor hands over a source that already carries the new length.
  const saved = remaining && origin.blocks.find((item) => item.id === old.id);
  if (sameDay && !target.shelf && !moved && saved && blockDuration(changed) !== blockDuration(saved)) {
    const window = resizeWindow(day, old.id);
    if (window) {
      const requested = blockDuration(changed);
      const range = fitResize(window, requested);
      if (!range || range.until - range.start < requested) {
        return `Only ${Math.max(0, window.latest - window.earliest)} minutes fit between the surrounding blocks.`;
      }
      storeDay(target.date, resizeDayBlock(day, changed, range));
      markEdited();
      return '';
    }
  }
  const fit = target.smart && dropFit(source, target, copy);
  if (target.smart && !fit) return 'This session needs more room.';
  if (fit) block = { ...block, duration: fit.duration, originalDuration: fit.original, skipBreak: Boolean(target.skipBreak) };
  const placeAt = target.shelf ? null : fit ? fit.start : planMinutes(target.at) ?? planMinutes(block.pinned) ?? stay;
  const wake = dayWake(day);
  if ((target.at != null || !sameDay) && placeAt != null && placeAt < wake) return `Choose a time at or after ${clock12(wake)}.`;
  if (placeAt != null && placeAt + blockDuration(block) > DAY_END) return 'Choose a time that ends by midnight.';
  const probe = placeAt != null ? { ...block, pinned: blockKey(placeAt) } : block;
  const keepsActual = !copy && source.date === target.date && block.actualStart != null;
  if (!keepsActual && pinCollision(probe, blocks)) return 'That time overlaps another pinned block.';
  if (fit) {
    // Buffers the drop ate into shrink to what's left of them, or go away.
    blocks = blocks.filter((item) => !fit.removed.includes(item.id))
      .map((item) => item.id in fit.resized ? { ...item, duration: fit.resized[item.id] } : item);
  }
  const index = blocks.findIndex((item) => item.id === target.before);
  blocks.splice(index < 0 ? blocks.length : index, 0, block);
  if (origin && source.date !== target.date && !copy) removeFromDay(source.date, old.id);
  if (source.parked && !copy) {
    plan.tray = plan.tray.filter((item) => item.id !== old.id);
    plan.trayDirty = true;
  }
  if (fit) {
    const timed = [...fit.timed, { ...block, start: placeAt, until: placeAt + fit.duration }].sort((a, b) => a.start - b.start);
    const bumped = layoutDay(day).bumped.filter(item => item.id !== block.id);
    storeDay(target.date, keepDayTimes(day, lockRestackTimes(blocks, timed), timed, bumped));
  } else {
    const updated = moved && placeAt != null ? placeInDay(day, blocks, block, placeAt)
      : lockShownTimes(day, blocks, sameDay ? old.id : null);
    storeDay(target.date, updated);
  }
  markEdited();
  if (fit && fit.duration < fit.original) {
    dropChoices = { week: plan, remainder: fit.original - fit.duration, block, date: target.date };
    renderDropChoices();
  }
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
    removeFromDay(source.date, source.block.id);
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

function showKindHelp(open) {
  $('kind-help').hidden = !open;
  $('kind-info').setAttribute('aria-expanded', String(open));
}

$('kind-info').onclick = () => showKindHelp($('kind-help').hidden);
const exemptKindNames = BREAK_EXEMPT_KINDS.map(kind => BLOCK_KINDS[kind]);
$('kind-help').textContent = `${new Intl.ListFormat('en').format(exemptKindNames)} skip breaks on both sides. Automatic uses the item name to infer its kind.`;

function openBlockEditor(source, target = blockTarget(source)) {
  const block = source.block;
  const { date, shelf } = target;
  const timed = Boolean(date && !shelf);
  const fields = $('block-form').elements;
  fields.text.value = block.text;
  fields.next.value = block.next;
  fillOptions(fields.kind, Object.entries(BLOCK_KINDS), Object.hasOwn(BLOCK_KINDS, block.kind) ? block.kind : '');
  fields.size.value = block.duration ?? block.size;
  const goals = plannerGoals().map((item) => [item.id, bare(item.text)]);
  if (block.goal && !goals.some(([id]) => id === block.goal)) goals.push([block.goal, 'Archived goal']);
  fillOptions(fields.goal, [['', 'No goal'], ...goals], block.goal || '');
  const start = target.at ?? block.pinned ??
    (source.date ? blockKey(layoutDay(plan.days[source.date]).blocks.find((b) => b.id === block.id)?.start ?? PLAN_START) : '07:00');
  editedBlock = { ...source, target, timed, start: timed ? start : null };
  fields.pin.checked = Boolean(block.pinned);
  fields.time.value = timed ? start : '';
  const end = blockKey(planMinutes(start) + blockDuration(block));
  $('block-where').textContent = !date ? 'This week tray' : `${dayLabel(date)} · ${timed ? `${clock12(start)}–${clock12(end)}` : 'To do'}`;
  // Existing items can move to another day or time from here; a new one only shows the time it was drawn at.
  const existing = !source.fresh;
  fillOptions(fields.day, [['', 'To do (no day)'], ...plan.keys.map((key) => [key, dayLabel(key)])], date || '');
  fields.day.parentElement.hidden = !existing;
  $('block-when').hidden = !existing && !timed;
  $('block-when').classList.toggle('field-row', existing);
  const dayIndex = plan.keys.indexOf(source.date);
  $('block-quick').hidden = !(existing && source.date);
  for (const button of $('block-quick').querySelectorAll('[data-quick]')) {
    const kind = button.dataset.quick;
    button.hidden = kind === 'tomorrow' ? dayIndex < 0 || dayIndex === plan.keys.length - 1 : kind.startsWith('later') && !timed;
  }
  $('block-more').open = false;
  showKindHelp(false);
  updateQuickHint();
  $('block-editor-title').textContent = source.fresh ? 'Add item' : 'Edit item';
  $('block-delete').hidden = Boolean(source.fresh);
  $('block-done').hidden = !source.copy && !liveTodo(block.todoId);
  quickDelete = !$('block-delete').hidden;
  // Only a timed block on today or an earlier day can have happened, so only it can be skipped or run over.
  $('block-mark-row').hidden = !(existing && !source.copy && timed && date <= dayKey(new Date()));
  // Existing planned or parked blocks can be copied onto another day of this week.
  $('block-copy-row').hidden = Boolean(source.fresh || source.copy);
  fillOptions($('block-copy'), [['', 'Another day…'],
    ...Object.keys(plan.days).filter((key) => key !== date).map((key) => [key, dayLabel(key)])], '');
  showEditorError('');
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

// A small preview of the time and length a new item's title will use.
function updateQuickHint() {
  const hint = $('block-hint');
  const typed = editedBlock?.fresh ? parseQuickAdd($('block-form').elements.text.value.trim()) : {};
  const parts = [];
  if (typed.start != null && editedBlock.target.date) parts.push(clock12(typed.start));
  if (typed.duration != null) {
    const [hours, minutes] = [Math.floor(typed.duration / 60), typed.duration % 60];
    parts.push([hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' '));
  }
  hint.hidden = !parts.length;
  hint.textContent = parts.length ? `→ ${parts.join(' · ')}` : '';
}

function updateEditorFields() {
  const fields = $('block-form').elements;
  const { fresh, timed, target } = editedBlock;
  const day = fresh ? target.date : fields.day.value;
  // The time only means something on a day; a fresh item on a shelf or the tray has none to show.
  const showTime = Boolean(day) && (!fresh || timed);
  $('block-start').hidden = !showTime;
  fields.time.disabled = !showTime;
  // A timed block must keep a time; an untimed one that gets a time leaves the shelf for the timeline.
  fields.time.required = showTime && timed;
  $('block-pin').hidden = !(timed && day);
  fields.pin.disabled = $('block-pin').hidden;
}

function dayWake(day) {
  return planMinutes(day.wake) ?? PLAN_START;
}

// What a timeline drop at `minute` looks like, the same arrangement a drag would make.
// A pinned block goes exactly there; otherwise the smart fitting adds breaks and pushes blocks.
function timelineMoveTarget(source, date, minute, pin = false) {
  const stack = dropStack(source, date, false);
  if (pin) return { date, shelf: false, at: blockKey(minute), pin: true, before: stack.find((b) => b.start >= minute)?.id };
  const earliest = dayWake(plan.days[date]);
  const place = { at: minute };
  const fit = arrangeTimelineDrop(stack, source.block, place, earliest, false);
  const start = Math.max(earliest, Math.min(PLAN_END - 5, fit?.start ?? timelineDropStart(stack, source.block, place, earliest)));
  return { date, at: blockKey(start), place, earliest, pin: false, before: stack.find((b) => b.start >= start)?.id, smart: true, skipBreak: false };
}

// The next full-length opening on the block's day after both now and its current start.
function laterOpening(source) {
  const { date, block } = source;
  const day = plan.days[date];
  const now = new Date();
  const current = planMinutes(source.start);
  const dayStart = Math.max((planMinutes(day.wake) ?? PLAN_START) + (day.startOffset ?? 0), day.workStart ?? 0);
  const nowMinute = date === dayKey(now) ? now.getHours() * 60 + now.getMinutes() : 0;
  const earliest = Math.ceil(Math.max(dayStart, nowMinute, current + 1) / 5) * 5;
  return fullOpening(dropStack(source, date, false), block, earliest, day.workEnd ?? DEFAULT_TIMELINE_END, earliest, current);
}

// Where "See other openings" goes after a refused move: the drag's own choices panel.
let refusedMove = null;

function showEditorError(message, refused = null) {
  refusedMove = refused;
  $('block-error').textContent = message;
  $('block-error').hidden = !message;
  $('block-openings').hidden = !refused;
}

function quickReschedule(kind) {
  const source = editedBlock;
  const { date, block } = source;
  const pin = planMinutes(block.pinned) != null;
  let target;
  if (kind === 'tray') target = {};
  else if (kind === 'tomorrow') target = { date: plan.keys[plan.keys.indexOf(date) + 1], shelf: true };
  else {
    const minute = kind === 'later15' ? planMinutes(source.start) + 15 : laterOpening(source);
    if (minute == null) { showEditorError('No later opening today.'); return; }
    target = timelineMoveTarget(source, date, minute, pin);
  }
  const error = moveBlock(source, target);
  if (error) { showEditorError(error, target.smart ? { source, target } : null); return; }
  $('block-editor').close();
  if (target.date) selectDay(target.date);
}

// Pinning or unpinning an existing timed item saves at once, so closing the editor keeps it.
function savePinNow(event) {
  const source = editedBlock;
  const { date, shelf } = source?.target ?? {};
  if (source.fresh || !date || shelf) return;
  const pinned = event.target.checked ? source.start : null;
  const updated = toggleBlockPin(plan.days[date], source.block.id, pinned);
  if (!updated) return;
  plan.days[date] = updated;
  plan.dirtyDays.add(date);
  source.block = { ...source.block, pinned };
  markEdited();
}

function applyBlockEditor(event) {
  event.preventDefault();
  const fields = event.target.elements;
  const entered = fields.text.value.trim();
  if (!entered) return;
  const { fresh } = editedBlock;
  const { date: from = null, shelf = false } = editedBlock.target;
  const original = editedBlock.block;
  const date = fresh ? from : fields.day.value || null;
  // A new item's title may carry a time and length ("gym 5pm 1h"); a typed time beats the field.
  const typed = fresh ? parseQuickAdd(entered) : {};
  const text = typed.text ?? entered;
  const typedStart = date && typed.start != null ? blockKey(typed.start) : null;
  const time = typedStart ?? (date && !fields.time.disabled ? fields.time.value || null : null);
  const onTimeline = Boolean(date && time);
  const pinned = onTimeline && !fields.pin.disabled && fields.pin.checked ? time : null;
  const pinChanged = pinned !== (original.pinned ?? null);
  const dayChanged = !fresh && date !== from;
  const timeChanged = onTimeline && (fresh || dayChanged || time !== editedBlock.start);
  const relocated = dayChanged || timeChanged && !fresh;
  const day = plan.days[date];
  const size = typed.duration ?? Number(fields.size.value);
  const resized = size !== (original.duration ?? original.size);
  // Done and deadline are no longer edited here, so existing values carry over untouched.
  const changes = {
    text, next: fields.next.value.trim(), goal: fields.goal.value || withExamGoal({ text, kind: fields.kind.value || undefined }).goal || null,
    kind: fields.kind.value || undefined,
    ...resized ? { size, duration: undefined, originalDuration: undefined, skipBreak: undefined } : {},
  };
  const unchanged = (key) => (changes[key] ?? null) === (original[key] ?? null);
  const textOnly = Object.keys(changes).every(unchanged);
  if (!fresh && textOnly && !relocated) {
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
  const wake = day && dayWake(day);
  if (timeChanged && minute < wake) {
    showEditorError(`Choose a time at or after ${clock12(wake)}.`);
    return;
  }
  if (onTimeline && (pinChanged || timeChanged || oldIndex < 0)) {
    before = layoutDay(day).blocks.find((b) => b.id !== original.id && b.start >= minute)?.id;
  }
  let target = { date, shelf: Boolean(date) && !onTimeline, before };
  const merged = { ...editedBlock, block: { ...original, ...changes } };
  if (onTimeline && (pinChanged || timeChanged)) {
    // An existing block moved to a new time goes through the same fitting as a drag; pins land exactly.
    if ((relocated || typedStart) && !pinned) target = timelineMoveTarget(merged, date, minute);
    else Object.assign(target, { at: time, pin: pinned != null });
  }
  const todo = fresh && !original.todoId && !NOT_TASKS.has(changes.kind) ? linkTodo(text) : null;
  if (todo) changes.todoId = todo.entry.id;
  const error = moveBlock(merged, target, changes);
  if (error) {
    if (todo?.added) data.entries.splice(data.entries.indexOf(todo.entry), 1);
    // The drag's other openings only make sense when nothing besides the place changed.
    showEditorError(error, target.smart && !fresh && textOnly ? { source: editedBlock, target } : null);
  } else {
    if (todo?.added) persist();
    if (!fresh && text !== original.text) renameTodo(original.todoId, text);
    $('block-editor').close();
    if (dayChanged && date) selectDay(date);
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

// Anchors are [time, length, title, kind, tail, pinned]. Old templates pinned via an 'event' kind, so that still pins;
// the rest hold their time like a restacked block, so other blocks can still push them.
function templateAnchor([at, duration, text, kind = 'routine', tail = 0, pin = kind === 'event'], event = false) {
  const fields = { duration: duration + tail, kind: kind === 'event' ? undefined : kind || undefined, templateAnchor: true };
  if (event) fields.templateEvent = true;
  if (pin) return planBlock(newId(), text, { ...fields, pinned: at, tier: 'fixed' });
  const start = planMinutes(at);
  return planBlock(newId(), text, { ...fields, restackStart: start, restackUntil: start + duration + tail });
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
  const event = day.blocks.find((block) => block.templateAnchor && (block.templateEvent || block.kind === 'event'));
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

const ANCHOR_KINDS = ['', 'routine', 'meal', 'exercise', 'travel', 'free', 'buffer'];
let editingTemplate = null;
// The template being edited, laid out like a day: { id, start, duration, text, kind }.
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
    const tile = renderTile(planBlock(block.id, block.text || 'Untitled', { kind: block.kind, tier: block.pin ? 'fixed' : 'medium' }));
    timeTile(tile, block.start, block.start + block.duration, from);
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
  const kinds = ANCHOR_KINDS.includes(block.kind) ? ANCHOR_KINDS : [...ANCHOR_KINDS, block.kind];
  fillOptions(templateField('kind'), kinds.map((kind) => [kind, kind || 'automatic']), block.kind);
  templateField('pin').checked = Boolean(block.pin);
}

function selectTemplateBlock(id, focus = false) {
  tplSelected = id;
  renderTemplateDay();
  showTemplateBlock();
  if (focus) templateField('text').focus();
}

function addTemplateBlock(start, duration = 30) {
  const block = { id: newId(), start: Math.max(0, Math.min(start, DAY_END - duration)), duration, text: '', kind: 'routine', pin: false };
  tplBlocks.push(block);
  selectTemplateBlock(block.id, true);
}

function editTemplateBlock(event) {
  const block = tplBlocks.find((item) => item.id === tplSelected);
  const field = event.target.dataset.f;
  if (!block || !field) return;
  const value = event.target.value;
  if (field === 'text') block.text = value;
  if (field === 'kind') {
    block.kind = value;
  }
  if (field === 'pin') block.pin = event.target.checked;
  if (field === 'time' && planMinutes(value) != null) block.start = planMinutes(value);
  if (field === 'mins' && Number.isInteger(Number(value)) && Number(value) >= 5) block.duration = Number(value);
  renderTemplateDay();
}

function templateEdges(skipId) {
  return tplBlocks.filter((block) => block.id !== skipId)
    .flatMap((block) => [block.start, block.start + block.duration]);
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
    if (event.pointerType === 'touch') holdToDrag(tplDrag, edge);
  } else if (tile) {
    event.preventDefault();
    const grab = event.clientY - tile.getBoundingClientRect().top;
    tplDrag = { id: tile.dataset.id, grab, y: event.clientY, moved: false, pointer: event.pointerId };
    if (event.pointerType === 'touch') holdToDrag(tplDrag, tile);
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
  if (tplDrag.pending) {
    if (Math.abs(event.clientY - tplDrag.y) > HOLD_SLOP) {
      dropHold(tplDrag);
      tplDrag = null;
    }
    return;
  }
  if (!tplDrag.moved && Math.abs(event.clientY - tplDrag.y) < 6) return;
  tplDrag.moved = true;
  const timeline = $('template-day');
  if (tplDrag.resize) {
    const block = tplBlocks.find((item) => item.id === tplDrag.id);
    const end = Math.min(timelineMinute(timeline, event.clientY, { edges: templateEdges(block.id) }), DAY_END);
    const duration = Math.max(15, end - block.start);
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
  const edges = movingEdges(templateEdges(block.id), block.duration);
  const start = Math.min(timelineMinute(timeline, event.clientY - tplDrag.grab, { edges }), DAY_END - block.duration);
  if (start === block.start && tplSelected === block.id) return;
  block.start = start;
  selectTemplateBlock(block.id);
}

function templatePointerUp(event) {
  if (tplDrag?.pointer !== event.pointerId) return;
  const drag = tplDrag;
  tplDrag = null;
  dropHold(drag);
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
    .map(([at, duration, text, kind = 'routine', tail = 0, pin = kind === 'event']) =>
      ({ id: newId(), start: planMinutes(at), duration: duration + tail, text, kind: kind === 'event' || kind === 'almost' ? '' : kind, pin }));
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
    if (block.start + block.duration > DAY_END) return fail(block, `${block.text} runs past midnight.`);
    const before = blocks[i - 1];
    if (before && block.start < before.start + before.duration) return fail(block, `${block.text} overlaps ${before.text}.`);
  }
  const anchors = blocks.map((block) => [blockKey(block.start), block.duration, block.text.trim(), block.kind, 0, Boolean(block.pin)]);
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
  const shown = lockShownTimes(day);
  const kept = shown.blocks.filter((block) => !block.templateAnchor);
  let anchors = (template?.anchors || []).map((anchor) => templateAnchor(anchor));
  const eventAt = event ? planMinutes(event.start) : null;
  if (event) {
    const travel = template.workBeforeEvent ? 'Travel to game' : 'Go + settle';
    const eventAnchors = [
      templateAnchor([blockKey(eventAt - 30), 30, travel, 'travel', 0, true]),
      templateAnchor([event.start, event.duration, event.text, '', 0, true], true),
    ];
    anchors = [...anchors.filter((anchor) => !pinCollision(anchor, eventAnchors)), ...eventAnchors];
  }
  for (const anchor of anchors) {
    if (pinCollision(anchor, [...kept, ...anchors.filter((block) => block !== anchor)])) {
      return { error: `${anchor.text} overlaps a pinned block. Move the pin or choose another event time.` };
    }
  }
  anchors = fitTemplateAnchors(kept, anchors, planMinutes(template?.wake) ?? PLAN_START);
  for (const anchor of anchors) positions.set(anchor.id, planMinutes(anchor.pinned) ?? anchor.restackStart);
  const blocks = [...kept, ...anchors].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
  return { day: editDay({
    ...day, template: name, wake: template?.wake || '07:00', startOffset: template?.startOffset,
    deepCap: template?.deepCap, workStart: template?.workStart, workCap: template?.workCap,
    workEnd: template?.workBeforeEvent ? eventAt - 30 : undefined,
    noNewAfter: template?.noNewAfter, noGhosts: template?.noGhosts,
  }, pushApart(blocks), true) };
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
  // A goal's own colour wins over the kind colours, so assigning a goal always shows.
  const goalFill = goalColour(withExamGoal(block).goal);
  if (goalFill) return goalFill;
  const kind = blockKind(block);
  const text = block.text || '';
  const routineCue = /^(?:wake|breakfast|walk outside|nap|screens off|wind down|bedtime|shower)\b/i;
  if (kind === 'study' || (!block.kind && STUDY_SUBJECT.test(text))) return '#cfc2f2';
  if (kind === 'routine' || kind === 'meal' || (!block.kind && routineCue.test(text))) return '#efd3b8';
  if (kind === 'free' || kind === 'buffer') return '#d6ecd0';
  // Blocks without a goal get a real neutral, so they don't read as greyed out like ghosts or late blocks.
  return '#dbe7f0';
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

function refreshReviewStatus() {
  const now = new Date();
  $('day-review').hidden = now.getHours() * 60 + now.getMinutes() < REVIEW_START;
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
    if (next && next.start < block.until) warnings.add('Overlapping pins');
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

// A day's load bar, amber from 75% and coral from 90%.
function loadMeter(load, label) {
  const bar = meter(load.ratio, label);
  bar.classList.toggle('amber', load.ratio >= .75);
  bar.classList.toggle('coral', load.ratio >= .9);
  bar.title = `Load ${Math.round(load.ratio * 100)}% · ${hoursText(load.placed)}`;
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
    storeDay(key, applyWake(day, time));
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
  // On a phone an empty To Do shrinks to a strip so the day gets the width.
  document.querySelector('.board').classList.toggle('tray-empty', !tray.querySelector('.tile'));
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
  // The hatched stripe marks anything held at its time: pinned blocks and fixed commitments.
  tile.classList.toggle('fixed', block.tier === 'fixed' || planMinutes(block.pinned) != null);
  tile.style.setProperty('--tile-colour', blockColour(block));
  tile.append(element('span', 'tile-title', block.text));
  if (block.bumped) tile.append(element('span', 'bumped', block.bumpedFrom
    ? ` · Bumped from ${block.bumpedFrom === dayKey(new Date()) ? 'today' : dayLabel(block.bumpedFrom, false)}` : ' · Bumped'));
  if (!date || block.shelf) tile.append(element('span', 'tile-size', lengthLabel(block.duration ?? block.size)));
  tile.title = [block.text, planMinutes(block.pinned) != null && `Pinned at ${clock12(block.pinned)}`,
    block.done && `Done = ${block.done}`, block.next,
    block.actualUntil != null && `Ran over until ${clock12(block.actualUntil)}`].filter(Boolean).join('\n');
  return tile;
}

// Places a tile on a timeline.
function timeTile(tile, start, until, from) {
  tile.classList.add('timed');
  tile.style.setProperty('--minute', start - from);
  tile.style.setProperty('--duration', until - start);
  const range = `${clock12(start)}–${clock12(until)}`;
  const time = element('time', 'tile-time', clock12(start));
  time.append(element('span', 'tile-end', `–${clock12(until)}`));
  const label = element('span', 'timed-label');
  label.append(tile.firstElementChild, time);
  tile.prepend(label);
  tile.title = `${tile.title}\n${range}`;
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
  if (!event.target.closest('.day-head h3, .day-menu, .day-tab[aria-pressed="true"]')) closeDayMenus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDayMenus();
});

function renderDay(key,{ blocks, bumped }, load, from, until, ghosts) {
  const date = keyDate(key);
  const day = plan.days[key];
  const column = element('article', 'day');
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
  const arrow = element('span', 'day-arrow', '▾');
  arrow.setAttribute('aria-hidden', 'true');
  name.append(arrow);
  toggle.append(name);
  heading.append(toggle);
  const menu = element('div', 'day-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const menuItem = (label, value, action) => {
    const item = plannerButton('', () => { closeDayMenus(); action(); });
    item.setAttribute('role', 'menuitem');
    item.append(element('span', 'day-option-label', label), element('strong', '', value));
    return item;
  };
  menu.append(
    menuItem('Template', day.template || 'Choose template', () => openTemplateEditor(key)),
    menuItem('Woke at', day.wake?.replace(/^0(?=\d:)/, '') || 'Set time', () => openRestack(key))
  );
  const title = element('div', 'day-title');
  title.append(heading, menu);
  const loadRow = element('div', 'head-load');
  loadRow.append(element('span', 'day-info', `${Math.round(load.ratio * 100)}% · ${hoursText(load.placed)}`),
    loadMeter(load, `${dayLabel(key)} load`));
  head.append(title, loadRow);
  if (changedInDash(key)) head.append(element('span', 'warning', 'Changed on phone'));
  const events = blocks.filter((block) => block.pinned && (block.templateEvent || block.kind === 'event' || block.tier === 'fixed' && !block.templateAnchor));
  for (const event of events) {
    const time = clock12(event.pinned).replace(':00', '');
    head.append(element('p', 'day-info day-event', `${time} ${event.text}`));
  }
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
  const wake = dayWake(day);
  timeline.dataset.from = from;
  timeline.dataset.until = until;
  timeline.dataset.wake = wake;
  const addUntimed = () => openBlockEditor({ fresh: true, block: planBlock(newId(), '') }, { date: key, shelf: true });
  const add = plannerButton('+', addUntimed, 'day-add');
  add.setAttribute('aria-label', `Add an untimed item for ${dayLabel(key)}`);
  shelf.append(add);
  shelf.classList.toggle('empty', shelf.querySelectorAll('.tile').length === 0);
  shelf.addEventListener('click', (event) => {
    if (!event.target.closest('button')) addUntimed();
  });
  timeline.style.setProperty('--minutes', until - from);
  if (wake > from) {
    const shade = element('div', 'before-wake');
    shade.style.setProperty('--duration', wake - from);
    shade.title = `Unavailable until ${clock12(wake)}`;
    timeline.append(shade);
  }
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
  for (const block of blocks) {
    const tile = renderTile(block, key);
    Object.assign(tile.dataset, { start: block.start, until: block.until });
    if (blockKind(block) === 'meal') {
      const meal = /\b(lunch|dinner)\b/i.exec(block.text);
      if (meal) tile.dataset.meal = meal[0].toLowerCase();
    }
    tile.classList.toggle('late', afterDeadline(key, block));
    const time = timeTile(tile, block.start, block.until, from);
    if (block.actualUntil != null) time.append(element('span', 'over-badge', '↗'));
    timeline.append(tile);
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
  for (const warning of dayWarnings(key, day, blocks)) footer.append(element('span', 'warning', warning));
  column.append(head, shelf, timeline, footer);
  return column;
}

function renderMealConnectors(week, columns) {
  mealConnectorObserver?.disconnect();
  const runs = [];
  const runForTile = new Map();
  for (const meal of ['lunch', 'dinner']) {
    const days = columns.map((day) => day.querySelectorAll(`[data-meal="${meal}"]`));
    for (let day = 1; day < days.length; day++) {
      const left = days[day - 1];
      const right = days[day];
      for (let i = 0; i < Math.min(left.length, right.length); i++) {
        let run = runForTile.get(left[i]);
        if (!run) {
          run = [left[i]];
          runs.push(run);
        }
        run.push(right[i]);
        runForTile.set(right[i], run);
      }
    }
  }
  if (!runs.length) {
    mealConnectorObserver = null;
    return;
  }
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const svg = (tag) => document.createElementNS(svgNamespace, tag);
  const overlay = svg('svg');
  const defs = svg('defs');
  overlay.append(defs);
  // Each run uses one stroke so translucent seams between segments cannot overlap.
  const lines = runs.map((tiles, i) => {
    const gradient = svg('linearGradient');
    gradient.id = `meal-line-${i}`;
    gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
    for (const tile of tiles) {
      tile.classList.add('meal-linked');
      const stops = [svg('stop'), svg('stop')];
      mealLineStops.set(tile, stops);
      gradient.append(...stops);
    }
    defs.append(gradient);
    const path = svg('path');
    path.setAttribute('stroke', `url(#${gradient.id})`);
    overlay.append(path);
    return { tiles, path, gradient };
  });
  overlay.classList.add('meal-connectors');
  overlay.setAttribute('aria-hidden', 'true');
  week.prepend(overlay);
  mealConnectorObserver = new ResizeObserver(() => {
    const bounds = overlay.getBoundingClientRect();
    if (!bounds.width) return;
    for (const { tiles, path, gradient } of lines) {
      const tops = tiles.map((tile) => {
        const rect = tile.getBoundingClientRect();
        const style = getComputedStyle(tile);
        return {
          left: rect.left - bounds.left + parseFloat(style.borderTopLeftRadius),
          right: rect.right - bounds.left - parseFloat(style.borderTopRightRadius),
          y: rect.top - bounds.top - .5,
        };
      });
      const first = tops[0];
      const last = tops.at(-1);
      const width = last.right - first.left;
      gradient.setAttribute('x1', first.left);
      gradient.setAttribute('x2', last.right);
      const commands = [`M ${first.left} ${first.y} H ${first.right}`];
      tops.forEach(({ left, right, y }, i) => {
        const [start, end] = mealLineStops.get(tiles[i]);
        start.setAttribute('offset', (left - first.left) / width);
        end.setAttribute('offset', (right - first.left) / width);
        if (i === 0) return;
        const previous = tops[i - 1];
        const bend = (previous.right + left) / 2;
        commands.push(`C ${bend} ${previous.y} ${bend} ${y} ${left} ${y} H ${right}`);
      });
      path.setAttribute('d', commands.join(' '));
    }
  });
  mealConnectorObserver.observe(overlay);
  for (const tile of runs.flat()) mealConnectorObserver.observe(tile);
}

function renderPlanner() {
  const end = addDays(monday, 6);
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  $('week-range').textContent = formatter.formatRange(monday, end);
  $('week-today').hidden = dayKey(monday) === dayKey(homeMonday());
  const layouts = plan.keys.map((key) => layoutDay(plan.days[key]));
  const loads = layouts.map((layout, i) => dayLoad(plan.days[plan.keys[i]], layout.blocks));
  renderGoals(layouts, loads);
  refreshReviewStatus();
  refreshReviewRows();
  const all = layouts.flatMap((layout) => layout.blocks);
  const wakes = plan.keys.map((key) => dayWake(plan.days[key]));
  const from = Math.floor(Math.min(PLAN_START, ...wakes, ...all.map((b) => b.start)) / 60) * 60;
  const until = Math.ceil(Math.max(DEFAULT_TIMELINE_END, Math.max(...wakes) + 1, ...all.map((b) => b.until)) / 60) * 60;
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
    // Tapping the day that's already open shows its menu (template, wake time), since the phone hides the day header.
    const tab = plannerButton('', () => key === selectedDay
      ? toggleDayMenu($('week').querySelector(`.day[data-day="${key}"] .day-menu`)) : selectDay(key), 'day-tab');
    tab.title = key === selectedDay ? 'Day options' : '';
    tab.dataset.tabDay = key;
    tab.append(element('span', '', date.toLocaleDateString(undefined, { weekday: 'short' })),
      element('span', 'day-tab-date', String(date.getDate())), loadMeter(loads[plan.keys.indexOf(key)], `${dayLabel(key)} load`));
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
  const columns = plan.keys.map((key, i) => {
    const column = renderDay(key, layouts[i], loads[i], from, until, ghosts.filter((ghost) => ghost.key === key));
    column.classList.toggle('selected', key === selectedDay);
    return column;
  });
  $('week').replaceChildren(gutter, ...columns);
  renderMealConnectors($('week'), columns);
  $('week').querySelector('.day.selected').scrollTop = scroll;
  $('tray').querySelector('.tray-box').scrollTop = trayScroll;
  renderDropChoices();
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
    const past = date < today || date === today && Number(until) <= minute;
    tile.classList.toggle('past', past);
    const stops = mealLineStops.get(tile);
    if (stops) {
      for (const stop of stops) stop.classList.toggle('past', past);
    }
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
  scrollToNow();
}

// Scrolls today's timeline so an hour before now sits just under the day headers.
// The phone scrolls the selected day; wider screens scroll the whole week.
function scrollToNow() {
  const timeline = $('week').querySelector('.day.today .timeline');
  if (!timeline) return;
  const narrow = matchMedia('(max-width: 700px)').matches;
  if (narrow && !timeline.closest('.day.selected')) return;
  const scroller = narrow ? timeline.closest('.day') : document.querySelector('.board-scroll');
  const now = new Date();
  const minute = Math.max(now.getHours() * 60 + now.getMinutes() - 60, Number(timeline.dataset.from));
  const perMinute = parseFloat(getComputedStyle(timeline).getPropertyValue('--minute-height')) || 1.45;
  const head = timeline.closest('.day').querySelector('.day-head').offsetHeight;
  const y = timeline.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTop = Math.max(0, y + (minute - Number(timeline.dataset.from)) * perMinute - head);
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
  // Drops never unpin: a pinned block keeps its pin (and, on another day, its time).
  if (tab) return { date: tab.dataset.tabDay, indicator: tab };
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
  if (slot.matches('[data-shelf]')) {
    if (tile && date === source.date && tile.dataset.id === source.block.id) return null;
    return { date, shelf: true, before: tile?.dataset.id, indicator: slot };
  }
  const earliest = Number(slot.dataset.wake);
  const pointer = timelineMinute(slot, event.clientY, { round: (minute) => minute });
  if (pointer < earliest) return null;
  // Hit-test the day as saved (previews only move tiles on screen), so the target
  // doesn't flip while blocks slide. Over a block, its upper half means before it and
  // its lower half after it; in open time the block's top follows the pointer.
  const copy = Boolean(activeDrag?.copying) && !source.copy;
  const stack = dropStack(source, date, copy);
  const clamp = (minute) => Math.max(earliest, Math.min(PLAN_END - 5, minute));
  const highlight = under.closest('[data-opening]');
  const matchesSource = dropChoices?.source?.block.id === source.block.id && dropChoices.copy === copy;
  const skipBreak = Boolean(highlight && matchesSource && highlight.dataset.skipBreak);
  let place;
  if (highlight && matchesSource) place = { at: Number(highlight.dataset.opening) };
  else {
    const length = source.block.originalDuration ?? blockDuration(source.block);
    const edges = movingEdges(timelineEdges(slot, source.block.id), length);
    const time = timelineMinute(slot, event.clientY, { edges, offset: activeDrag?.grab ?? 0 });
    place = timelineDropPlace(stack, pointer, time);
    if (place.at != null) place.at = clamp(snapTimelineDrop(stack, { ...source.block, skipBreak: false }, pointer, time, earliest));
  }
  const fit = arrangeTimelineDrop(stack, source.block, place, earliest, skipBreak, dropOrigin(source, date, copy));
  const time = clamp(fit?.start ?? timelineDropStart(stack, source.block, place, earliest));
  const before = stack.find((block) => block.start >= time);
  return { date, at: blockKey(time), place, earliest, fit, copy, before: before?.id, indicator: slot, smart: true, skipBreak };
}

function dropStack(source, date, copy) {
  return layoutDay(plan.days[date]).blocks.filter(item => copy || source.date !== date || item.id !== source.block.id);
}

// Where a block moving within its own day sits now, so a drop inside its run can reorder.
function dropOrigin(source, date, copy) {
  if (copy || source.date !== date) return null;
  return layoutDay(plan.days[date]).blocks.find(item => item.id === source.block.id) ?? null;
}

// The arrangement a timeline drop makes, recomputed from the saved day each time.
function dropFit(source, target, copy) {
  return arrangeTimelineDrop(dropStack(source, target.date, copy), source.block,
    target.place ?? { at: planMinutes(target.at) }, target.earliest, target.skipBreak, dropOrigin(source, target.date, copy));
}

function offerDropChoices(source, target, copy) {
  const now = new Date();
  const today = dayKey(now);
  const options = [];
  let openings = 0;
  const skip = { ...target, skipBreak: true };
  const fit = dropFit(source, skip, copy);
  if (fit) options.push({ target: skip, duration: fit.duration, label: `Skip break this time · ${fit.duration} min` });
  for (const date of plan.keys) {
    if (openings === 3) break;
    if (date < today || date < target.date) continue;
    const day = plan.days[date];
    const earliest = Math.max((planMinutes(day.wake) ?? PLAN_START) + (day.startOffset ?? 0), day.workStart ?? 0,
      date === today ? now.getHours() * 60 + now.getMinutes() : 0);
    const preferred = date === target.date ? planMinutes(target.at) : earliest;
    const current = !copy && source.date === date && layoutDay(day).blocks.find(item => item.id === source.block.id);
    const start = fullOpening(dropStack(source, date, copy), source.block, earliest, day.workEnd ?? DEFAULT_TIMELINE_END, preferred, current?.start);
    if (start == null) continue;
    const duration = source.block.originalDuration ?? blockDuration(source.block);
    openings++;
    options.push({ target: { date, at: blockKey(start), smart: true }, duration,
      label: `${dayLabel(date, false)} · ${clock12(start)}–${clock12(start + duration)}` });
  }
  dropChoices = { week: plan, source, copy, options, offeredAt: performance.now() };
  renderDropChoices();
}

function renderDropChoices() {
  const panel = $('drop-choices');
  panel.replaceChildren();
  for (const el of $('week').querySelectorAll('.fit-opening')) el.remove();
  for (const el of $('planner').querySelectorAll('.fit-source')) el.classList.remove('fit-source');
  panel.hidden = !dropChoices || dropChoices.week !== plan;
  if (panel.hidden) return;
  const { source, copy, options, date, remainder, block } = dropChoices;
  const dismiss = () => { dropChoices = null; renderDropChoices(); };
  if (remainder) {
    panel.append(element('span', '', `${block.text} · ${block.duration} min scheduled`),
      plannerButton(`Keep remaining ${remainder} min in To do`, () => {
        const day = plan.days[date];
        const rest = planBlock(newId(), block.text, { duration: remainder, goal: block.goal, kind: block.kind, shelf: true });
        // Saving the remainder splits this occurrence into two independently sized sessions.
        const parts = day.blocks.map(item => item.id === block.id ? { ...item, originalDuration: item.duration } : item);
        storeDay(date, { ...day, blocks: [...parts, rest] });
        markEdited();
      }));
  } else {
    const original = source.block.originalDuration ?? blockDuration(source.block);
    panel.append(element('span', '', `${source.block.text} needs at least ${minimumSession(original)} min in this slot.`));
    for (const tile of $('planner').querySelectorAll('.tile[data-id]')) {
      if (tile.dataset.id === source.block.id && tile.dataset.date === source.date) tile.classList.add('fit-source');
    }
    for (const option of options) {
      const { target, duration, label } = option;
      const choose = () => {
        const error = moveBlock(source, target, {}, { copy });
        if (error) { dismiss(); $('plan-status').textContent = error; return; }
        selectDay(target.date);
        const column = $('week').querySelector(`[data-day="${target.date}"]`);
        const placed = [...column.querySelectorAll('.tile[data-start]')].find(tile =>
          Number(tile.dataset.start) === planMinutes(target.at) && tile.querySelector('.tile-title')?.textContent === source.block.text);
        placed?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      };
      panel.append(plannerButton(label, choose));
      const timeline = $('week').querySelector(`[data-day="${target.date}"] .timeline`);
      const start = planMinutes(target.at);
      const marker = plannerButton('', choose, 'tile fit-opening');
      // Keep rebuilt markers in phase when switching days or autosaving.
      marker.style.animationDelay = `${dropChoices.offeredAt - performance.now()}ms`;
      marker.dataset.opening = start;
      if (target.skipBreak) marker.dataset.skipBreak = 'true';
      marker.append(element('span', 'tile-title', target.skipBreak ? 'Skip break' : `${duration} min available`));
      timeTile(marker, start, start + duration, Number(timeline.dataset.from));
      timeline.append(marker);
    }
    if (!options.length) panel.append(element('span', '', 'No full opening left this week.'));
  }
  panel.append(plannerButton('Dismiss', dismiss, 'quiet'));
}

function showDropTarget(target) {
  activeDrag.target?.indicator?.classList.remove('drop-target', 'drop-line');
  movePreview(target);
  const indicator = target?.indicator;
  if (indicator?.matches('.timeline')) {
    // One solid line where the block goes when it's inserted before or after another; none in open time.
    if (target.place.at == null) {
      indicator.classList.add('drop-line');
      indicator.style.setProperty('--drop-minute', planMinutes(target.at) - Number(indicator.dataset.from));
    }
  } else indicator?.classList.add('drop-target');
  activeDrag.target = target;
}

function setTileTime(tile, start, until) {
  const time = tile.querySelector('.tile-time');
  if (!time) return;
  time.firstChild.textContent = clock12(start);
  time.querySelector('.tile-end').textContent = `–${clock12(until)}`;
}

// A small copy of the block follows the pointer the whole drag. Over a timeline the day
// also shows the drop's arrangement: the block where it lands and the blocks it shifts.
function movePreview(target) {
  const drag = activeDrag;
  const { preview, tile, position, source } = drag;
  if (!preview) return;
  for (const { el, minute, length, start, until } of drag.shifted ?? []) {
    el.style.setProperty('--minute', minute);
    el.style.setProperty('--duration', length);
    setTileTime(el, start, until);
    el.classList.remove('drag-shifted', 'drag-hidden');
  }
  drag.shifted = [];
  drag.landing?.remove();
  drag.landing = null;
  if (position) {
    // On touch the copy sits above the finger so the insertion line stays visible.
    const { clientX: x, clientY: y } = position;
    Object.assign(preview.style, drag.touch
      ? { left: `${x - drag.width / 2}px`, top: `${y - drag.height - 36}px` }
      : { left: `${x + 12}px`, top: `${y + 12}px` });
  }
  const live = Boolean(target?.smart && target.indicator.matches('.timeline'));
  const copying = live ? target.copy : Boolean(drag.copying) && !source.copy;
  tile.classList.toggle('drag-hidden', live && !copying);
  tile.classList.toggle('dragging', !copying);
  if (!live) return;
  const timeline = target.indicator;
  const from = Number(timeline.dataset.from);
  const { fit } = target;
  const start = planMinutes(target.at);
  const landing = renderTile(source.block, target.date);
  delete landing.dataset.id;
  landing.tabIndex = -1;
  landing.setAttribute('aria-hidden', 'true');
  timeTile(landing, start, start + (fit?.duration ?? drag.length), from);
  landing.classList.add('drag-live');
  landing.classList.toggle('fit-blocked', !fit);
  landing.querySelector('.tile-title').textContent = !fit ? 'Needs more room'
    : fit.duration < fit.original ? `${fit.duration} of ${fit.original} min · ${source.block.text}` : source.block.text;
  timeline.append(landing);
  drag.landing = landing;
  const tileFor = (id) => timeline.querySelector(`.tile.timed[data-id="${CSS.escape(id)}"]:not(.ghost)`);
  const remember = (el) => drag.shifted.push({ el, minute: el.style.getPropertyValue('--minute'),
    length: el.style.getPropertyValue('--duration'), start: Number(el.dataset.start), until: Number(el.dataset.until) });
  for (const item of fit?.timed ?? []) {
    const el = tileFor(item.id);
    if (!el || (Number(el.dataset.start) === item.start && Number(el.dataset.until) === item.until)) continue;
    remember(el);
    el.style.setProperty('--minute', item.start - from);
    el.style.setProperty('--duration', item.until - item.start);
    setTileTime(el, item.start, item.until);
    el.classList.add('drag-shifted');
  }
  for (const id of fit?.removed ?? []) {
    const el = tileFor(id);
    if (!el) continue;
    remember(el);
    el.classList.add('drag-hidden');
  }
}

// Times are free to the minute, but land on a nearby edge (another block's start or
// end) when the pointer is within a finger's width of it, so blocks still stack flush.
const EDGE_SNAP_PX = 10;

function timelineMinute(timeline, clientY, { round = Math.round, edges = [], offset = 0, clamp = true } = {}) {
  const rect = timeline.getBoundingClientRect();
  const from = Number(timeline.dataset.from);
  const until = Number(timeline.dataset.until);
  const scale = (rect.height - 8) / (until - from);
  const raw = from + (clientY - rect.top) / scale - offset;
  let minute = from + round(raw - from);
  let best = EDGE_SNAP_PX / scale;
  for (const edge of edges) {
    if (Math.abs(edge - raw) <= best) { minute = edge; best = Math.abs(edge - raw); }
  }
  return clamp ? Math.max(from, Math.min(until, minute)) : minute;
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
  return current > anchor ? [anchor, current] : [current, Math.min(PLAN_END, anchor + 15)];
}

function openDraft(date, start, duration) {
  const fields = duration == null ? {} : PLAN_SIZES.includes(duration) ? { size: duration } : { duration };
  openBlockEditor({ fresh: true, block: planBlock(newId(), '', fields) }, { date, at: blockKey(start) });
}

function draftStart(timeline, clientY, edges) {
  const minute = timelineMinute(timeline, clientY, { round: Math.floor, edges });
  return Math.max(Number(timeline.dataset.wake), Math.min(minute, PLAN_END - 15));
}

function startDraft(event) {
  const timeline = event.target.closest('.timeline');
  if (!timeline || event.target.closest('.tile, .before-wake') || event.pointerType === 'touch') return;
  event.preventDefault();
  const edges = timelineEdges(timeline);
  const anchor = draftStart(timeline, event.clientY, edges);
  const preview = element('div', 'tile timed draft');
  activeDrag = { draft: true, timeline, preview, edges, anchor, current: anchor, pointer: event.pointerId, y: event.clientY, moved: false };
}

function moveDraft(event) {
  if (!activeDrag.moved && Math.abs(event.clientY - activeDrag.y) < 6) return;
  const { timeline, preview, edges } = activeDrag;
  if (!activeDrag.moved) timeline.append(preview);
  activeDrag.moved = true;
  activeDrag.current = Math.max(Number(timeline.dataset.wake), Math.min(timelineMinute(timeline, event.clientY, { edges }), PLAN_END));
  const [start, end] = draftRange(activeDrag);
  const from = Number(timeline.dataset.from);
  preview.style.setProperty('--minute', start - from);
  preview.style.setProperty('--duration', end - start);
  preview.textContent = `${clock12(start)}–${clock12(end)}`;
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

function previewResize(drag, { start, until }) {
  drag.tile.style.setProperty('--minute', start - Number(drag.timeline.dataset.from));
  drag.tile.style.setProperty('--duration', until - start);
  setTileTime(drag.tile, start, until);
}

// On touch a drag only starts after a short hold, so a finger that moves first scrolls the page.
const HOLD_TO_DRAG_MS = 300;
const HOLD_SLOP = 8;

function holdToDrag(drag, tile) {
  drag.pending = true;
  drag.liftTile = tile;
  drag.holdTimer = setTimeout(() => {
    drag.pending = false;
    drag.armed = true;
    navigator.vibrate?.(15);
    tile.classList.add('lifted');
  }, HOLD_TO_DRAG_MS);
}

function dropHold(drag) {
  clearTimeout(drag.holdTimer);
  drag.liftTile?.classList.remove('lifted');
}

// Once a hold has armed a touch drag, the page must not scroll under the finger.
document.addEventListener('touchmove', (event) => {
  if ((activeDrag?.armed || tplDrag?.armed) && event.cancelable) event.preventDefault();
}, { passive: false });
// A long press would otherwise open the browser's context menu mid-hold.
document.addEventListener('contextmenu', (event) => {
  if (activeDrag?.touch || tplDrag?.holdTimer) event.preventDefault();
});

// On a phone, a horizontal swipe on the selected day moves to the next or previous day.
let daySwipe = null;
let daySwipedAt = 0;

function daySwipeDown(event) {
  daySwipe = null;
  if (event.pointerType !== 'touch' || !event.isPrimary || !matchMedia('(max-width: 700px)').matches) return;
  if (!event.target.closest('.day.selected') || event.target.closest('.day-menu')) return;
  daySwipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
}

function daySwipeUp(event) {
  const start = daySwipe;
  daySwipe = null;
  if (event.type !== 'pointerup' || start?.id !== event.pointerId || activeDrag?.armed || activeDrag?.moved) return;
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (Math.abs(dx) <= 60 || Math.abs(dx) <= 1.5 * Math.abs(dy)) return;
  daySwipedAt = Date.now();
  const step = dx < 0 ? 1 : -1;
  const index = plan.keys.indexOf(selectedDay) + step;
  if (index >= 0 && index < plan.keys.length) {
    selectDay(plan.keys[index]);
    return;
  }
  const before = monday;
  changePlannerWeek(addDays(monday, step * 7));
  if (monday === before) return;
  const key = dayKey(addDays(monday, step > 0 ? 0 : 6));
  if (plan) selectDay(key);
  else selectedDay = key;
}

function startDrag(event) {
  lastPointerType = event.pointerType;
  if (event.target.closest('.fit-opening')) return;
  if (event.button !== 0 || activeDrag) return;
  const edgeTile = tileBottomEdgeAt(event);
  if (edgeTile) {
    const tile = edgeTile;
    const source = blockSource(tile);
    if (!source?.block) return;
    event.preventDefault();
    tile.setPointerCapture(event.pointerId);
    activeDrag = { resize: true, tile, source, timeline: tile.closest('.timeline'), pointer: event.pointerId,
      start: Number(tile.dataset.start), until: Number(tile.dataset.until), moved: false,
      x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch' };
    activeDrag.grab = timelineMinute(activeDrag.timeline, event.clientY, { round: minute => minute, clamp: false }) - activeDrag.until;
    activeDrag.window = resizeWindow(plan.days[source.date], source.block.id);
    if (activeDrag.touch) holdToDrag(activeDrag, tile);
    return;
  }
  const tile = event.target.closest('.tile[data-id]');
  if (!tile) {
    startDraft(event);
    return;
  }
  const source = blockSource(tile);
  if (!source?.block) return;
  activeDrag = { tile, source, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
    length: blockDuration(source.block), touch: event.pointerType === 'touch' };
  const timeline = tile.classList.contains('timed') && tile.closest('.timeline');
  if (timeline) {
    activeDrag.length = Number(tile.dataset.until) - Number(tile.dataset.start);
    activeDrag.grab = timelineMinute(timeline, event.clientY, { round: (minute) => minute }) - Number(tile.dataset.start);
  }
  if (activeDrag.touch) holdToDrag(activeDrag, tile);
}

function moveDrag(event) {
  if (activeDrag?.pointer !== event.pointerId) return;
  if (activeDrag.draft) {
    moveDraft(event);
    return;
  }
  if (activeDrag.pending) {
    // Moving before the hold finishes is a scroll: leave the tile alone.
    if (Math.hypot(event.clientX - activeDrag.x, event.clientY - activeDrag.y) > HOLD_SLOP) {
      dropHold(activeDrag);
      activeDrag = null;
    }
    return;
  }
  if (activeDrag.resize) {
    event.preventDefault();
    const drag = activeDrag;
    if (!drag.window) return;
    const options = { offset: drag.grab, clamp: false };
    const pointer = timelineMinute(drag.timeline, event.clientY, options);
    const end = pointer < drag.window.latest
      ? timelineMinute(drag.timeline, event.clientY, { ...options, edges: [drag.window.latest] }) : pointer;
    drag.requested = Math.max(Math.min(15, drag.until - drag.start), end - drag.start);
    const range = fitResize(drag.window, drag.requested);
    if (range) {
      drag.moved = true;
      previewResize(drag, range);
    }
    return;
  }
  if (!activeDrag.moved) {
    if (Math.hypot(event.clientX - activeDrag.x, event.clientY - activeDrag.y) < 6) return;
    activeDrag.moved = true;
    const bounds = activeDrag.tile.getBoundingClientRect();
    const preview = activeDrag.tile.cloneNode(true);
    preview.classList.add('drag-preview');
    preview.setAttribute('aria-hidden', 'true');
    preview.tabIndex = -1;
    // Kept small so it reads as a handle, not a second copy of the arrangement.
    Object.assign(activeDrag, { width: Math.min(bounds.width, 200), height: Math.min(bounds.height, 44) });
    Object.assign(preview.style, { width: `${activeDrag.width}px`, height: `${activeDrag.height}px` });
    document.body.append(preview);
    activeDrag.preview = preview;
    activeDrag.tile.classList.add('dragging');
    activeDrag.tile.setPointerCapture(event.pointerId);
    requestAnimationFrame(scrollDuringDrag);
  }
  event.preventDefault();
  activeDrag.copying = event.shiftKey || event.ctrlKey;
  activeDrag.position = { clientX: event.clientX, clientY: event.clientY };
  showDropTarget(plannerDropTarget(event, activeDrag.source));
}

// Holding or releasing Shift/Ctrl mid-drag switches between moving and copying live.
function dragModifierChanged(event) {
  if (!activeDrag?.moved || activeDrag.resize || activeDrag.draft || !activeDrag.position) return;
  const copying = event.shiftKey || event.ctrlKey;
  if (copying === activeDrag.copying) return;
  activeDrag.copying = copying;
  showDropTarget(plannerDropTarget(activeDrag.position, activeDrag.source));
}
document.addEventListener('keydown', dragModifierChanged);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeDrag) endDrag({ type: 'cancel', pointerId: activeDrag.pointer });
});
document.addEventListener('keyup', dragModifierChanged);

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
  dropHold(activeDrag);
  if (activeDrag.pending) {
    // A tap, or a scroll that took over: nothing was lifted, so the click opens the editor as usual.
    activeDrag = null;
    return;
  }
  if (activeDrag.resize) {
    const drag = activeDrag;
    const { tile, source, moved, requested } = drag;
    activeDrag = null;
    tile.dataset.dragged = 'true';
    setTimeout(() => delete tile.dataset.dragged, 0);
    const day = plan.days[source.date];
    const block = day?.blocks.find(item => item.id === source.block.id);
    const range = moved && block && fitResize(resizeWindow(day, block.id), requested);
    if (event.type !== 'pointerup' || !range || (range.start === drag.start && range.until === drag.until)) {
      previewResize(drag, drag);
      return;
    }
    storeDay(source.date, resizeDayBlock(day, block, range));
    markEdited();
    return;
  }
  const { tile, source, moved, preview, armed } = activeDrag;
  // Release applies exactly what was previewed; anything else cancels and restores the view.
  const target = moved && event.type === 'pointerup' ? activeDrag.target : null;
  showDropTarget(null);
  activeDrag = null;
  preview?.remove();
  tile.classList.remove('dragging', 'drag-hidden');
  if (moved || armed) {
    // Swallow the click that follows the release, even after an Escape mid-drag.
    tile.dataset.dragged = 'true';
    const clear = () => setTimeout(() => delete tile.dataset.dragged, 0);
    if (event.type === 'pointerup') clear();
    else window.addEventListener('pointerup', clear, { once: true });
  }
  if (!moved || event.type !== 'pointerup') return;
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
  const copy = target?.copy ?? ((event.shiftKey || event.ctrlKey) && !source.copy);
  const error = target && moveBlock(source, target, {}, { copy });
  if (!error && target?.indicator?.matches('[data-tab-day]')) selectDay(target.date);
  if (error) {
    tile.classList.add('invalid-drop');
    tile.addEventListener('animationend', () => tile.classList.remove('invalid-drop'), { once: true });
    if (target.smart) offerDropChoices(source, target, copy);
    else $('plan-status').textContent = error;
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
  scrollToNow();
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
  $('block-form').elements.pin.addEventListener('change', savePinNow);
  $('block-form').elements.text.addEventListener('input', updateQuickHint);
  $('block-cancel').addEventListener('click', () => $('block-editor').close());
  for (const button of $('block-quick').querySelectorAll('[data-quick]')) {
    button.addEventListener('click', () => quickReschedule(button.dataset.quick));
  }
  $('block-openings').addEventListener('click', () => {
    if (!refusedMove) return;
    const { source, target } = refusedMove;
    $('block-editor').close();
    offerDropChoices(source, target, false);
  });
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
  $('block-skip').addEventListener('click', () => {
    const { block, target: { date } } = editedBlock;
    const timed = layoutDay(plan.days[date]).blocks.find((item) => item.id === block.id);
    if (!timed) return;
    const mark = makeBlockMark(date, { start: timed.start, lines: [timed.text] }, { status: 'skipped' });
    plan.pendingMarks = plan.pendingMarks.filter((item) => item.day !== date || item.blockStart !== mark.blockStart);
    plan.pendingMarks.push(mark);
    $('block-editor').close();
    markEdited();
  });
  $('block-over').addEventListener('click', () => {
    const { block, target: { date } } = editedBlock;
    $('block-editor').close();
    openRestack(date, block.id);
  });
  $('block-done').addEventListener('click', () => {
    const { copy, block, target: { date, shelf } = {} } = editedBlock;
    removeNote(copy ? editedBlock.entry.id : block.todoId, 'done');
    $('block-editor').close();
    if (!copy && date && shelf) {
      removeFromDay(date, block.id);
      markEdited();
    }
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
  tilesArea.addEventListener('pointerdown', daySwipeDown);
  tilesArea.addEventListener('pointerup', daySwipeUp);
  tilesArea.addEventListener('pointercancel', daySwipeUp);
  tilesArea.addEventListener('click', (event) => {
    // The click that ends a swipe is not a tap on a tile or an empty part of the day.
    if (Date.now() - daySwipedAt < 400) return;
    const timeline = event.target.closest('.timeline');
    // Phones scroll on a drag, so a tap on an empty part of a day adds an item there.
    if (lastPointerType === 'touch' && timeline && !event.target.closest('.tile, .before-wake')) {
      openDraft(timeline.closest('[data-day]').dataset.day, draftStart(timeline, event.clientY, timelineEdges(timeline)));
      return;
    }
    const tile = event.target.closest('.tile[data-id]');
    if (!tile || tile.dataset.dragged || event.detail > 1) return;
    const open = () => {
      const source = blockSource(tile);
      if (tile.dataset.source === 'Todo' && urgentTodos().some((entry) => entry.id === tile.dataset.id)) openPopup(tile.dataset.id);
      else if (source?.block) openBlockEditor(source);
    };
    open();
  });
  window.addEventListener('beforeunload', (event) => {
    flushAutosave(false);
    if (plan && isPlannerDirty()) event.preventDefault();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAutosave(false); });
  window.addEventListener('popstate', (event) => showPlannerScreen(event.state));
  showPlannerScreen(history.state);
  refreshView();
  scrollToNow();
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
