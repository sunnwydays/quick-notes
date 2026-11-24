// Shared planner timing for the week board and Dash Schedule.
const PLAN_START = 7 * 60;
const PLAN_END = 24 * 60;
const DEFAULT_TIMELINE_END = 23 * 60;
const SCREENS_OFF = 22 * 60;
const PLAN_SIZES = [30, 45, 60, 90];
const PLAN_TIERS = ['low', 'medium', 'high', 'must', 'fixed'];
const STUDY_SUBJECT = /\b(?:(?:ece|csc|mat|sta|phy|chm|bio)\s?[1-4]\d{2}|(?:practice|past) (?:exam|midterm)|exam prep|problem set)\b/i;

function blockKey(start) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(start / 60))}:${p(start % 60)}`;
}

// Display only: minutes after midnight (or "HH:MM") as "3:20 PM".
function clock12(value) {
  const min = typeof value === 'string' ? planMinutes(value) : value;
  const h = Math.floor(min / 60) % 24;
  return `${h % 12 || 12}:${String(min % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function planMinutes(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? '')) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

function blockDuration(block) {
  return block.duration ?? block.size;
}

// Tails no longer exist: older saved blocks fold theirs into the block's length.
function foldTail(block) {
  const { tail, ...rest } = block;
  if (!tail) return rest;
  const length = (block.duration ?? block.size) + tail;
  return block.duration != null ? { ...rest, duration: length } : { ...rest, size: length };
}

// The fixed tier only holds a block because of its pin, so an unpinned block can't stay fixed.
function dropStaleFixed(block) {
  return block.tier === 'fixed' && planMinutes(block.pinned) == null ? { ...block, tier: 'medium' } : block;
}

const BREAK_EXEMPT_KINDS = ['routine', 'meal', 'exercise', 'buffer'];

function gapBetween(block, next, duration = block.start != null && block.until != null ? block.until - block.start : blockDuration(block)) {
  if (block.skipBreak || BREAK_EXEMPT_KINDS.includes(blockKind(block)) || (next && BREAK_EXEMPT_KINDS.includes(blockKind(next)))) return 0;
  return duration < 35 ? 5 : 10;
}

function placeBlocks(day, stack) {
  const wake = Math.max((planMinutes(day.wake) ?? PLAN_START) + (day.startOffset ?? 0), day.workStart ?? 0);
  const anchors = stack.flatMap((block) => {
    const start = block.actualStart ?? block.restackStart ?? planMinutes(block.pinned);
    return start === null ? [] : [{ ...block, start, until: block.actualUntil ?? start + blockDuration(block) }];
  }).sort((a, b) => a.start - b.start);
  const byId = new Map(anchors.map((block) => [block.id, block]));
  let latest = null;
  const placed = [];
  for (const block of stack) {
    let timing = byId.get(block.id);
    if (!timing) {
      const duration = blockDuration(block);
      let start = Math.max(wake, latest ? latest.until + gapBetween(latest, block) : 0, block.importedStart ?? 0);
      for (const anchor of anchors) {
        if (start >= anchor.until + gapBetween(anchor, block)) continue;
        if (start + duration <= anchor.start) break;
        start = anchor.until + gapBetween(anchor, block);
      }
      timing = { ...block, start, until: start + duration };
    }
    placed.push(timing);
    if (!latest || timing.until >= latest.until) latest = timing;
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
  if (day.pinLayout) {
    const byId = new Map(day.blocks.map((block) => [block.id, block]));
    return {
      blocks: day.pinLayout.blocks.filter(({ id }) => byId.has(id))
        .map(({ id, start, until }) => ({ ...byId.get(id), start, until })),
      bumped: day.pinLayout.bumped.filter((id) => byId.has(id)).map((id) => byId.get(id)),
    };
  }
  if (day.imported) {
    return {
      blocks: day.blocks.filter((b) => !b.shelf).map((b) => ({
        ...b, start: b.importedStart, until: b.importedStart + blockDuration(b),
      })),
      bumped: [],
    };
  }
  const wake = planMinutes(day.wake) ?? PLAN_START;
  const cutoff = day.workEnd ?? PLAN_END;
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
  if (!timed || !Number.isInteger(endedAt) || endedAt <= timed.start || endedAt >= PLAN_END) return null;
  const locked = layout.blocks.filter((block) => block.start < timed.start || block.tier === 'fixed');
  const blocks = lockRestackTimes(day.blocks.map(unlocked), locked).map((block) => block.id === id
    ? { ...block, actualStart: timed.start, actualUntil: endedAt } : block);
  const starts = new Map(layout.blocks.map((block) => [block.id, block.start]));
  blocks.sort((a, b) => (starts.get(a.id) ?? Infinity) - (starts.get(b.id) ?? Infinity));
  return { day: editDay(day, blocks, true), timed };
}

// Only push what the later wake actually overlaps; blocks already after it
// stay put unless the pushed blocks run into them.
function applyWake(day, wake) {
  const layout = layoutDay(day).blocks;
  const cutoff = Math.min(day.workEnd ?? SCREENS_OFF, SCREENS_OFF);
  const isAnchor = (block) => block.tier === 'fixed' || block.pinned || block.actualStart != null;
  const anchors = layout.filter(isAnchor);
  let previous = null;
  const earliest = Math.max((planMinutes(wake) ?? PLAN_START) + (day.startOffset ?? 0), day.workStart ?? 0);
  const kept = [];
  for (const block of layout) {
    if (isAnchor(block)) {
      kept.push(block);
      continue;
    }
    const duration = block.until - block.start;
    let start = Math.max(block.start, earliest, previous ? previous.until + gapBetween(previous, block) : 0);
    for (const anchor of anchors) {
      if (start >= anchor.until + gapBetween(anchor, block)) continue;
      if (start + duration <= anchor.start) break;
      start = anchor.until + gapBetween(anchor, block);
    }
    // Leave overflow untimed so the restack can bump it.
    if (start + duration > cutoff) continue;
    kept.push({ ...block, start, until: start + duration });
    previous = kept[kept.length - 1];
  }
  const blocks = day.blocks.map((block) => ({ ...block, restackStart: undefined, restackUntil: undefined }));
  return editDay({ ...day, wake }, lockRestackTimes(blocks, kept), true);
}

function restackBeforeScreensOff(day) {
  const { blocks, bumped } = layoutDay({ ...day, workEnd: Math.min(day.workEnd ?? SCREENS_OFF, SCREENS_OFF) });
  return keepDayTimes(day, day.blocks, blocks, bumped);
}

function planBlock(id, text, fields = {}) {
  return { id, text, size: 45, shelf: false, goal: null, tier: 'medium', pinned: null,
    todoId: null, done: '', next: '', ...fields };
}

function editDay({ pinLayout, ...day }, blocks, preserveRestack = false) {
  return {
    ...day, imported: false,
    blocks: blocks.map(({ importedStart, restackStart, restackUntil, ...block }) => preserveRestack
      ? { ...block, restackStart, restackUntil } : block),
  };
}

function toggleBlockPin(day, id, pinned) {
  const current = layoutDay(day);
  const timed = current.blocks.find((block) => block.id === id);
  if (!timed || (pinned !== null && planMinutes(pinned) !== timed.start)) return null;
  // Keep the displayed times until a scheduling edit runs the stack again.
  return {
    ...day,
    blocks: day.blocks.map((block) => block.id === id ? dropStaleFixed({ ...block, pinned }) : block),
    pinLayout: day.pinLayout ?? {
      blocks: current.blocks.map(({ id, start, until }) => ({ id, start, until })),
      bumped: current.bumped.map((block) => block.id),
    },
  };
}

function unlocked({ restackStart, restackUntil, ...block }) {
  return block;
}

// Write each timed block's shown time onto it (`blocks` is the day's edited list),
// so nothing moves unless it has to. Bumped blocks go to the shelf.
function lockShownTimes(day, blocks = day.blocks, firstId = null) {
  const { blocks: timed, bumped } = layoutDay(day);
  const starts = new Map(timed.map((block) => [block.id, block.start]));
  const bumpedIds = new Set(bumped.map((block) => block.id));
  return editDay(day, pushApart(blocks.map((block) => {
    if (bumpedIds.has(block.id) && !block.shelf) return { ...untimedBlock(block), bumped: true };
    const start = block.restackStart ?? starts.get(block.id);
    if (block.shelf || block.pinned || block.actualStart != null || start == null) return block;
    return { ...block, restackStart: start, restackUntil: start + blockDuration(block) };
  }), firstId), true);
}

// Pinned, already-run and `firstId` blocks hold their time. Any other block in the way
// moves down to the next free spot, pushing the ones after it; past midnight it goes to the shelf.
function pushApart(blocks, firstId) {
  const startOf = (block) => block.actualStart ?? block.restackStart ?? planMinutes(block.pinned);
  const holds = (block) => block.id === firstId || block.pinned || block.actualStart != null;
  const timed = blocks.filter((block) => !block.shelf && startOf(block) != null);
  const taken = timed.filter(holds).map((block) => [startOf(block), block.actualUntil ?? startOf(block) + blockDuration(block)]);
  const moved = new Map();
  const movable = timed.filter((block) => !holds(block)).sort((a, b) => startOf(a) - startOf(b));
  let floor = -Infinity; // pushed blocks keep their order
  for (const block of movable) {
    const duration = blockDuration(block);
    let start = Math.max(startOf(block), floor);
    for (let clash; (clash = taken.find(([from, until]) => start < until && from < start + duration));) start = clash[1];
    if (start + duration > PLAN_END) {
      moved.set(block.id, { ...untimedBlock(block), bumped: true });
      continue;
    }
    taken.push([start, start + duration]);
    floor = start + duration;
    if (start !== block.restackStart) moved.set(block.id, { ...block, restackStart: start, restackUntil: start + duration });
  }
  return blocks.map((block) => moved.get(block.id) ?? block);
}

// New template blocks fit around the blocks already on the day instead of pushing them:
// each takes its template time when that's open, a buffer shrinks to the open part of its slot,
// and anything else moves to the closest opening that ends by 11 PM (else midnight, else the shelf).
function fitTemplateAnchors(kept, anchors, earliest = PLAN_START) {
  const startOf = (block) => block.actualStart ?? block.restackStart ?? planMinutes(block.pinned);
  const span = (block) => [startOf(block), block.actualUntil ?? startOf(block) + blockDuration(block)];
  const taken = [...kept, ...anchors.filter((anchor) => anchor.pinned)]
    .filter((block) => !block.shelf && startOf(block) != null).map(span);
  const open = (from, until) => !taken.some(([a, b]) => from < b && a < until);
  const flexible = anchors.filter((anchor) => !anchor.pinned).sort((a, b) => startOf(a) - startOf(b));
  const fitted = new Map();
  for (const anchor of flexible) {
    const start = startOf(anchor);
    const duration = blockDuration(anchor);
    let at = open(start, start + duration) ? start : null;
    let length = duration;
    if (at == null && ['buffer', 'free'].includes(blockKind(anchor))) {
      const cuts = taken.filter(([a, b]) => a < start + duration && start < b).sort((x, y) => x[0] - y[0]);
      let cursor = start;
      for (const [a, b] of [...cuts, [start + duration, start + duration]]) {
        const end = Math.min(a, start + duration);
        if (end - cursor >= (at == null ? 15 : length + 1)) [at, length] = [cursor, end - cursor];
        cursor = Math.max(cursor, b);
      }
      if (at == null) continue; // no room left for the buffer: leave it out
    } else if (at == null) {
      const candidates = [...new Set(taken.flatMap(([a, b]) => [b, a - duration]))]
        .filter((from) => from >= earliest && open(from, from + duration))
        .sort((x, y) => Math.abs(x - start) - Math.abs(y - start));
      at = candidates.find((from) => from + duration <= DEFAULT_TIMELINE_END) ?? candidates.find((from) => from + duration <= PLAN_END) ?? null;
    }
    if (at == null) {
      fitted.set(anchor.id, untimedBlock(anchor));
      continue;
    }
    taken.push([at, at + length]);
    fitted.set(anchor.id, { ...anchor, duration: length, restackStart: at, restackUntil: at + length });
  }
  return anchors.flatMap((anchor) => anchor.pinned ? [anchor] : fitted.has(anchor.id) ? [fitted.get(anchor.id)] : []);
}

// Resize inside the current opening, including days saved with an existing overlap.
function resizeWindow(day, id) {
  const { blocks } = layoutDay(day);
  const timed = blocks.find(block => block.id === id);
  if (!timed) return null;
  let earliest = Math.min(timed.start, Math.max((planMinutes(day.wake) ?? PLAN_START) + (day.startOffset ?? 0), day.workStart ?? 0));
  let latest = PLAN_END;
  for (const other of blocks) {
    if (other.id === id) continue;
    if (other.start < timed.start) earliest = Math.max(earliest, other.until);
    else latest = Math.min(latest, other.start);
  }
  return { start: timed.start, earliest, latest };
}

function fitResize(window, requested) {
  if (!window || window.latest <= window.earliest) return null;
  const duration = Math.min(requested, window.latest - window.earliest);
  const start = Math.max(window.earliest, Math.min(window.start, window.latest - duration));
  return { start, until: start + duration };
}

function resizeDayBlock(day, block, range) {
  const layout = layoutDay(day);
  const { start, until } = range;
  const resized = { ...unlocked(block), duration: until - start, originalDuration: undefined, skipBreak: undefined };
  if (block.pinned) resized.pinned = blockKey(start);
  if (block.actualStart != null) resized.actualStart = start;
  if (block.actualUntil != null) resized.actualUntil = until;
  const timed = layout.blocks.map(item => item.id === block.id ? { ...item, start, until } : item)
    .sort((a, b) => a.start - b.start);
  const blocks = day.blocks.map(item => item.id === block.id ? resized : item);
  return keepDayTimes(day, lockRestackTimes(blocks, timed), timed, layout.bumped);
}

function minimumSession(original) {
  return Math.ceil(original * 7 / 10);
}

// What a pointer picks on a timeline, hit-testing the stack as it was when the drag began:
// the upper half of a block means before it, the lower half after it, open time keeps `time`.
function timelineDropPlace(stack, pointer, time) {
  const under = stack.find(item => pointer >= item.start && pointer < item.until);
  if (!under) return { at: time };
  return pointer < (under.start + under.until) / 2 ? { before: under.id } : { after: under.id };
}

// Where the dragged block starts for a place: after a block means after its break; before a
// block means as close above it as fits, else right after the block before it.
function timelineDropStart(stack, block, place, earliest = 0) {
  if (place.at != null) return place.at;
  const index = stack.findIndex(item => item.id === (place.before ?? place.after));
  if (index < 0) return null;
  const target = stack[index];
  if (place.after) return Math.max(earliest, target.until + gapBetween(target, block));
  const length = block.originalDuration ?? blockDuration(block);
  const previous = stack[index - 1];
  return Math.max(earliest, previous ? previous.until + gapBetween(previous, block) : earliest,
    target.start - length - gapBetween(block, target, length));
}

// The whole arrangement one timeline drop produces, always from the original stack:
// the dropped block's slot plus every other block's time (`timed`), or null if it can't fit.
function arrangeTimelineDrop(stack, block, place, earliest = 0, skipBreak = false) {
  const start = timelineDropStart(stack, block, place, earliest);
  const fit = start == null ? null : fitTimelineDrop(stack, block, start, skipBreak);
  return fit && { start, until: start + fit.duration, ...fit };
}

// Open time keeps the dropped time, apart from landing inside a break or just over the next block.
function snapTimelineDrop(stack, block, pointer, time, earliest) {
  const length = block.originalDuration ?? blockDuration(block);
  const before = next => next.start - length - gapBetween(block, next, length);
  const previous = stack.findLast(item => item.until <= pointer);
  if (previous) {
    const after = previous.until + gapBetween(previous, block);
    if (time >= previous.start && time < after) return after;
  }
  const next = stack.find(item => item.start > pointer && item.start >= time);
  if (next && time > before(next)) {
    const start = before(next);
    if (start >= earliest && fitTimelineDrop(stack, block, start)?.duration === length) return start;
  }
  return time;
}

// An intentional timeline drop can move flexible work, but pins and recorded time hold.
function fitTimelineDrop(stack, block, start, skipBreak = false) {
  const original = block.originalDuration ?? blockDuration(block);
  const held = stack.filter(item => item.pinned || item.actualStart != null);
  if (held.some(item => item.start <= start && start < item.until)) return null;
  const next = held.find(item => item.start > start);
  const candidate = { ...block, skipBreak };
  let duration = original;
  if (next) {
    const room = next.start - start;
    duration = Math.min(original, room);
    // At 35 minutes the outgoing break changes, so check both sides of the boundary.
    while (duration > 0 && duration + gapBetween(candidate, next, duration) > room) duration--;
  }
  if (duration < minimumSession(original) || start + duration > PLAN_END) return null;
  const preceding = stack.findLast(item => item.until <= start);
  if (preceding && preceding.until + gapBetween(preceding, block) > start) return null;

  let previous = { ...candidate, start, until: start + duration };
  const timed = [];
  for (const [index, item] of stack.entries()) {
    const cursor = previous.until + gapBetween(previous, item);
    if (item.start >= cursor) {
      timed.push(...stack.slice(index));
      break;
    }
    if (held.includes(item) || item.until <= start) {
      timed.push(item);
      continue;
    }
    const length = item.until - item.start;
    let from = cursor;
    for (const anchor of held) {
      if (from >= anchor.until + gapBetween(anchor, item)) continue;
      if (from + length + gapBetween(item, anchor) <= anchor.start) break;
      from = anchor.until + gapBetween(anchor, item);
    }
    if (from + length > PLAN_END) return null;
    previous = { ...item, start: from, until: from + length };
    timed.push(previous);
  }
  return { duration, original, timed };
}

// Return the closest full-length opening in a day without moving any other work.
function fullOpening(stack, block, earliest, end, preferred, excludeStart) {
  const duration = block.originalDuration ?? blockDuration(block);
  const candidate = { ...block, skipBreak: false };
  let cursor = earliest;
  let best = null;
  for (const next of [...stack, null]) {
    const latest = Math.min(end, next ? next.start - gapBetween(candidate, next, duration) : end) - duration;
    if (cursor <= latest) {
      const start = Math.max(cursor, Math.min(preferred, latest));
      if (start !== excludeStart && (best == null || Math.abs(start - preferred) < Math.abs(best - preferred))) best = start;
    }
    if (next) cursor = Math.max(earliest, next.until + gapBetween(next, block));
  }
  return best;
}

// Put a block at a time; whatever it lands on moves down to make room.
function placeInDay(day, blocks, placed, at = planMinutes(placed.pinned)) {
  const rest = blocks.map((block) => block.id !== placed.id ? block : block.pinned ? unlocked(block)
    : { ...block, restackStart: at, restackUntil: at + blockDuration(block) });
  return lockShownTimes(day, rest, placed.id);
}

function untimedBlock(block) {
  const { actualStart, actualUntil, restackStart, restackUntil, ...untimed } = block;
  return { ...untimed, pinned: null, shelf: true };
}

// Kinds dropped from the picker; blocks still carrying one fall back to their name.
const RETIRED_KINDS = ['event', 'prep'];
const EXERCISE_CUE = /\b(?:gym|workout|work out|cardio|lift(?:ing)?|jog(?:ging)?|swim(?:ming)?|yoga|stretch(?:ing)?|intramurals?|intra|scrim|tryouts?|prac|throw(?:ing)?|frisbee|ultimate|basketball|soccer|badminton|climb(?:ing)?)\b|^run\b|\brun \d/i;
const TRAVEL_CUE = /^(?:travel|commute|drive|ride|bus|train|subway|ttc|transit|flight|fly|uber|taxi|walk to|bike to|head (?:to|home|out|back)|go|get to)\b|\b(?:commute|travel to|to (?:the )?airport)\b/i;

function blockKind(block) {
  if (block.kind && !RETIRED_KINDS.includes(block.kind)) return block.kind;
  const text = block.text || '';
  if (/\balmost done\b/i.test(text)) return 'almost';
  if (/\b(ai[- ]tutor|project)\b/i.test(text)) return 'project';
  if (/\b(study|recall|revise|review notes|lab)\b/i.test(text) || STUDY_SUBJECT.test(text)) return 'study';
  if (EXERCISE_CUE.test(text)) return 'exercise';
  if (TRAVEL_CUE.test(text)) return 'travel';
  if (/\b(breakfast|lunch|dinner|meal)\b/i.test(text)) return 'meal';
  if (/^(?:morning wash|wash up|wake|walk outside|routine|nap|screens off|wind down|bedtime|shower)\b/i.test(text)) return 'routine';
  if (/^free\b/i.test(text)) return 'free';
  if (/^buffer\b/i.test(text)) return 'buffer';
  return '';
}

function workBlock(block) {
  return block.tier !== 'fixed' && !['free', 'buffer', 'meal', 'routine', 'exercise', 'travel'].includes(blockKind(block));
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
      placed += until - from;
    }
    const gapUntil = Math.min(block.until + gapBetween(block, blocks[i + 1]), blocks[i + 1]?.start ?? end, end);
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
  if (!block.deadline) return false;
  const [date, time] = block.deadline.split('T');
  return key > date || (key === date && block.until > (planMinutes(time) ?? PLAN_END));
}

function nextDateKey(key) {
  return new Date(Date.parse(key) + 86400000).toISOString().slice(0, 10);
}

function ghostFits(day, key, tomorrow, examTomorrow, blocks, index, block) {
  const next = blocks[index];
  const work = blocks.filter(workBlock);
  const kind = blockKind(block);
  const project = work.find((item) => blockKind(item) === 'project');
  const dinner = blocks.find((item) => blockKind(item) === 'meal' && item.start >= 16 * 60);
  const dueTomorrow = (item) => item.deadline?.startsWith(tomorrow);
  const first = work[0];
  if (afterDeadline(key, block) || (day.workCap ?? Infinity) <= work.length) return false;
  if (first && (dueTomorrow(block) ? block.start > first.start : dueTomorrow(first) && block.start < first.start)) return false;
  if (kind === 'study' && project && block.start > project.start) return false;
  if (kind === 'project' && (blockKind(next ?? {}) !== 'meal' ||
    work.some((item) => item.start > block.start && blockKind(item) === 'study'))) return false;
  if (kind === 'almost' && next?.tier !== 'fixed') return false;
  if (kind === 'fun' && (!dinner || block.until > dinner.start)) return false;
  const cutoff = day.noNewAfter ?? (examTomorrow ? 16 * 60 : Infinity);
  if (kind === 'study' && block.until > cutoff && !/\b(recall|review|warm[- ]?up|revise|revision)\b/i.test(block.text)) return false;
  const deep = (item) => ['high', 'must'].includes(item.tier);
  return (!deep(block) || work.filter(deep).length < (day.deepCap ?? 4)) &&
    dayLoad(day, [...blocks.slice(0, index), block, ...blocks.slice(index)]).ratio < .75;
}

function goalMinutes(blocks, goal) {
  return blocks.filter((block) => block.goal === goal)
    .reduce((sum, block) => sum + Math.max(0, block.until - block.start), 0);
}

function suggestGhosts(days, tray, budgets = {}, earliest = {}, layouts = {}) {
  const keys = Object.keys(days).sort();
  const stacks = Object.fromEntries(keys.map((key) => [key, [...(layouts[key] ?? layoutDay(days[key])).blocks]]));
  const weekly = Object.values(stacks).flat();
  const committed = new Set(Object.values(days).flatMap((day) => day.blocks.map((block) => block.todoId)).filter(Boolean));
  const seen = new Set();
  const ghosts = [];
  for (const { key, shelf } of [true, false].flatMap((shelf) => keys.map((key) => ({ key, shelf })))) {
    const day = days[key];
    if (day.noGhosts || /recovery|social/i.test(day.template ?? '') || earliest[key] === Infinity) continue;
    const stack = stacks[key];
    const tomorrow = nextDateKey(key);
    const examTomorrow = days[tomorrow]?.template === 'Exam / interview';
    const candidates = shelf ? day.blocks.filter((block) => block.shelf) : tray.filter((block) => !committed.has(block.todoId));
    candidates.sort((a, b) => Number(Boolean(b.deadline?.startsWith(tomorrow))) - Number(Boolean(a.deadline?.startsWith(tomorrow))));
    for (const block of candidates) {
      const identity = block.todoId ?? block.id;
      if (seen.has(identity) || /^now\s*:/i.test(block.text ?? '') || !workBlock(block)) continue;
      const weekday = new Date(key).getUTCDay();
      if (!shelf && (weekday === 0 || weekday === 6) && block.tier !== 'must') continue;
      const duration = blockDuration(block);
      const budget = budgets[block.goal];
      if (budget != null && goalMinutes(weekly, block.goal) + duration > budget * 60) continue;
      const startOfDay = Math.max((planMinutes(day.wake) ?? PLAN_START) + (day.startOffset ?? 0), day.workStart ?? 0, earliest[key] ?? 0);
      const adjacent = ['project', 'almost'].includes(blockKind(block));
      for (let i = 0; i <= stack.length; i++) {
        const prev = stack[i - 1];
        const next = stack[i];
        const beforeNext = adjacent && next ? next.start - duration - gapBetween(block, next) : 0;
        const start = Math.max(startOfDay, prev ? prev.until + gapBetween(prev, block) : 0, beforeNext);
        const until = start + duration;
        if (until > Math.min(SCREENS_OFF, day.workEnd ?? SCREENS_OFF, (next?.start ?? Infinity) - gapBetween(block, next))) continue;
        const timed = { ...block, start, until, shelf: false };
        if (!ghostFits(day, key, tomorrow, examTomorrow, stack, i, timed)) continue;
        stack.splice(i, 0, timed);
        weekly.push(timed);
        seen.add(identity);
        ghosts.push({ key, block: timed, shelf });
        break;
      }
    }
  }
  return ghosts;
}

function keepDayTimes(day, blocks, timed, bumped = []) {
  const order = new Map(timed.map((block, index) => [block.id, index]));
  const sorted = [...blocks].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  return { ...day, imported: false, blocks: sorted,
    pinLayout: { blocks: timed.map(({ id, start, until }) => ({ id, start, until })), bumped: bumped.map(({ id }) => id) } };
}

function lockRestackTimes(blocks, timed) {
  const times = new Map(timed.map((block) => [block.id, block]));
  return blocks.map((block) => {
    const previous = times.get(block.id);
    return previous && !block.pinned && block.actualStart == null
      ? { ...block, restackStart: previous.start, restackUntil: previous.until } : block;
  });
}

function insertPopup(day, popup, minute) {
  const { blocks, bumped } = layoutDay(day);
  const duration = blockDuration(popup);
  const cutoff = Math.min(SCREENS_OFF, day.workEnd ?? SCREENS_OFF);
  const wake = (planMinutes(day.wake) ?? PLAN_START) + (day.startOffset ?? 0);
  const earliest = Math.max(minute, wake);
  if (duration <= 15) {
    let cursor = earliest;
    for (const next of [...blocks, { start: cutoff, until: cutoff }]) {
      const start = cursor;
      const until = start + duration;
      const fitsGap = until <= Math.min(next.start, cutoff);
      const freeStart = Math.max(start, next.start);
      const freeEnd = freeStart + duration;
      const fitsFree = ['free', 'buffer'].includes(blockKind(next)) && freeEnd <= Math.min(next.until, cutoff);
      if (fitsGap || fitsFree) {
        const timed = fitsGap ? { ...popup, start, until } : { ...popup, start: freeStart, until: freeEnd };
        const remaining = fitsGap ? blocks : blocks.filter((block) => block.id !== next.id);
        if (!fitsGap) {
          const { actualStart, actualUntil, restackStart, restackUntil, importedStart, ...free } = next;
          const parts = [[next.start, freeStart], [freeEnd, next.until]];
          for (const [i, [from, to]] of parts.entries()) {
            if (to <= from) continue;
            remaining.push({ ...free, id: i === 0 ? next.id : `${popup.id}-free`,
              pinned: next.pinned ? blockKey(from) : null, start: from, until: to, duration: to - from });
          }
        }
        const stack = [...remaining, timed].sort((a, b) => a.start - b.start);
        const untimed = day.blocks.filter((block) => block.shelf || bumped.some((item) => item.id === block.id));
        return { day: keepDayTimes(day, [...stack, ...untimed], stack, bumped), bumped };
      }
      cursor = Math.max(cursor, next.until);
    }
    return null;
  }
  const overlappingEnd = Math.max(earliest, ...blocks.filter((block) => block.start <= earliest && earliest < block.until).map((block) => block.until));
  const boundary = blocks.find((block) => block.start >= overlappingEnd)?.start ?? overlappingEnd;
  const fixed = blocks.filter((block) => block.tier === 'fixed' || block.actualStart != null);
  const keep = blocks.filter((block) => block.start < boundary || fixed.includes(block));
  let start = boundary;
  for (const block of fixed) {
    if (start < block.until && start + duration > block.start) start = block.until + gapBetween(block, popup);
  }
  if (start + duration > cutoff) return null;
  const displaced = blocks.filter((block) => block.pinned && !keep.includes(block) &&
    block.start < start + duration && start < block.until);
  const displacedIds = new Set(displaced.map((block) => block.id));
  const stack = lockRestackTimes(day.blocks.filter((block) => !displacedIds.has(block.id)).map(unlocked), keep);
  const next = blocks.find((block) => block.start >= boundary && !displacedIds.has(block.id));
  const at = next ? stack.findIndex((block) => block.id === next.id) : stack.length;
  stack.splice(at, 0, { ...popup, restackStart: start, restackUntil: start + duration });
  const edited = editDay(day, stack, true);
  const result = layoutDay({ ...edited, workEnd: cutoff });
  const allBumped = [...new Map([...bumped, ...displaced, ...result.bumped].map((block) => [block.id, block])).values()]
    .filter((block) => !result.blocks.some((item) => item.id === block.id));
  return { day: keepDayTimes(edited, [...edited.blocks, ...displaced], result.blocks, allBumped), bumped: allBumped };
}

// Typed quick-add: pull a start time and/or a length out of an item title.
// Returns { text, start?, duration? }: start in minutes after midnight, duration in minutes,
// and text with those tokens removed. A bare number only counts as a time when it looks like
// one ("9-11", "5pm", "17:00", "at 5"), so "study 454" keeps its 454.
function bareHour(hour) {
  // Without am/pm: 7-11 is morning, 12 is noon, 1-6 is afternoon.
  return hour >= 1 && hour <= 6 ? hour + 12 : hour;
}

function clockMinutes(hour, minute, ap) {
  if (hour > 23 || (ap && (hour < 1 || hour > 12))) return null;
  const h = ap ? (hour % 12) + (ap === 'p' ? 12 : 0) : hour;
  return h * 60 + Number(minute || 0);
}

function parseQuickAdd(input) {
  let text = String(input ?? '');
  let start;
  let duration;
  const cut = (match) => { text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`; };
  const edge = String.raw`(?<![\w:.\-])`;
  const long = /(?<![\w.])(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)(?![a-z])(?:\s*(\d+)\s*(?:m|mins?|minutes?)\b)?|(?<![\w.])(\d+)\s*(?:m|mins?|minutes?)\b/i.exec(text);
  if (long) {
    const total = long[3] != null ? Number(long[3]) : Math.round(Number(long[1]) * 60 + Number(long[2] || 0));
    if (total >= 5 && total <= 720) { duration = total; cut(long); }
  }
  const range = new RegExp(String.raw`${edge}(\d{1,2})(?::([0-5]\d))?\s*([ap]\.?m?\.?)?\s*[-–—]\s*(\d{1,2})(?::([0-5]\d))?\s*([ap]\.?m?\.?)?(?![\w:])`, 'i').exec(text);
  const marker = (value) => value?.[0].toLowerCase();
  if (range) {
    const [, h1, m1, a1, h2, m2, a2] = range;
    const endAp = marker(a2);
    const startAp = marker(a1) ?? endAp;
    let from = clockMinutes(Number(h1), m1, startAp);
    let to = clockMinutes(Number(h2), m2, endAp);
    if (from != null && to != null && !marker(a1) && !endAp) {
      from = clockMinutes(bareHour(Number(h1)), m1);
      to = clockMinutes(Number(h2), m2);
      while (to != null && to <= from) to += 12 * 60;
    } else if (from != null && to != null && !marker(a1) && to <= from) {
      from -= 12 * 60;
      if (from < 0) from += 24 * 60;
    }
    if (from != null && to != null && to > from && to <= 24 * 60) {
      start = from;
      duration ??= to - from;
      cut(range);
    }
  }
  if (start == null) {
    const at = new RegExp(String.raw`\bat\s+(\d{1,2})(?::([0-5]\d))?\s*(?:([ap])\.?m\b\.?)?(?![\w:])`, 'i').exec(text);
    const ampm = new RegExp(String.raw`${edge}(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\b\.?`, 'i').exec(text);
    const colon = new RegExp(String.raw`${edge}(\d{1,2}):([0-5]\d)(?![\w:])`).exec(text);
    for (const [found, kind] of [[at, 'at'], [ampm, 'ampm'], [colon, 'colon']]) {
      if (!found) continue;
      const ap = found[3]?.toLowerCase();
      const hour = Number(found[1]);
      const value = ap || kind === 'ampm' ? clockMinutes(hour, found[2], ap) : clockMinutes(hour > 12 || found[1].startsWith('0') ? hour : bareHour(hour), found[2]);
      if (value == null || value >= 24 * 60) continue;
      start = value;
      cut(found);
      break;
    }
  }
  const cleaned = text.replace(/\s+/g, ' ').trim().replace(/(?:^|\s)(?:for|at|from|@)$/i, '').trim();
  if (!cleaned) return { text: String(input ?? '').trim() };
  return { text: cleaned, ...start != null ? { start } : {}, ...duration != null ? { duration } : {} };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { snapTimelineDrop, timelineDropPlace, timelineDropStart, arrangeTimelineDrop, resizeWindow, fitResize, resizeDayBlock, fitTimelineDrop, fullOpening, foldTail, dropStaleFixed, layoutDay, applyOverrun, applyWake, dayLoad, placeInDay, lockShownTimes, toggleBlockPin, suggestGhosts,
    insertPopup, restackBeforeScreensOff, parseQuickAdd, fitTemplateAnchors, blockKind };
}
