const PLAN_COLOURS = ['#c8efd9', '#ffdcc8', '#e5dcfa', '#fff1ba', '#d5ebff', '#f9d9ea'];
const PLAN_START = 7 * 60;
const PLAN_END = 23 * 60;
const SCREENS_OFF = 22 * 60;
const PLAN_SIZES = [30, 45, 60, 90];
const PLAN_TIERS = ['low', 'medium', 'high', 'must', 'fixed'];

let monday;
let plan;
let activeDrag;
let editedBlock;
let tileClick;

function planMinutes(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? '')) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

function blockDuration(block) {
  return (block.duration ?? block.size) + (block.tail ?? 0);
}

function gapAfter(block) {
  return blockDuration(block) >= 90 ? 15 : 10;
}

function placeBlocks(day, stack) {
  const wake = (planMinutes(day.wake) ?? PLAN_START) + (day.startOffset ?? 0);
  const anchors = stack.flatMap((block) => {
    const start = block.actualStart ?? planMinutes(block.pinned);
    return start === null ? [] : [{ ...block, start, until: block.actualUntil ?? start + blockDuration(block) }];
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
        if (start + duration + gapAfter(block) <= anchor.start) break;
        start = anchor.until + gapAfter(anchor);
      }
      timing = { ...block, start, until: start + duration };
    }
    placed.push(timing);
    cursor = Math.max(cursor, timing.until + gapAfter(timing));
  }
  return placed.sort((a, b) => a.start - b.start);
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
  let stack = day.blocks.filter((block) => !block.shelf);
  const bumped = stack.filter((block) => {
    const pin = planMinutes(block.pinned);
    return block.tier !== 'fixed' && pin !== null && (pin < wake || pin + blockDuration(block) > SCREENS_OFF);
  });
  stack = stack.filter((block) => !bumped.includes(block));
  let blocks = placeBlocks(day, stack);
  while (blocks.some((block) => block.tier !== 'fixed' && block.actualStart == null && block.until > SCREENS_OFF)) {
    const candidates = blocks.filter((block) => block.tier !== 'fixed' && block.actualStart == null);
    const lowest = candidates.reduce((a, b) => PLAN_TIERS.indexOf(a.tier) < PLAN_TIERS.indexOf(b.tier) ? a : b);
    const removed = stack.find((block) => block.id === lowest.id);
    bumped.push(removed);
    stack = stack.filter((block) => block !== removed);
    blocks = placeBlocks(day, stack);
  }
  return { blocks, bumped };
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
  for (const entry of entriesFor(category)) {
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
      pinned: block.end == null ? null : blockKey(block.start),
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
  const schedules = schedulesForWeek(keys);
  const sources = {};
  const days = {};
  for (const date of keys) {
    const schedule = schedules.get(date);
    const day = saved?.value.days?.[date];
    days[date] = Array.isArray(day?.blocks) ? day : dayFromSchedule(schedule);
    sources[date] = Array.isArray(day?.blocks) ? saved.value.sources?.[date] ?? null : schedule?.id ?? null;
  }
  plan = { key, keys, days, sources, schedules, version: saved?.entry.id ?? null, dirtyDays: new Set(),
    tray: Array.isArray(saved?.value.tray?.week) ? saved.value.tray.week : [], trayDirty: false,
    savedDates: new Set(Object.keys(saved?.value.days || {})) };
}

function changedInDash(key, schedules = plan.schedules) {
  return (schedules.get(key)?.id ?? null) !== plan.sources[key];
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
  const schedules = schedulesForWeek(plan.keys);
  const notes = [];
  const days = { ...plan.days };
  const sources = { ...plan.sources };
  for (const key of plan.keys) {
    const entry = schedules.get(key);
    const changed = changedInDash(key, schedules) && (plan.dirtyDays.has(key) || plan.savedDates.has(key));
    if (changed && !confirm(`${dayLabel(key)} changed in Dash. OK keeps the planner version. Cancel uses Dash.`)) {
      days[key] = dayFromSchedule(entry);
    } else if (plan.dirtyDays.has(key) || changed) {
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
  const text = JSON.stringify({ key: plan.key, value: { days, sources, tray: { week: plan.tray } } });
  if (text !== previous?.entry.text) notes.push(plannerEntry(PLAN_WEEK, text, previous?.entry));
  if (localStorage.getItem(STORE_KEY) !== originalStore) {
    $('plan-status').textContent = 'Notes changed while saving. Try again to review the latest versions.';
    return;
  }
  data.entries.push(...notes);
  try {
    if (notes.length) persist();
  } catch {
    reload();
    $('plan-status').textContent = 'Could not save. Device storage is full or unavailable.';
    return;
  }
  const count = notes.filter((entry) => entry.category === SCHEDULE).length;
  plan.dirtyDays.clear();
  plan.trayDirty = false;
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
  const index = plannerGoals().findIndex((entry) => entry.id === goal);
  return index < 0 ? '' : PLAN_COLOURS[index % PLAN_COLOURS.length];
}

function isPlannerDirty() {
  return plan.dirtyDays.size > 0 || plan.trayDirty;
}

function markEdited() {
  $('plan-status').textContent = 'Unsaved planner changes';
  renderPlanner();
}

function editDay(day, blocks) {
  return { ...day, imported: false, blocks: blocks.map(({ importedStart, ...block }) => block) };
}

function untimedBlock(block) {
  const { actualStart, actualUntil, ...untimed } = block;
  return { ...untimed, pinned: null, shelf: true };
}

function storeDay(key, day) {
  const { bumped } = layoutDay(day);
  const bumpedIds = new Set(bumped.map((block) => block.id));
  plan.days[key] = { ...day, blocks: day.blocks.map((block) => bumpedIds.has(block.id)
    ? { ...untimedBlock(block), bumped: true } : block) };
  plan.dirtyDays.add(key);
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
  const changed = { ...old, ...changes, bumped: false };
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
  if (pinCollision(block, blocks)) return 'That time overlaps another pinned block.';
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
  fillOptions(fields.day, plan.keys.map((key) => [key, dayLabel(key)]), date);
  const sizes = PLAN_SIZES.map((size) => [size, `${size} min`]);
  if (block.duration != null) sizes.unshift(['original', `${block.duration} min (original)`]);
  fillOptions(fields.size, sizes, block.duration != null ? 'original' : String(block.size));
  fillOptions(fields.tier, PLAN_TIERS.map((tier) => [tier, tier[0].toUpperCase() + tier.slice(1)]), block.tier);
  const goals = plannerGoals().map((item) => [item.id, bare(item.text)]);
  if (block.goal && !goals.some(([id]) => id === block.goal)) goals.push([block.goal, 'Archived goal']);
  fillOptions(fields.goal, [['', 'No goal'], ...goals], block.goal || '');
  fields.placement.value = source.parked ? 'tray' : block.shelf ? 'shelf' : 'stack';
  fields.pin.checked = Boolean(block.pinned);
  fields.time.value = block.pinned || (source.date ? blockKey(layoutDay(plan.days[source.date]).blocks.find((b) => b.id === block.id)?.start ?? PLAN_START) : '07:00');
  $('block-editor-title').textContent = source.copy || source.fresh ? 'Place block' : 'Edit block';
  $('block-delete').hidden = Boolean(source.copy || source.fresh);
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
  }
  const size = fields.size.value;
  const changes = {
    text, done: fields.done.value.trim(), next: fields.next.value.trim(), goal: fields.goal.value || null,
    tier: fields.tier.value, tail: Number(fields.tail.value), pinned,
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

function renderGoals() {
  const goals = plannerGoals();
  const items = goals.map((entry) => {
    const chip = element('span', 'goal-chip', bare(entry.text));
    chip.style.background = goalColour(entry.id);
    return chip;
  });
  if (!items.length) items.push(element('span', 'muted', 'No Working on notes'));
  $('goals').replaceChildren(element('h3', '', 'Working on'), ...items);
}

function renderTray() {
  const tray = element('aside', 'panel tray');
  tray.dataset.tray = '';
  const copied = new Set(Object.values(plan.days).flatMap((day) => day.blocks.map((block) => block.todoId)));
  for (const [category, title] of [['Todo', 'This week'], [BACK_BURNER, 'Someday']]) {
    tray.append(element('h3', '', title));
    const entries = entriesFor(category);
    if (!entries.length) tray.append(element('p', 'muted', `No ${category} notes`));
    for (const entry of entries) {
      const tile = element('button', 'tile tray-tile', bare(entry.text));
      tile.type = 'button';
      Object.assign(tile.dataset, { id: entry.id, source: category });
      if (copied.has(entry.id)) {
        const clockBadge = element('span', 'copied', ' ◷');
        clockBadge.title = 'Copied to the plan';
        tile.append(clockBadge);
      }
      tray.append(tile);
    }
    if (category === 'Todo') for (const block of plan.tray) {
      const tile = renderTile(block);
      tile.classList.add('tray-tile');
      tile.dataset.source = 'parked';
      tray.append(tile);
    }
  }
  return tray;
}

function renderTile(block, date) {
  const tile = element('button', 'tile');
  tile.type = 'button';
  tile.dataset.id = block.id;
  if (date) tile.dataset.date = date;
  tile.classList.toggle('fixed', block.tier === 'fixed');
  tile.style.setProperty('--tile-colour', goalColour(block.goal) || (block.pinned ? '#fff0d7' : '#edf0f3'));
  tile.append(element('span', 'tile-title', block.text));
  if (block.bumped) tile.append(element('span', 'bumped', ' · Bumped'));
  if (block.pinned) {
    const pin = element('span', 'pin', '📌');
    pin.title = `Pinned at ${block.pinned}`;
    tile.append(pin);
  }
  tile.title = [block.text, block.done && `Done = ${block.done}`, block.next].filter(Boolean).join('\n');
  return tile;
}

function renderDay(key, { blocks, bumped }, from, until) {
  const date = keyDate(key);
  const day = plan.days[key];
  const column = element('article', 'panel day');
  column.dataset.day = key;
  const head = element('header', 'day-head');
  const heading = element('h3', '', date.toLocaleDateString(undefined, { weekday: 'short' }));
  heading.append(element('span', 'day-date', date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
  const info = [day.phoneOff && 'Phone off', day.wake && `Wake ${day.wake}`, day.template].filter(Boolean);
  head.append(heading, element('p', 'day-info', info.join(' · ')));
  if (changedInDash(key)) head.append(element('span', 'warning', 'Changed on phone'));
  const pins = blocks.filter((block) => block.pinned && block.tier === 'fixed');
  if (pins.length) head.append(element('p', 'day-info', `★ ${pins.map((block) => block.pinned).join(' · ')}`));
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
  for (const block of blocks) {
    const tile = renderTile(block, key);
    tile.classList.add('timed');
    tile.style.setProperty('--minute', block.start - from);
    tile.style.setProperty('--duration', block.until - block.start);
    tile.prepend(element('time', 'tile-time', `${blockKey(block.start)}–${blockKey(block.until)}`));
    timeline.append(tile);
  }
  column.append(head, shelf, timeline);
  return column;
}

function renderPlanner() {
  const end = addDays(monday, 6);
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  $('week-range').textContent = formatter.formatRange(monday, end);
  renderGoals();
  const layouts = plan.keys.map((key) => layoutDay(plan.days[key]));
  const all = layouts.flatMap((layout) => layout.blocks);
  const from = Math.floor(Math.min(PLAN_START, ...all.map((b) => b.start)) / 60) * 60;
  const until = Math.ceil(Math.max(PLAN_END, ...all.map((b) => b.until)) / 60) * 60;
  $('week').replaceChildren(renderTray(), ...plan.keys.map((key, i) => renderDay(key, layouts[i], from, until)));
}

function refreshView() {
  if (plan && isPlannerDirty()) plan.schedules = schedulesForWeek(plan.keys);
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
    preview.classList.remove('timed');
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

function startPlanner() {
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
  navigator.serviceWorker?.register('sw.js');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { layoutDay };
if (typeof document !== 'undefined') startPlanner();
