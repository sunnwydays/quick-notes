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
  return (block.duration ?? block.size) + (block.tail ?? 0);
}

function gapAfter(block) {
  return (block.duration ?? block.size) >= 90 ? 15 : 10;
}

function placeBlocks(day, stack) {
  const wake = Math.max((planMinutes(day.wake) ?? PLAN_START) + (day.startOffset ?? 0), day.workStart ?? 0);
  const anchors = stack.flatMap((block) => {
    const start = block.actualStart ?? block.restackStart ?? planMinutes(block.pinned);
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
  let cursor = Math.max((planMinutes(wake) ?? PLAN_START) + (day.startOffset ?? 0), day.workStart ?? 0);
  const kept = [];
  for (const block of layout) {
    if (isAnchor(block)) {
      kept.push(block);
      continue;
    }
    const duration = block.until - block.start;
    let start = Math.max(block.start, cursor);
    for (const anchor of anchors) {
      if (start >= anchor.until + gapAfter(anchor)) continue;
      if (start + duration <= anchor.start) break;
      start = anchor.until + gapAfter(anchor);
    }
    // Leave overflow untimed so the restack can bump it.
    if (start + duration > cutoff) continue;
    kept.push({ ...block, start, until: start + duration });
    cursor = start + duration + gapAfter(block);
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
    todoId: null, tail: 0, done: '', next: '', ...fields };
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
    blocks: day.blocks.map((block) => block.id === id ? { ...block, pinned } : block),
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
// so an edit moves only the block it touches. Bumped blocks go to the shelf.
function lockShownTimes(day, blocks = day.blocks) {
  const { blocks: timed, bumped } = layoutDay(day);
  const starts = new Map(timed.map((block) => [block.id, block.start]));
  const bumpedIds = new Set(bumped.map((block) => block.id));
  return editDay(day, blocks.map((block) => {
    if (bumpedIds.has(block.id) && !block.shelf) return { ...untimedBlock(block), bumped: true };
    const start = block.restackStart ?? starts.get(block.id);
    if (block.shelf || block.pinned || block.actualStart != null || start == null) return block;
    return { ...block, restackStart: start, restackUntil: start + blockDuration(block) };
  }), true);
}

// Place a block at a time and keep the rest of the day where it is, overlaps included.
function placeInDay(day, blocks, placed, at = planMinutes(placed.pinned)) {
  const rest = blocks.map((block) => block.id === placed.id ? unlocked(block) : block);
  const locked = lockShownTimes(day, rest);
  return { ...locked, blocks: locked.blocks.map((block) => block.id !== placed.id || block.pinned ? block
    : { ...block, restackStart: at, restackUntil: at + blockDuration(block) }) };
}

function untimedBlock(block) {
  const { actualStart, actualUntil, restackStart, restackUntil, ...untimed } = block;
  return { ...untimed, pinned: null, shelf: true };
}

function blockKind(block) {
  if (block.kind) return block.kind;
  const text = block.text || '';
  if (/\balmost done\b/i.test(text)) return 'almost';
  if (/\b(ai[- ]tutor|project)\b/i.test(text)) return 'project';
  if (/\b(prep|settle)\b/i.test(text)) return 'prep';
  if (/\b(study|recall|revise|review notes|lab)\b/i.test(text) || STUDY_SUBJECT.test(text)) return 'study';
  if (/\b(lunch|dinner|meal)\b/i.test(text)) return 'meal';
  if (/^free\b/i.test(text)) return 'free';
  if (/^buffer\b/i.test(text)) return 'buffer';
  return '';
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
  const nextDayPrep = (item) => blockKind(item) === 'prep' && (examTomorrow || item.deadline?.startsWith(tomorrow));
  const dinner = blocks.find((item) => blockKind(item) === 'meal' && item.start >= 16 * 60);
  const dueTomorrow = (item) => item.deadline?.startsWith(tomorrow);
  const first = work[0];
  if (afterDeadline(key, block) || (day.workCap ?? Infinity) <= work.length) return false;
  if (first && (dueTomorrow(block) ? block.start > first.start : dueTomorrow(first) && block.start < first.start)) return false;
  if ((kind === 'study' || nextDayPrep(block)) && project && block.start > project.start) return false;
  if (kind === 'project' && (blockKind(next ?? {}) !== 'meal' ||
    work.some((item) => item.start > block.start && (blockKind(item) === 'study' || nextDayPrep(item))))) return false;
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
    .reduce((sum, block) => sum + Math.max(0, block.until - block.start - (block.tail ?? 0)), 0);
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
      if (budget != null && goalMinutes(weekly, block.goal) + duration - (block.tail ?? 0) > budget * 60) continue;
      const startOfDay = Math.max((planMinutes(day.wake) ?? PLAN_START) + (day.startOffset ?? 0), day.workStart ?? 0, earliest[key] ?? 0);
      const adjacent = ['project', 'almost'].includes(blockKind(block));
      for (let i = 0; i <= stack.length; i++) {
        const prev = stack[i - 1];
        const next = stack[i];
        const beforeNext = adjacent && next ? next.start - duration - gapAfter(block) : 0;
        const start = Math.max(startOfDay, prev ? prev.until + gapAfter(prev) : 0, beforeNext);
        const until = start + duration;
        if (until > Math.min(SCREENS_OFF, day.workEnd ?? SCREENS_OFF, (next?.start ?? Infinity) - 5)) continue;
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
              pinned: next.pinned ? blockKey(from) : null, start: from, until: to, duration: to - from, tail: 0 });
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
    if (start < block.until && start + duration > block.start) start = block.until + gapAfter(block);
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { layoutDay, applyOverrun, applyWake, dayLoad, placeInDay, lockShownTimes, toggleBlockPin, suggestGhosts,
    insertPopup, restackBeforeScreensOff };
}
