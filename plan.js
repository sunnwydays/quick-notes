const PLAN_COLOURS = ['#c8efd9', '#ffdcc8', '#e5dcfa', '#fff1ba', '#d5ebff', '#f9d9ea'];
const PLAN_START = 7 * 60;
const PLAN_END = 23 * 60;
const SCREENS_OFF = 22 * 60;
const PLAN_SIZES = [30, 45, 60, 90];
const PLAN_TIERS = ['low', 'medium', 'high', 'must', 'fixed'];

let monday;
let plan;

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
  const text = JSON.stringify({ key: plan.key, value: { days, sources } });
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
  const copied = new Set(Object.values(plan.days).flatMap((day) => day.blocks.map((block) => block.todoId)));
  for (const [category, title] of [['Todo', 'This week'], [BACK_BURNER, 'Someday']]) {
    tray.append(element('h3', '', title));
    const entries = entriesFor(category);
    if (!entries.length) tray.append(element('p', 'muted', `No ${category} notes`));
    for (const entry of entries) {
      const tile = element('div', 'tile tray-tile', bare(entry.text));
      if (copied.has(entry.id)) tile.append(element('span', 'copied', ' ◷'));
      tray.append(tile);
    }
  }
  return tray;
}

function renderTile(block) {
  const tile = element('div', 'tile');
  tile.classList.toggle('fixed', block.tier === 'fixed');
  tile.style.setProperty('--tile-colour', goalColour(block.goal) || (block.pinned ? '#fff0d7' : '#edf0f3'));
  tile.append(element('span', 'tile-title', block.text));
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
  const head = element('header', 'day-head');
  const heading = element('h3', '', date.toLocaleDateString(undefined, { weekday: 'short' }));
  heading.append(element('span', 'day-date', date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
  const info = [day.phoneOff && 'Phone off', day.wake && `Wake ${day.wake}`, day.template].filter(Boolean);
  head.append(heading, element('p', 'day-info', info.join(' · ')));
  if (changedInDash(key)) head.append(element('span', 'warning', 'Changed on phone'));
  const pins = blocks.filter((block) => block.pinned && block.tier === 'fixed');
  if (pins.length) head.append(element('p', 'day-info', `★ ${pins.map((block) => block.pinned).join(' · ')}`));
  const shelf = element('div', 'shelf');
  shelf.append(element('h4', 'shelf-title', 'Untimed'));
  for (const block of day.blocks.filter((block) => block.shelf)) shelf.append(renderTile(block));
  for (const block of bumped) {
    const tile = renderTile(block);
    tile.append(element('span', 'bumped', ' · Bumped'));
    shelf.append(tile);
  }
  const timeline = element('div', 'timeline');
  timeline.style.setProperty('--minutes', until - from);
  for (let hour = from; hour < until; hour += 60) {
    const line = element('span', 'hour', blockKey(hour));
    line.style.setProperty('--minute', hour - from);
    timeline.append(line);
  }
  for (const block of blocks) {
    const tile = renderTile(block);
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
  if (plan?.dirtyDays.size) plan.schedules = schedulesForWeek(plan.keys);
  else openPlannerWeek();
  renderPlanner();
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
  $('week-prev').addEventListener('click', () => { monday = addDays(monday, -7); refreshView(); });
  $('week-next').addEventListener('click', () => { monday = addDays(monday, 7); refreshView(); });
  $('week-today').addEventListener('click', () => { monday = weekMonday(new Date()); refreshView(); });
  $('save-week').addEventListener('click', saveWeek);
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
