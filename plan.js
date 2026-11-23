const PLAN_COLOURS = ['#c8efd9', '#ffdcc8', '#e5dcfa', '#fff1ba', '#d5ebff', '#f9d9ea'];
const COLOUR_NAMES = ['Mint', 'Peach', 'Lavender', 'Butter yellow', 'Powder blue', 'Pink'];
const BLOCK_KINDS = {
  '': 'Automatic', study: 'Study', project: 'Project / AI tutor', prep: 'Event prep',
  almost: 'Almost done', fun: 'Open-ended fun', free: 'Free', buffer: 'Buffer',
  exercise: 'Exercise', routine: 'Routine', meal: 'Meal', travel: 'Travel', event: 'Fixed event',
};
const FIRST_WEEK_GOALS = { chess: 6, lab: 2, fitness: 6.5, study: 20 };
const PLAN_START = 7 * 60;
const PLAN_END = 23 * 60;
const SCREENS_OFF = 22 * 60;
const PLAN_SIZES = [30, 45, 60, 90];
const PLAN_TIERS = ['low', 'medium', 'high', 'must', 'fixed'];
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
    wake: '09:30', startOffset: 0, deepCap: 2, workCap: 2, noGhosts: true,
    hint: 'Wake at 09:30 and keep it to two work blocks.',
    anchors: [['11:30', 50, 'Lunch + dishes + read', 'meal'], ['12:20', 25, 'Free', 'free'],
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

function planMinutes(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? '')) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

function blockDuration(block) {
  return (block.duration ?? block.size) + (block.tail ?? 0);
}

function gapAfter(block) {
  return (block.duration ?? block.size) >= 90 ? 15 : 10;
}

function placeBlocks(day, stack) {
  const wake = Math.max((planMinutes(day.wake) ?? PLAN_START) + (day.startOffset ?? 0), day.workStart ?? 0);
  const anchors = stack.flatMap((block) => {
    const start = block.actualStart ?? block.restackStart ?? planMinutes(block.pinned);
    return start === null ? [] : [{ ...block, start, until: block.actualUntil ?? block.restackUntil ?? start + blockDuration(block) }];
  }).sort((a, b) => a.start - b.start);
  const byId = new Map(anchors.map((block) => [block.id, block]));
  let cursor = wake;
  const placed = [];
  for (const block of stack) {
    let timing = byId.get(block.id);
    if (!timing) {
      const duration = blockDuration(block);
      let start = Math.max(cursor, block.importedStart ?? 0);
      for (const anchor of anchors) {
        if (start >= anchor.until + gapAfter(anchor)) continue;
        if (start + duration <= anchor.start) break;
        start = anchor.until + gapAfter(anchor);
      }
      timing = { ...block, start, until: start + duration };
    }
    placed.push(timing);
    cursor = Math.max(cursor, timing.until + gapAfter(timing));
    if (timing.actualUntil != null) {
      const fixed = anchors.find((anchor) => anchor.id !== block.id && anchor.tier === 'fixed'
        && anchor.start >= timing.start && anchor.start < timing.until);
      if (fixed) placed[placed.length - 1] = { ...timing, until: fixed.start };
    }
  }
  return placed.filter((block) => block.until > block.start).sort((a, b) => a.start - b.start);
}

// Pinned positions are reservations. Remove the lowest-priority work and lay
// out again until the flexible work fits. Shelf blocks never enter the stack.
function layoutDay(day) {
  if (day.imported) {
    return {
      blocks: day.blocks.filter((b) => !b.shelf).map((b) => ({
        ...b, start: b.importedStart, until: b.importedStart + blockDuration(b),
      })),
      bumped: [],
    };
  }
  const wake = planMinutes(day.wake) ?? PLAN_START;
  const cutoff = day.workEnd ?? SCREENS_OFF;
  let stack = day.blocks.filter((block) => !block.shelf);
  const overruns = stack.filter((block) => block.actualUntil != null);
  const canBump = (block) => block.tier !== 'fixed' && block.actualStart == null && block.restackStart == null;
  const bumped = stack.filter((block) => {
    const pin = planMinutes(block.pinned);
    return canBump(block) && pin !== null && (pin < Math.max(wake, day.workStart ?? 0) ||
      pin + blockDuration(block) > cutoff ||
      overruns.some((actual) => pin < actual.actualUntil && pin + blockDuration(block) > actual.actualStart));
  });
  stack = stack.filter((block) => !bumped.includes(block));
  let blocks = placeBlocks(day, stack);
  for (;;) {
    const future = blocks.filter(canBump);
    const overflow = future.some((block) => block.until > cutoff);
    const work = future.filter(workBlock);
    const pastWork = blocks.filter((block) => !canBump(block) && workBlock(block)).length;
    if (!overflow && (!work.length || work.length + pastWork <= (day.workCap ?? Infinity))) break;
    const candidates = overflow ? future : work;
    const lowest = candidates.reduce((a, b) => PLAN_TIERS.indexOf(a.tier) < PLAN_TIERS.indexOf(b.tier) ? a : b);
    const removed = stack.find((block) => block.id === lowest.id);
    bumped.push(removed);
    stack = stack.filter((block) => block !== removed);
    blocks = placeBlocks(day, stack);
  }
  return { blocks, bumped };
}

function applyOverrun(day, id, endedAt) {
  const layout = layoutDay(day);
  const timed = layout.blocks.find((block) => block.id === id);
  if (!timed || endedAt <= timed.start) return null;
  const before = layout.blocks.filter((block) => block.start < timed.start);
  const locked = new Map(before.map((block) => [block.id, block]));
  const blocks = day.blocks.map((block) => {
    if (block.id === id) return { ...block, actualStart: timed.start, actualUntil: endedAt };
    const previous = locked.get(block.id);
    if (!previous || block.pinned || block.actualStart != null) return block;
    return { ...block, restackStart: previous.start, restackUntil: previous.until };
  });
  const starts = new Map(layout.blocks.map((block) => [block.id, block.start]));
  blocks.sort((a, b) => (starts.get(a.id) ?? Infinity) - (starts.get(b.id) ?? Infinity));
  return { day: editDay(day, blocks, true), timed };
}

function weekMonday(date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}

function weekKey(start) {
  const thursday = addDays(start, 3);
  const year = thursday.getFullYear();
  const first = weekMonday(new Date(year, 0, 4));
  const number = Math.round((start - first) / (7 * 864e5)) + 1;
  return `${year}-W${String(number).padStart(2, '0')}`;
}

function plannerNote(category, key) {
  const versions = entriesFor(category).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  for (const entry of versions) {
    try {
      const note = JSON.parse(entry.text);
      if (note?.key === key && note.value && typeof note.value === 'object') return { entry, value: note.value };
    } catch {
      // Ignore a malformed version and look for the previous saved note.
    }
  }
  return null;
}

function emptyDay() {
  return { template: '', phoneOff: false, wake: '07:00', blocks: [] };
}

function planBlock(id, text, fields = {}) {
  return { id, text, size: 45, shelf: false, goal: null, tier: 'medium', pinned: null,
    todoId: null, tail: 0, done: '', next: '', ...fields };
}

function dayFromSchedule(entry) {
  const day = emptyDay();
  if (!entry) return day;
  const parsed = parseSchedule(entry.text);
  day.imported = true;
  day.blocks = parsed.intro.map((line, i) => planBlock(`${entry.id}-s${i}`, line, { shelf: true }));
  for (const [i, block] of parsed.blocks.entries()) {
    const [line, ...more] = block.lines;
    const [, title, done] = /^(.*?)\s*\(done = (.*)\)$/.exec(line) || [];
    day.blocks.push(planBlock(`${entry.id}-b${i}`, (title ?? line) || 'Untitled block', {
      duration: block.until > block.start ? (block.end == null ? Math.min(45, block.until - block.start) : block.until - block.start) : 45,
      importedStart: block.start,
      done: done || '',
      next: more.join('\n'),
    }));
  }
  return day;
}

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
    if (day?.imported && Array.isArray(day.blocks) && day.blocks.some((block) => block.pinned)) {
      days[date] = { ...day, blocks: day.blocks.map((block) => ({ ...block, pinned: null })) };
    }
    sources[date] = Array.isArray(day?.blocks) ? saved.value.sources?.[date] ?? null : schedule?.id ?? null;
  }
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

function getTemplate(name) {
  return plannerNote(PLAN_TEMPLATE, name)?.value ?? TEMPLATES[name];
}

// Prevent prose containing “, 10:30” from being read as a second block.
function scheduleProse(text) {
  return text.replace(/([,;]\s+)(?=\d)/g, '$1\u2060');
}

function scheduleNoteLine(text, label) {
  const line = bare(text);
  return scheduleProse(readTime(line) || dayWord(line) ? `${label} · ${line}` : line);
}

function scheduleText(key, day) {
  const { blocks, bumped } = layoutDay(day);
  const untimed = [...day.blocks.filter((block) => block.shelf), ...bumped];
  const lines = [datedScheduleHeading(key)];
  for (const block of untimed) {
    const text = block.done ? `${block.text} (done = ${block.done})` : block.text;
    lines.push(scheduleNoteLine(text, 'Untimed'));
  }
  for (const block of blocks) {
    const text = block.done ? `${block.text} (done = ${block.done})` : block.text;
    lines.push(`${blockKey(block.start)}-${blockKey(block.until)} ${scheduleProse(text)}`);
    for (const line of (block.next || '').split('\n').filter((line) => line.trim())) lines.push(scheduleNoteLine(line, 'Next'));
  }
  return lines.join('\n');
}

function plannerEntry(category, text, previous) {
  const createdAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString();
  return { id: newId(), category, text, createdAt, updatedAt: createdAt, deletedAt: null, dirty: true };
}

function saveWeek() {
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
  for (const key of plan.keys) {
    const entry = schedules.get(key);
    const changed = changedInDash(key, schedules) && (plan.dirtyDays.has(key) || plan.savedDates.has(key));
    if (changed && !confirm(`${dayLabel(key)} changed in Dash. OK keeps the planner version. Cancel uses Dash.`)) {
      days[key] = { ...dayFromSchedule(entry), phoneOff: days[key].phoneOff };
      dashDays.add(key);
    } else if (plan.scheduleDirty.has(key) || changed) {
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
    } else if (changedInDash(key, schedules)) {
      days[key] = dayFromSchedule(entry);
    }
    sources[key] = entry?.id ?? null;
  }
  const marks = plan.pendingMarks.filter((mark) => !dashDays.has(mark.day));
  const text = JSON.stringify({ key: plan.key, value: { days, sources, tray: { week: plan.tray } } });
  if (text !== previous?.entry.text) notes.push(plannerEntry(PLAN_WEEK, text, previous?.entry));
  if (plan.goalsDirty) {
    const text = JSON.stringify({ key: plan.key, value: plan.budgets });
    if (text !== goalVersion?.entry.text) notes.push(plannerEntry(PLAN_GOALS, text, goalVersion?.entry));
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
  plan.dirtyDays.clear();
  plan.scheduleDirty.clear();
  plan.trayDirty = false;
  plan.goalsDirty = false;
  plan.pendingMarks = [];
  refreshView();
  $('plan-status').textContent = count ? `Saved ${count} ${count === 1 ? 'day' : 'days'} to Dash.` : 'Week saved. No Schedule changes.';
  sync();
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

function markEdited() {
  $('plan-status').textContent = 'Unsaved planner changes';
  renderPlanner();
}

function editDay(day, blocks, preservePrefix = false) {
  return {
    ...day, imported: false,
    blocks: blocks.map(({ importedStart, restackStart, restackUntil, ...block }) => preservePrefix
      ? { ...block, restackStart, restackUntil } : block),
  };
}

function untimedBlock(block) {
  const { actualStart, actualUntil, restackStart, restackUntil, ...untimed } = block;
  return { ...untimed, pinned: null, shelf: true };
}

function storeDay(key, day) {
  const { bumped } = layoutDay(day);
  const bumpedIds = new Set(bumped.map((block) => block.id));
  const now = new Date();
  const today = dayKey(now);
  const ended = key < today || key === today && now.getHours() >= 22;
  const blocks = [];
  for (const block of day.blocks) {
    if (!bumpedIds.has(block.id)) blocks.push(block);
    else if (!ended) blocks.push({ ...untimedBlock(block), bumped: true });
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
  if (source === 'parked') return { parked: true, block: plan.tray.find((block) => block.id === id) };
  const entry = entriesFor(source).find((item) => item.id === id);
  if (!entry) return null;
  const text = bare(entry.text).replace(/\s+/g, ' ');
  const size = Number(/\b(30|45|60|90)\s*m(?:in)?\b/i.exec(text)?.[1]) || 45;
  return { copy: true, block: planBlock(newId(), text, { todoId: id, size }) };
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

// Build the replacement stacks before changing either day.
function moveBlock(source, target, changes = {}) {
  if (!source?.block) return 'That block is no longer available.';
  if (source.copy && !target.date) return '';
  const old = source.block;
  const changed = { ...old, ...changes, bumped: false, bumpedFrom: undefined };
  const origin = source.date && plan.days[source.date];
  const remaining = origin?.blocks.filter((block) => block.id !== old.id);
  if (!target.date) {
    const liveTodo = old.todoId && ['Todo', BACK_BURNER].some((cat) => entriesFor(cat).some((note) => note.id === old.todoId));
    if (origin) storeDay(source.date, editDay(origin, remaining));
    plan.tray = plan.tray.filter((block) => block.id !== old.id);
    if (!liveTodo || source.parked) plan.tray.push(untimedBlock(changed));
    plan.trayDirty = true;
    markEdited();
    return '';
  }
  const day = plan.days[target.date];
  const blocks = source.date === target.date ? remaining : [...day.blocks];
  let block = target.shelf ? untimedBlock(changed) : { ...changed, shelf: false };
  if (!target.shelf && Object.hasOwn(target, 'pinned')) {
    const { actualStart, actualUntil, ...unpinned } = block;
    block = { ...unpinned, pinned: target.pinned };
  }
  const pin = planMinutes(block.pinned);
  if (pin != null && pin + blockDuration(block) > DAY_END) return 'Choose a time that ends by midnight.';
  if (!(source.date === target.date && block.actualStart != null && !Object.hasOwn(target, 'pinned')) && pinCollision(block, blocks)) {
    return 'That time overlaps another pinned block.';
  }
  const at = blocks.findIndex((item) => item.id === target.before);
  blocks.splice(at < 0 ? blocks.length : at, 0, block);
  if (origin && source.date !== target.date) storeDay(source.date, editDay(origin, remaining));
  if (source.parked) {
    plan.tray = plan.tray.filter((item) => item.id !== old.id);
    plan.trayDirty = true;
  }
  storeDay(target.date, editDay(day, blocks));
  markEdited();
  return '';
}

function deleteBlock(source) {
  if (!source?.block || source.copy) return;
  if (source.date) {
    const day = plan.days[source.date];
    storeDay(source.date, editDay(day, day.blocks.filter((block) => block.id !== source.block.id)));
  } else {
    plan.tray = plan.tray.filter((block) => block.id !== source.block.id);
    plan.trayDirty = true;
  }
  markEdited();
}

function fillOptions(select, items, value) {
  select.replaceChildren(...items.map(([id, label]) => new Option(label, id)));
  select.value = value;
}

function openBlockEditor(source, date) {
  editedBlock = source;
  const block = source.block;
  const fields = $('block-form').elements;
  fields.text.value = block.text;
  fields.done.value = block.done;
  fields.next.value = block.next;
  fields.tail.value = block.tail;
  fields.deadline.value = block.deadline || '';
  fillOptions(fields.kind, Object.entries(BLOCK_KINDS), block.kind || '');
  fillOptions(fields.day, plan.keys.map((key) => [key, dayLabel(key)]), date);
  const sizes = PLAN_SIZES.map((size) => [size, `${size} min`]);
  if (block.duration != null) sizes.unshift(['original', `${block.duration} min (original)`]);
  fillOptions(fields.size, sizes, block.duration != null ? 'original' : String(block.size));
  const weekend = [0, 6].includes(keyDate(date).getDay());
  const tier = weekend && (source.fresh || source.copy) ? 'must' : block.tier;
  fillOptions(fields.tier, PLAN_TIERS.map((key) => [key, key[0].toUpperCase() + key.slice(1)]), tier);
  const goals = plannerGoals().map((item) => [item.id, bare(item.text)]);
  if (block.goal && !goals.some(([id]) => id === block.goal)) goals.push([block.goal, 'Archived goal']);
  fillOptions(fields.goal, [['', 'No goal'], ...goals], block.goal || '');
  fields.placement.value = source.date && block.shelf ? 'shelf' : 'stack';
  fields.pin.checked = Boolean(block.pinned);
  fields.time.value = block.pinned || (source.date ? blockKey(layoutDay(plan.days[source.date]).blocks.find((b) => b.id === block.id)?.start ?? PLAN_START) : '07:00');
  $('block-editor-title').textContent = source.date && !source.fresh ? 'Edit block' : 'Place block';
  $('block-delete').hidden = Boolean(source.copy || source.fresh);
  $('block-over').hidden = !source.date || block.shelf;
  $('block-error').hidden = true;
  updateEditorFields();
  $('block-editor').showModal();
}

function updateEditorFields() {
  const fields = $('block-form').elements;
  fields.day.disabled = fields.placement.value === 'tray';
  fields.pin.disabled = fields.placement.value !== 'stack';
  fields.time.disabled = fields.pin.disabled || !fields.pin.checked;
  fields.time.required = !fields.time.disabled;
}

function applyBlockEditor(event) {
  event.preventDefault();
  const fields = event.target.elements;
  const text = fields.text.value.trim();
  if (!text) return;
  const date = fields.placement.value === 'tray' ? null : fields.day.value;
  const shelf = fields.placement.value === 'shelf';
  const original = editedBlock.block;
  const pinned = fields.time.disabled ? null : fields.time.value;
  const day = plan.days[date];
  const oldIndex = day?.blocks.findIndex((block) => block.id === original.id) ?? -1;
  const next = oldIndex < 0 ? undefined : day.blocks[oldIndex + 1]?.id;
  let before = next;
  if (date && !shelf && pinned && (pinned !== original.pinned || oldIndex < 0)) {
    before = layoutDay(day).blocks.find((b) => b.id !== original.id && b.start >= planMinutes(pinned))?.id;
  } else if (date && !shelf && (oldIndex < 0 || original.shelf)) {
    const stack = layoutDay(day).blocks;
    const cutoff = Math.max(day.workEnd ?? 17 * 60, day.workStart ?? 0);
    before = stack.find((b) => b.pinned && b.start >= cutoff)?.id;
  }
  const size = fields.size.value;
  const changes = {
    text, done: fields.done.value.trim(), next: fields.next.value.trim(), goal: fields.goal.value || null,
    tier: fields.tier.value, tail: Number(fields.tail.value), pinned,
    kind: fields.kind.value || undefined, deadline: fields.deadline.value || undefined,
    ...size === 'original' ? {} : { size: Number(size), duration: undefined },
  };
  const target = { date, shelf, before };
  if (date && (date !== editedBlock.date || pinned !== original.pinned || size !== 'original' && Number(size) !== original.size)) target.pinned = pinned;
  const error = moveBlock(editedBlock, target, changes);
  if (error) {
    $('block-error').textContent = error;
    $('block-error').hidden = false;
  } else {
    $('block-editor').close();
  }
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

function openTemplateEditor(key) {
  templateDate = key;
  const day = plan.days[key];
  const fields = $('template-form').elements;
  const name = day.template || (recoverySuggested(key) ? 'Recovery / social' : keyDate(key).getDay() === 0 ? 'Welding Sunday' : 'Weekday');
  fillOptions(fields.template, [['', 'No template'], ...Object.keys(TEMPLATES).map((key) => [key, key])], name);
  const event = day.blocks.find((block) => block.templateAnchor && block.kind === 'event');
  fields.event.value = event?.text || '';
  fields.start.value = event?.pinned || '';
  fillOptions(fields.duration, PLAN_SIZES.map((size) => [size, `${size} min`]), String(event?.duration || 60));
  $('template-error').hidden = true;
  updateTemplateFields();
  $('template-editor').showModal();
}

function updateTemplateFields() {
  const fields = $('template-form').elements;
  const template = getTemplate(fields.template.value);
  const needsEvent = Boolean(template?.event);
  $('event-fields').hidden = !needsEvent;
  for (const field of [fields.event, fields.start, fields.duration]) {
    field.disabled = !needsEvent;
    field.required = needsEvent;
  }
  $('template-note').textContent = template?.hint || (fields.template.value ? '' : 'Remove the template anchors and keep your blocks.');
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

function blockKind(block) {
  if (block.kind) return block.kind;
  const text = block.text || '';
  if (/\b(ai[- ]tutor|project)\b/i.test(text)) return 'project';
  if (/\b(prep|settle)\b/i.test(text)) return 'prep';
  if (/\b(study|recall|revise|review notes|lab)\b/i.test(text)) return 'study';
  if (/\b(lunch|dinner|meal)\b/i.test(text)) return 'meal';
  if (/^free\b/i.test(text)) return 'free';
  if (/^buffer\b/i.test(text)) return 'buffer';
  return '';
}

function blockColour(block) {
  const kind = blockKind(block);
  const text = block.text || '';
  const studyCue = /\b(?:(?:ece|csc|mat|sta|phy|chm|bio)\s?[1-4]\d{2}|(?:practice|past) (?:exam|midterm)|exam prep|problem set)\b/i;
  const routineCue = /^(?:wake|breakfast|walk outside|nap|screens off|wind down|bedtime|shower)\b/i;
  if (kind === 'study' || (!block.kind && studyCue.test(text))) return '#e7ddfa';
  if (kind === 'routine' || kind === 'meal' || (!block.kind && routineCue.test(text))) return '#fbe5d5';
  if (kind === 'free' || kind === 'buffer') return '#e9f6e6';
  return goalColour(block.goal) || '#f6f8fa';
}

function workBlock(block) {
  return block.tier !== 'fixed' && !['free', 'buffer', 'meal', 'routine', 'exercise', 'travel', 'event'].includes(blockKind(block));
}

function dayLoad(day, blocks) {
  const start = Math.max((planMinutes(day.wake) ?? PLAN_START) + (day.startOffset ?? 0), day.workStart ?? 0);
  const end = day.workEnd ?? SCREENS_OFF;
  const excluded = [];
  let placed = 0;
  for (const [i, block] of blocks.entries()) {
    const from = Math.max(start, block.start);
    const until = Math.min(end, block.until);
    const work = workBlock(block);
    if (!work && until > from) excluded.push([from, until]);
    if (work && until > from) {
      const tailStart = Math.max(from, Math.min(until, block.until - (block.tail ?? 0)));
      placed += tailStart - from;
      if (tailStart < until) excluded.push([tailStart, until]);
    }
    const gapUntil = Math.min(block.until + gapAfter(block), blocks[i + 1]?.start ?? end, end);
    if (gapUntil > until && gapUntil > start) excluded.push([Math.max(start, until), gapUntil]);
  }
  let cursor = start;
  let unavailable = 0;
  for (const [from, until] of excluded.sort((a, b) => a[0] - b[0])) {
    unavailable += Math.max(0, until - Math.max(from, cursor));
    cursor = Math.max(cursor, until);
  }
  const usable = Math.max(0, end - start - unavailable);
  return { usable, placed, ratio: usable ? placed / usable : placed ? 1 : 0 };
}

function afterDeadline(key, block) {
  const until = `${key}T${blockKey(block.until)}`;
  return Boolean(block.deadline && until > block.deadline);
}

function dayWarnings(key, day, blocks) {
  const warnings = new Set();
  const work = blocks.filter(workBlock);
  const cap = day.deepCap ?? 4;
  if (work.filter((b) => ['high', 'must'].includes(b.tier)).length > cap) warnings.add(`More than ${cap} deep blocks`);
  if (work.length && !blocks.some((b) => ['free', 'buffer'].includes(blockKind(b)))) warnings.add('No free time or buffer');
  if (work.length && blocks.filter((b) => blockKind(b) === 'buffer').reduce((sum, b) => sum + b.until - b.start, 0) < 45) {
    warnings.add('Less than 45m of buffer');
  }
  const tomorrow = dayKey(addDays(keyDate(key), 1));
  const nextDay = plan.days[tomorrow];
  const examTomorrow = nextDay?.template === 'Exam / interview';
  const cutoff = day.noNewAfter ?? (examTomorrow ? 16 * 60 : Infinity);
  const dinner = blocks.find((b) => blockKind(b) === 'meal' && b.start >= 16 * 60);
  const project = work.find((b) => blockKind(b) === 'project');
  for (const [i, block] of blocks.entries()) {
    const next = blocks[i + 1];
    const kind = blockKind(block);
    if (next && next.start - block.until < 5 && !(next.templateAnchor && block.templateAnchor && next.start === block.until)) {
      warnings.add(next.start < block.until ? 'Overlapping pins' : 'Gap under 5m');
    }
    if (block.actualUntil > block.until) warnings.add('Ran into a fixed time');
    if (kind === 'project' && (!next || (blockKind(next) !== 'meal' && !next.pinned))) warnings.add('Project needs a meal or anchor after it');
    if (kind === 'project' && next && blockKind(next) === 'study') warnings.add('Put study before project work');
    if (kind === 'prep' && project && block.start > project.start && (block.deadline?.startsWith(tomorrow) || examTomorrow)) {
      warnings.add('Put next-day prep before project work');
    }
    if (kind === 'almost' && next?.tier !== 'fixed') warnings.add('Put almost-done work before a fixed block');
    if (kind === 'fun' && (!next || (dinner && block.start >= dinner.start))) warnings.add('Put open-ended fun before dinner');
    if (kind === 'study' && block.until > cutoff && !/\b(recall|review|warm[- ]?up|revise|revision)\b/i.test(block.text)) {
      warnings.add('Use light recall before the exam or interview');
    }
    if (afterDeadline(key, block)) warnings.add('Block scheduled after its deadline');
    if (block.deadline?.startsWith(tomorrow) && work.includes(block) && work[0] !== block) warnings.add('Put tomorrow’s deliverable first');
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
    const fixed = new Map(layoutDay(day).blocks.filter((block) => block.tier === 'fixed' && !block.pinned)
      .map((block) => [block.id, block]));
    const blocks = day.blocks.map((block) => {
      const previous = fixed.get(block.id);
      return { ...block, restackStart: previous?.start, restackUntil: previous?.until };
    });
    storeDay(key, editDay({ ...day, wake: time }, blocks, true));
  } else {
    const result = applyOverrun(day, id, planMinutes(time));
    if (!result) {
      $('restack-error').textContent = 'Choose an end time after the block started.';
      $('restack-error').hidden = false;
      return;
    }
    storeDay(key, result.day);
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
    const minutes = blocks.filter((block) => block.goal === entry.id)
      .reduce((sum, block) => sum + Math.max(0, block.until - block.start - (block.tail ?? 0)), 0);
    const budget = goalHours(entry);
    const chip = plannerButton('', () => openGoalEditor(entry), 'goal-chip');
    const colour = goalColour(entry.id);
    chip.style.background = colour;
    chip.append(element('strong', '', bare(entry.text)), element('span', 'goal-hours', budget == null
      ? hoursText(minutes) : `${hoursText(minutes)} / ${budget}h`));
    if (budget != null) chip.append(meter(budget ? minutes / (budget * 60) : Number(minutes > 0), 'Goal progress'));
    chip.classList.toggle('over-budget', budget != null && minutes > budget * 60);
    return chip;
  });
  if (!items.length) items.push(element('span', 'muted', 'No Working on notes'));
  const placed = loads.reduce((sum, load) => sum + load.placed, 0);
  const usable = loads.reduce((sum, load) => sum + load.usable, 0);
  $('goals').replaceChildren(element('h3', '', 'Working on'), ...items,
    element('span', 'week-load', `${hoursText(placed)} placed / ${hoursText(usable)} usable`));
}

function renderTray() {
  const tray = element('aside', 'panel tray');
  tray.dataset.tray = '';
  tray.append(element('h3', '', 'This week'),
    element('p', 'muted tray-hint', 'Drag into a day or tap a task to pick a day.'));
  const someday = element('details', 'someday');
  someday.open = $('week').querySelector('.someday')?.open ?? false;
  someday.append(element('summary', '', 'Someday'));
  const copied = new Set(Object.values(plan.days).flatMap((day) => day.blocks.map((block) => block.todoId)));
  for (const [category, section] of [['Todo', tray], [BACK_BURNER, someday]]) {
    const entries = entriesFor(category);
    if (!entries.length) section.append(element('p', 'muted', `No ${category} notes`));
    for (const entry of entries) {
      const text = bare(entry.text);
      const tile = element('button', 'tile tray-tile', text);
      tile.type = 'button';
      tile.style.setProperty('--tile-colour', blockColour({ text }));
      Object.assign(tile.dataset, { id: entry.id, source: category });
      if (copied.has(entry.id)) {
        const clockBadge = element('span', 'copied', ' ◷');
        clockBadge.title = 'Copied to the plan';
        tile.append(clockBadge);
      }
      section.append(tile);
    }
  }
  for (const block of plan.tray) {
    const tile = renderTile(block);
    tile.classList.add('tray-tile');
    tile.dataset.source = 'parked';
    tray.append(tile);
  }
  tray.append(someday);
  return tray;
}

function renderTile(block, date) {
  const tile = element('button', 'tile');
  tile.type = 'button';
  tile.dataset.id = block.id;
  if (date) tile.dataset.date = date;
  tile.classList.toggle('fixed', block.tier === 'fixed');
  tile.style.setProperty('--tile-colour', blockColour(block));
  tile.append(element('span', 'tile-title', block.text));
  if (block.bumped) tile.append(element('span', 'bumped', block.bumpedFrom ? ` · Bumped from ${dayLabel(block.bumpedFrom, false)}` : ' · Bumped'));
  if (planMinutes(block.pinned) != null) {
    const pin = element('span', 'pin', '📌');
    pin.title = `Pinned at ${block.pinned}`;
    tile.append(pin);
  }
  tile.title = [block.text, block.done && `Done = ${block.done}`, block.next,
    block.actualUntil != null && `Ran over until ${blockKey(block.actualUntil)}`].filter(Boolean).join('\n');
  return tile;
}

function renderDay(key, { blocks, bumped }, load, from, until) {
  const date = keyDate(key);
  const day = plan.days[key];
  const column = element('article', 'panel day');
  column.dataset.day = key;
  const head = element('header', 'day-head');
  const heading = element('h3', '', date.toLocaleDateString(undefined, { weekday: 'short' }));
  heading.append(element('span', 'day-date', date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
  const info = [day.wake && `Wake ${day.wake}`, day.template].filter(Boolean);
  head.append(heading, element('p', 'day-info', info.join(' · ')));
  if (changedInDash(key)) head.append(element('span', 'warning', 'Changed on phone'));
  const events = blocks.filter((block) => block.pinned && (block.kind === 'event' || block.tier === 'fixed' && !block.templateAnchor));
  for (const event of events) head.append(element('p', 'day-info day-event', `★ ${event.pinned} ${event.text}`));
  const dayActions = element('div', 'day-actions');
  const phone = plannerButton(day.phoneOff ? 'Phone off' : 'Phone on', () => {
    plan.days[key] = { ...plan.days[key], phoneOff: !plan.days[key].phoneOff };
    plan.dirtyDays.add(key);
    markEdited();
  }, 'day-action');
  phone.setAttribute('aria-pressed', String(Boolean(day.phoneOff)));
  const template = plannerButton(recoverySuggested(key) && !day.template ? 'Recovery?' : 'Template', () => openTemplateEditor(key), 'day-action');
  dayActions.append(template, phone, plannerButton('Woke at…', () => openRestack(key), 'day-action'));
  head.append(dayActions);
  const shelf = element('div', 'shelf');
  shelf.dataset.shelf = '';
  shelf.append(element('h4', 'shelf-title', 'Untimed'));
  for (const block of day.blocks.filter((block) => block.shelf)) shelf.append(renderTile(block, key));
  for (const block of bumped) {
    const tile = renderTile(block);
    tile.append(element('span', 'bumped', ' · Bumped'));
    shelf.append(tile);
  }
  const timeline = element('div', 'timeline');
  timeline.dataset.from = from;
  timeline.dataset.until = until;
  const add = plannerButton('+', () => openBlockEditor({ fresh: true, block: planBlock(newId(), '') }, key), 'day-add');
  add.setAttribute('aria-label', `Add a block for ${dayLabel(key)}`);
  shelf.append(add);
  timeline.style.setProperty('--minutes', until - from);
  for (let hour = from; hour < until; hour += 60) {
    const line = element('span', 'hour', blockKey(hour));
    line.style.setProperty('--minute', hour - from);
    timeline.append(line);
  }
  for (const [i, block] of blocks.entries()) {
    const tile = renderTile(block, key);
    tile.classList.add('timed');
    tile.classList.toggle('late', afterDeadline(key, block));
    tile.style.setProperty('--minute', block.start - from);
    tile.style.setProperty('--duration', block.until - block.start);
    const start = blockKey(block.start);
    const end = `–${blockKey(block.until)}`;
    const time = element('time', 'tile-time', start);
    time.append(element('span', 'tile-end', end));
    if (block.actualUntil != null) time.append(element('span', 'over-badge', '↗'));
    const label = element('span', 'timed-label');
    label.append(time, tile.firstElementChild);
    tile.prepend(label);
    tile.title = `${start}${end}\n${tile.title}`;
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
  const layouts = plan.keys.map((key) => layoutDay(plan.days[key]));
  const loads = layouts.map((layout, i) => dayLoad(plan.days[plan.keys[i]], layout.blocks));
  renderGoals(layouts, loads);
  const all = layouts.flatMap((layout) => layout.blocks);
  const from = Math.floor(Math.min(PLAN_START, ...all.map((b) => b.start)) / 60) * 60;
  const until = Math.ceil(Math.max(PLAN_END, ...all.map((b) => b.until)) / 60) * 60;
  $('week').replaceChildren(renderTray(), ...plan.keys.map((key, i) => renderDay(key, layouts[i], loads[i], from, until)));
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
  const day = under?.closest('[data-day]');
  if (!day) {
    const tray = under?.closest('[data-tray]');
    return tray && !source.copy ? { indicator: tray } : null;
  }
  const date = day.dataset.day;
  const shelf = under.closest('[data-shelf]');
  const timeline = under.closest('.timeline');
  if (!shelf && !timeline) return null;
  const tile = under.closest('.tile[data-id]');
  if (tile && date === source.date && tile.dataset.id === source.block.id) return null;
  if (shelf) return { date, shelf: true, before: tile?.dataset.id, indicator: shelf };
  const stack = layoutDay(plan.days[date]).blocks;
  if (tile) {
    const index = stack.findIndex((block) => block.id === tile.dataset.id);
    const rect = tile.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const next = stack.slice(index + Number(after)).find((block) => block.id !== source.block.id);
    return { date, before: next?.id, pinned: null, indicator: tile, after };
  }
  const rect = timeline.getBoundingClientRect();
  const from = Number(timeline.dataset.from);
  const until = Number(timeline.dataset.until);
  const scale = (rect.height - 8) / (until - from);
  const time = Math.max(from, Math.min(1435, from + 5 * Math.round((event.clientY - rect.top) / scale / 5)));
  const before = stack.find((block) => block.start >= time && block.id !== source.block.id);
  return { date, pinned: blockKey(time), before: before?.id, time, indicator: timeline };
}

function showDropTarget(target) {
  const last = activeDrag.target?.indicator;
  last?.classList.remove('drop-target', 'drop-after');
  const indicator = target?.indicator;
  indicator?.classList.add('drop-target');
  if (target?.after) indicator.classList.add('drop-after');
  if (target?.time != null) indicator.style.setProperty('--drop-minute', target.time - Number(indicator.dataset.from));
  activeDrag.target = target;
}

function startDrag(event) {
  if (event.button !== 0 || activeDrag) return;
  const tile = event.target.closest('.tile[data-id]');
  if (!tile) return;
  const source = blockSource(tile);
  if (!source?.block) return;
  activeDrag = { tile, source, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
}

function moveDrag(event) {
  if (activeDrag?.pointer !== event.pointerId) return;
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
  const board = document.querySelector('.board-scroll');
  const bounds = board.getBoundingClientRect();
  const point = activeDrag.position;
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
  const { tile, source, moved, target, preview } = activeDrag;
  showDropTarget(null);
  activeDrag = null;
  preview?.remove();
  tile.classList.remove('dragging');
  if (!moved || event.type !== 'pointerup') return;
  tile.dataset.dragged = 'true';
  setTimeout(() => delete tile.dataset.dragged, 0);
  const error = target && moveBlock(source, target);
  if (!target || error) {
    tile.classList.add('invalid-drop');
    tile.addEventListener('animationend', () => tile.classList.remove('invalid-drop'), { once: true });
    if (error) $('plan-status').textContent = error;
  }
}

function changePlannerWeek(next) {
  if (dayKey(next) === dayKey(monday)) return;
  if (isPlannerDirty() && !confirm('Leave this week and discard unsaved changes?')) return;
  monday = next;
  plan = null;
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
  monday = weekMonday(new Date());
  $('login-back').addEventListener('click', () => history.back());
  $('week-prev').addEventListener('click', () => changePlannerWeek(addDays(monday, -7)));
  $('week-next').addEventListener('click', () => changePlannerWeek(addDays(monday, 7)));
  $('week-today').addEventListener('click', () => changePlannerWeek(weekMonday(new Date())));
  $('save-week').addEventListener('click', saveWeek);
  $('block-form').addEventListener('submit', applyBlockEditor);
  $('block-form').addEventListener('change', updateEditorFields);
  $('block-cancel').addEventListener('click', () => $('block-editor').close());
  $('block-delete').addEventListener('click', () => { deleteBlock(editedBlock); $('block-editor').close(); });
  $('block-over').addEventListener('click', () => {
    $('block-editor').close();
    openRestack(editedBlock.date, editedBlock.block.id);
  });
  $('template-form').addEventListener('submit', applyTemplateEditor);
  $('template-form').addEventListener('change', updateTemplateFields);
  $('template-cancel').addEventListener('click', () => $('template-editor').close());
  $('goal-form').addEventListener('submit', applyGoalEditor);
  $('goal-cancel').addEventListener('click', () => $('goal-editor').close());
  $('restack-form').addEventListener('submit', applyRestack);
  $('restack-cancel').addEventListener('click', () => $('restack-editor').close());
  $('week').addEventListener('pointerdown', startDrag);
  window.addEventListener('pointermove', moveDrag, { passive: false });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  $('week').addEventListener('click', (event) => {
    const tile = event.target.closest('.tile[data-id]');
    if (!tile || tile.dataset.dragged || event.detail > 1) return;
    const open = () => {
      const source = blockSource(tile);
      if (source?.block) openBlockEditor(source, source.date || (plan.keys.includes(dayKey(new Date())) ? dayKey(new Date()) : plan.keys[0]));
    };
    if (event.detail === 0) open();
    else tileClick = setTimeout(open, 260);
  });
  $('week').addEventListener('dblclick', (event) => {
    const tile = event.target.closest('.tile[data-id]');
    if (!tile) return;
    clearTimeout(tileClick);
    if ($('block-editor').open) $('block-editor').close();
    deleteBlock(blockSource(tile));
  });
  window.addEventListener('beforeunload', (event) => {
    if (isPlannerDirty()) event.preventDefault();
  });
  window.addEventListener('popstate', (event) => showPlannerScreen(event.state));
  showPlannerScreen(history.state);
  refreshView();
  showStatus();
  sync();
  navigator.storage?.persist?.();
}

if (typeof module !== 'undefined' && module.exports) module.exports = { layoutDay, applyOverrun, dayLoad };
if (typeof document !== 'undefined') startPlanner();
