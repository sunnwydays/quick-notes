// ---------- schedule ----------
// A schedule is an ordinary note in the Schedule category, kept exactly as it was
// pasted or typed. Its times are read from the text each time it's shown, so the
// original stays as written. Changing a plan saves a new note: the newest one for
// a day is the one shown, and every version stays under All saved.

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// A line that starts with a day: "Sun (full day)", "Monday:", "Tue 27 Oct", "Tomorrow".
// What follows the day has to look like a heading, so "Sat runs late" stays text.
const DAY_HEAD = /^(today|tomorrow|sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?)\.?(?=\s*(?:$|[(:,–—-]|\d|[a-z]{3,9}\.?\s+\d))/i;
// 9:00, 14:30, 9am, 9p, 2:30 p.m., and plain numbers: 10, 830, 1030. Groups: hour,
// the colon (or ''), minutes, a/p. Whether a plain number counts is up to readTime.
// A lone a or p has to follow the number directly, so "10 a walk" stays text.
const TIME = String.raw`(\d{1,2}?)(?:(:?)([0-5]\d))?(?!\d)(?:(?:\s*(?=[ap]\.?\s?m\b)|(?=[ap]\b))([ap])(?:\.?\s?m)?\b\.?)?`;
const TIME_AT = new RegExp('^' + TIME, 'i');
const TO_TIME = new RegExp(String.raw`^\s*(?:-|–|—|to)\s*` + TIME, 'i');
// "17:00 dinner, 17:45 chess" is two blocks: a comma or semicolon followed by a time starts a new one.
const NEXT_BLOCK = /[,;]\s+(?=\d{1,2}(?::[0-5]\d|\s*[ap]\.?\s?m\b|[ap]\b))/i;
const DAY_END = 24 * 60;
const DONE_PAGE = 3; // finished blocks shown per tap of "See more"

let doneShown = 0; // finished blocks unfolded on today's schedule
let scheduleTimer = 0;
// The day a schedule was just saved for, so going back to the schedule screen
// shows that day: a plan headed "Sun" and saved on Saturday is tomorrow's.
let savedDay = null;

// A line without its "- " bullet.
function bare(line) {
  return line.replace(/^\s*[-*•]?\s*/, '').trim();
}

// The day word a heading line starts with ("Sun", "tomorrow"), or null.
function dayWord(line) {
  const m = DAY_HEAD.exec(line.replace(/[*_#]/g, '').trim());
  return m && m[1];
}

// Days after `from` that a day word means: the next such weekday, counting today.
function dayOffset(word, from) {
  const w = word.toLowerCase();
  if (w === 'today') return 0;
  if (w === 'tomorrow') return 1;
  return (WEEKDAYS.indexOf(w.slice(0, 3)) - from.getDay() + 7) % 7;
}

function dayKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function keyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// A time at the start of s, as {h, m, ap, bare, length}, or null. TO_TIME reads
// the end of a range. A bare number (no colon or am/pm: "10", "830", "1030")
// counts at the start of a line when a word or a range follows ("10 brunch", as
// voice typing writes it, or "2130-2230 read") and as the end of a range
// ("10:30 - 12 email"), but not when it runs into more text, like "2h30" or "15m".
function readTime(s, re = TIME_AT) {
  const t = re.exec(s);
  if (!t) return null;
  const bare = t[2] !== ':' && !t[4];
  const after = s.slice(t[0].length);
  const bareOk = re === TO_TIME ? !/^[a-z0-9:]/i.test(after) : /^(?:\s+[a-z(]|\s*(?:-|–|—|to\b)\s*\d)/i.test(after);
  if (bare && !bareOk) return null;
  const h = Number(t[1]);
  const m = Number(t[3] || 0);
  if (h * 60 + m > DAY_END) return null;
  return { h, m, ap: t[4] && t[4].toLowerCase(), bare, length: t[0].length };
}

// Minutes after midnight. Without am/pm, a time that would come before `after`
// is taken as afternoon, so "12:30" then "1:00" reads as 13:00.
function minutes(t, after) {
  let h = t.h;
  if (t.ap) h = (h % 12) + (t.ap === 'p' ? 12 : 0);
  else if (after != null && h < 12 && h * 60 + t.m < after) h += 12;
  return h * 60 + t.m;
}

// "3:20pm", however the time was written. Without `half`, the am/pm is left off,
// for the start of a range in the same half of the day: "3:20–3:30pm".
function clock(min, half = true, short = false) {
  const h = Math.floor(min / 60) % 24;
  const time = `${h % 12 || 12}:${String(min % 60).padStart(2, '0')}`;
  return half ? time + (h < 12 ? 'a' : 'p') + (short ? '' : 'm') : time;
}

function timeRange(start, end) {
  const pm = (min) => Math.floor(min / 60) % 24 >= 12;
  return `${clock(start, pm(start) !== pm(end))}–${clock(end)}`;
}

// {head, intro, blocks}. head is the day heading line, intro the lines before the
// first time. Each block is {start, end, until, lines}: end is the end time as
// written (or null), until is when it's over (end, else the next block's start,
// else midnight). A line with no time joins the block above it. Blocks are in
// order of start time, wherever they were written, and ones that overlap are
// merged into one: "18:50–19:50 Foosball" and "19:45–19:55 break" make
// "18:50–19:55 Foosball + break".
function parseSchedule(text) {
  const plan = { head: null, intro: [], blocks: [] };
  for (const raw of text.split('\n')) {
    const line = bare(raw);
    if (!line) continue;
    if (!plan.head && !plan.blocks.length && dayWord(line)) {
      plan.head = line;
      continue;
    }
    for (const part of line.split(NEXT_BLOCK)) {
      const last = plan.blocks[plan.blocks.length - 1];
      const start = readTime(part);
      const at = start && minutes(start, last && last.start);
      let rest = start ? part.slice(start.length) : part;
      const end = start && readTime(rest, TO_TIME);
      // A bare number only starts a block if it's a range ("7-740 deer proj") or
      // comes after the one above (counting afternoon, so "1 lunch" after
      // "10 brunch" is 13:00); otherwise it's a line of that block, like "5 sets"
      // under "20:00 gym".
      if (!start || (start.bare && !end && last && at <= last.start)) {
        (last ? last.lines : plan.intro).push(part);
        continue;
      }
      const block = { start: at, end: null, lines: [] };
      if (end) {
        block.end = minutes(end, block.start);
        rest = rest.slice(end.length);
      }
      block.lines.push(rest.replace(/^[\s:.,;–—-]+/, ''));
      plan.blocks.push(block);
    }
  }
  plan.blocks.sort((a, b) => a.start - b.start);
  plan.blocks = plan.blocks.reduce((kept, b) => {
    const prev = kept[kept.length - 1];
    if (!prev || (b.start > prev.start && (prev.end == null || b.start >= prev.end))) {
      kept.push(b);
      return kept;
    }
    if (b.end != null) prev.end = prev.end == null ? b.end : Math.max(prev.end, b.end);
    const [first = '', ...more] = b.lines;
    prev.lines[0] = [prev.lines[0], first].filter(Boolean).join(' + ');
    prev.lines.push(...more);
    return kept;
  }, []);
  plan.blocks.forEach((b, i) => {
    const next = plan.blocks[i + 1];
    b.until = b.end != null ? b.end : next && next.start > b.start ? next.start : DAY_END;
  });
  return plan;
}

// A paste covering several days ("Sun ..." then "Mon ...") is saved as one note
// per day, each starting at its heading. Lines before the first heading are
// today's, unless they hold no times, in which case they stay with the first day.
function splitDays(text) {
  const days = [];
  for (const line of text.split('\n')) {
    if (!days.length || dayWord(bare(line))) days.push([]);
    days[days.length - 1].push(line);
  }
  if (days.length > 1 && !dayWord(bare(days[0][0])) && !days[0].some((l) => readTime(bare(l)))) {
    days[1].unshift(...days.shift());
  }
  const notes = days.map((lines) => lines.join('\n').trim()).filter((t) => {
    const plan = parseSchedule(t);
    return plan.blocks.length || plan.intro.length;
  });
  return notes.length ? notes : [text];
}

// The day a schedule is for: its heading's day, counted from when it was saved.
function scheduleDay(entry) {
  const saved = new Date(entry.createdAt);
  const word = dayWord(parseSchedule(entry.text).head || 'today');
  return dayKey(addDays(saved, dayOffset(word, saved)));
}

// The newest schedule for a day, or undefined.
function scheduleOn(key) {
  return entriesFor(SCHEDULE).find((e) => scheduleDay(e) === key);
}

// The text an edit starts from. It's saved again as a new note today, so its
// heading has to mean the same day counted from today: "Tomorrow" written
// yesterday becomes the weekday, and another day's schedule gets a heading if
// it had none.
function editText(entry, key) {
  const today = new Date();
  const want = Math.round((keyDate(key) - keyDate(dayKey(today))) / 864e5);
  const name = keyDate(key).toLocaleDateString('en-US', { weekday: 'short' });
  const lines = entry.text.split('\n');
  const { head } = parseSchedule(entry.text);
  const i = head ? lines.findIndex((l) => bare(l) === head) : -1;
  if (i < 0) {
    if (want) lines.unshift(name);
  } else {
    const word = dayWord(bare(lines[i]));
    if (dayOffset(word, today) !== want) lines[i] = lines[i].replace(word, name);
  }
  return lines.join('\n');
}

// False when a day's schedule would only repeat the version already saved for
// that day, as when Edit is saved without changes. Edit may have rewritten the
// heading, so the text it opened with counts as the same too.
function changesSchedule(text) {
  const key = scheduleDay({ text, createdAt: new Date().toISOString() });
  const prev = scheduleOn(key);
  return !prev || (text !== prev.text && text !== cleanText(editText(prev, key)));
}

function dayLabel(key, month = true) {
  const opts = { weekday: 'short', day: 'numeric' };
  if (month) opts.month = 'short';
  return keyDate(key).toLocaleDateString(undefined, opts);
}

function textLine(className, text) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

// ---------- ticks ----------
// A block can be ticked done or skipped; tapping cycles unmarked -> done ->
// skipped -> unmarked. Each tap adds a row to data.marks and never changes one:
// the newest mark for a day and start time wins, and unticking adds 'cleared'.
// A block is its day and start time, so a mark carries over to a new version of
// that day's schedule wherever the start time still matches.
// Holding the box marks it 'over' (ran over) instead, asking when it ended and
// why; a tap on an 'over' block goes on to skipped, like done.
const MARK_NEXT = { done: 'skipped', over: 'skipped', skipped: 'cleared' };
const MARK_BOX = 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z';

// 'HH:MM', 24 hours, as stored in qn_block_marks.
function blockKey(start) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(start / 60))}:${p(start % 60)}`;
}

function keyMinutes(key) {
  const [h, m] = key.split(':').map(Number);
  return h * 60 + m;
}

// The mark each block of a day currently has: a Map of 'HH:MM' -> its newest
// mark row, status 'done', 'over' or 'skipped'.
function marksOn(day) {
  const newest = new Map();
  for (const m of data.marks) {
    if (m.day !== day) continue;
    const prev = newest.get(m.blockStart);
    if (!prev || m.markedAt > prev.markedAt || (m.markedAt === prev.markedAt && m.id > prev.id)) newest.set(m.blockStart, m);
  }
  return new Map([...newest].filter(([, m]) => m.status !== 'cleared'));
}

function addMark(day, b, fields) {
  data.marks.push({
    id: newId(), day, blockStart: blockKey(b.start), blockText: b.lines.find(Boolean) || '',
    markedAt: new Date().toISOString(), dirty: true, ...fields,
  });
  persist();
  refreshView();
  sync();
}

function cycleMark(day, b) {
  const mark = marksOn(day).get(blockKey(b.start));
  addMark(day, b, { status: MARK_NEXT[mark && mark.status] || 'done' });
}

// One prompt for both: "11:40 chatted with coach". It starts at the time it's
// being marked if that's past the block's end (so the usual case is just OK),
// else at the end. A time without am/pm is read as after the block's start. No
// time at the start makes the whole line the reason.
function markOver(day, b) {
  const now = new Date();
  const nowMin = day === dayKey(now) ? now.getHours() * 60 + now.getMinutes() : -1;
  const answer = prompt('Ran over: ended at, and why (optional)', `${clock(Math.min(Math.max(nowMin, b.until), DAY_END - 1))} `);
  if (answer == null) return;
  const s = answer.trim();
  const t = readTime(s);
  addMark(day, b, {
    status: 'over',
    endedAt: t ? blockKey(Math.min(minutes(t, b.start), DAY_END - 1)) : null,
    reason: (t ? s.slice(t.length) : s).replace(/^[\s,:;–—-]+/, ''),
  });
}

function markLabel(mark) {
  if (mark.status !== 'over') return { done: 'Done', skipped: 'Skipped' }[mark.status];
  return 'Ran over' + (mark.endedAt ? ` to ${clock(keyMinutes(mark.endedAt))}` : '') + (mark.reason ? `: ${mark.reason}` : '');
}

// An empty box, a ticked one (done), one with an arrow out of it (ran over) or
// one with a dash through a dashed outline (skipped), so the states differ in
// shape and not only in shade.
function markIcon(status, size) {
  const span = document.createElement('span');
  span.className = 'icon';
  const dash = status === 'skipped' ? ' stroke-dasharray="4 3"' : '';
  const inner = {
    done: '<path d="M8 12l3 3 5-6"/>', over: '<path d="M7 12h10M13 8l4 4-4 4"/>', skipped: '<path d="M8 12h8"/>',
  }[status] || '';
  span.innerHTML =
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${MARK_BOX}"${dash}/>${inner}</svg>`;
  return span;
}

// day is null on a day that hasn't come yet, where there's nothing to tick.
function blockRow(b, state, mark, day) {
  const status = mark && mark.status;
  const div = document.createElement('div');
  div.className = ['block', state, status && `marked-${status}`].filter(Boolean).join(' ');
  const body = document.createElement('div');
  body.className = 'block-body';
  const time = document.createElement('time');
  time.textContent = b.end != null ? timeRange(b.start, b.end) : clock(b.start);
  body.append(time);
  if (state === 'now') {
    const now = document.createElement('b');
    now.className = 'block-now';
    now.textContent = b.until < DAY_END ? `Now, until ${clock(b.until)}` : 'Now';
    body.append(now);
  }
  if (mark) {
    const label = document.createElement('b');
    label.className = 'block-mark';
    label.textContent = markLabel(mark);
    body.append(label);
  }
  body.append(textLine('', b.lines.filter(Boolean).join('\n')));
  div.append(body);
  if (day) {
    // A tap cycles the mark; a hold, until the box turns black, marks it ran over.
    const btn = document.createElement('button');
    btn.className = 'mark-btn quiet';
    btn.setAttribute('aria-label', { done: 'Mark skipped', over: 'Mark skipped', skipped: 'Clear mark' }[status] || 'Mark done');
    btn.append(markIcon(status, 26));
    btn.addEventListener('click', () => {
      if (!btn.held) cycleMark(day, b);
    });
    onHoldRelease(btn, () => markOver(day, b), HOLD_TO_DONE_MS);
    div.append(btn);
  }
  return div;
}

// Finished blocks are folded into one row. Each tap shows a few more, the most
// recent first; Hide folds them all again.
function foldRow(hidden, total) {
  const row = document.createElement('div');
  row.className = 'fold';
  if (hidden) {
    const more = document.createElement('button');
    more.className = 'quiet';
    more.textContent = hidden === total ? `See ${hidden} done` : `See ${hidden} more`;
    more.addEventListener('click', () => {
      doneShown += DONE_PAGE;
      renderSchedule(current);
    });
    row.append(more);
  }
  if (hidden < total) {
    const hide = document.createElement('button');
    hide.className = 'quiet';
    hide.textContent = 'Hide done';
    hide.addEventListener('click', () => {
      doneShown = 0;
      renderSchedule(current);
    });
    row.append(hide);
  }
  return row;
}

// The day arrows step through the days that have a schedule, plus today.
function setDayButton(btn, key, text) {
  btn.style.visibility = key ? '' : 'hidden';
  btn.dataset.day = key || '';
  btn.textContent = key ? text(dayLabel(key, false)) : '';
}

// state.date is the day shown, or null for today (which then follows midnight).
// fresh = just opened, so finished blocks start folded.
function renderSchedule(state, fresh = false) {
  clearTimeout(scheduleTimer);
  if (fresh) doneShown = 0;
  const now = new Date();
  const today = dayKey(now);
  const key = state.date || today;
  const entry = scheduleOn(key);
  const isToday = key === today;

  setLabel($('schedule-title'), SCHEDULE);
  const days = [...new Set([...entriesFor(SCHEDULE).map(scheduleDay), today, key])].sort();
  const at = days.indexOf(key);
  setDayButton($('day-prev'), days[at - 1], (d) => `‹ ${d}`);
  setDayButton($('day-next'), days[at + 1], (d) => `${d} ›`);
  $('schedule-day').textContent = isToday ? 'Today' : dayLabel(key);
  // A past day's schedule can only be read: saving it again would make it today's.
  $('schedule-edit-btn').hidden = !entry || key < today;
  $('schedule-new-btn').hidden = key < today;

  const box = $('schedule-list');
  box.replaceChildren();
  const plan = entry ? parseSchedule(entry.text) : { head: null, intro: [], blocks: [] };
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (!entry) {
    const how = ' Tap New, then paste one or type a line per block, like "9:00-11:30 Foosball".';
    box.append(textLine('empty', isToday ? `No schedule for today.${how}` : key < today ? 'No schedule for this day.' : `No schedule for this day.${how}`));
    // Point at a schedule saved for a later day, in case it was meant for today.
    const next = days[at + 1];
    if (next) {
      const btn = document.createElement('button');
      btn.className = 'next-day';
      btn.textContent = `See ${dayLabel(next)} ›`;
      btn.addEventListener('click', () => $('day-next').click());
      box.append(btn);
    }
  } else {
    if (plan.head) box.append(textLine('schedule-note', plan.head));
    for (const line of plan.intro) box.append(textLine('schedule-note', line));
    // Only today's schedule follows the clock; other days are shown as written.
    const done = isToday ? plan.blocks.filter((b) => b.until <= nowMin) : [];
    const nowBlock = isToday ? plan.blocks.find((b) => b.start <= nowMin && nowMin < b.until) : null;
    const nextBlock = isToday && !nowBlock ? plan.blocks.find((b) => b.start > nowMin) : null;
    const hidden = done.length - Math.min(doneShown, done.length);
    if (done.length) box.append(foldRow(hidden, done.length));
    const marks = marksOn(key);
    for (const b of plan.blocks) {
      const d = done.indexOf(b);
      if (d >= 0 && d < hidden) continue;
      if (b === nextBlock) box.append(textLine('free', `Free until ${clock(b.start)}`));
      box.append(blockRow(b, d >= 0 ? 'done' : b === nowBlock ? 'now' : '', marks.get(blockKey(b.start)), key <= today ? key : null));
    }
    if (isToday && plan.blocks.length && !nowBlock && !nextBlock) box.append(textLine('empty', 'Done for today.'));
  }

  // Redraw when the next block starts or ends (or at midnight), not every
  // minute: each redraw flashes an e-ink screen.
  if (isToday) {
    const marks = plan.blocks.flatMap((b) => [b.start, b.until]).filter((m) => m > nowMin);
    const next = Math.min(DAY_END, ...marks);
    const ms = (next - nowMin) * 60000 - now.getSeconds() * 1000 - now.getMilliseconds() + 1000;
    scheduleTimer = setTimeout(() => {
      if (current && current.view === 'schedule') renderSchedule(current);
    }, ms);
  }
}

// Timers stall while the app is in the background, so catch up on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (!current) renderHomeSchedule();
  else if (current.view === 'schedule') renderSchedule(current);
});

// ---------- on the home screen ----------
// Beside the to-dos: today's block on now, with the one before it and as many of
// the ones after as there are lines for (glanceLines, home.js). Between blocks,
// "Free until 15:00" takes the place of the one on now. Hidden when there's
// no schedule for today. Like the schedule screen, it only redraws when a block
// starts or ends.
let homeScheduleTimer = 0;

// Each line is a button so it can be held to tick the block (done, skipped, off
// again), like holding a to-do. A ticked block shows its box before the time, and
// the text struck through (done, ran over) or in italics (skipped). Ran over is
// only set from the Schedule screen.
function homeBlockLine(b, state, mark, day) {
  const status = mark && mark.status;
  const line = document.createElement('button');
  line.className = ['glance-block', state, status && `marked-${status}`].filter(Boolean).join(' ');
  onHoldRelease(line, () => cycleMark(day, b), HOLD_TO_DONE_MS);
  const time = document.createElement('time');
  time.textContent = clock(b.start, true, true);
  const text = document.createElement('span');
  text.className = 'glance-text';
  text.textContent = b.lines.find(Boolean) || '';
  line.append(time, text);
  if (status) line.prepend(markIcon(status, 15));
  return line;
}

function renderHomeSchedule() {
  clearTimeout(homeScheduleTimer);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = dayKey(now);
  const entry = scheduleOn(today);
  const blocks = entry ? parseSchedule(entry.text).blocks : [];
  const ticks = marksOn(today);
  const line = (b, state) => homeBlockLine(b, state, ticks.get(blockKey(b.start)), today);
  const box = $('home-schedule');
  box.hidden = !blocks.length;
  if (blocks.length) {
    const head = document.createElement('span');
    head.className = 'glance-head';
    head.append(categoryIcon(SCHEDULE, 18), 'Schedule');
    box.replaceChildren(head);
    const i = blocks.findIndex((b) => b.start <= nowMin && nowMin < b.until);
    const prev = (i >= 0 ? blocks.slice(0, i) : blocks.filter((b) => b.until <= nowMin)).pop();
    const later = i >= 0 ? blocks.slice(i + 1) : blocks.filter((b) => b.start > nowMin);
    if (prev) box.append(line(prev, 'done'));
    if (i >= 0) box.append(line(blocks[i], 'now'));
    else box.append(textLine('glance-free', later.length ? `Free until ${clock(later[0].start, true, true)}` : 'Done for today.'));
    for (const b of later.slice(0, glanceLines - (prev ? 2 : 1))) box.append(line(b, ''));
  }
  const marks = blocks.flatMap((b) => [b.start, b.until]).filter((m) => m > nowMin);
  const at = Math.min(DAY_END, ...marks);
  const ms = (at - nowMin) * 60000 - now.getSeconds() * 1000 - now.getMilliseconds() + 1000;
  homeScheduleTimer = setTimeout(() => {
    if (!current) renderHomeSchedule();
  }, ms);
}

$('home-schedule').addEventListener('click', (e) => {
  const held = e.target.closest('.glance-block');
  if (held && held.held) return; // the click that ends a hold
  go({ view: 'schedule', date: null });
});

for (const id of ['day-prev', 'day-next']) {
  $(id).addEventListener('click', () => {
    const day = $(id).dataset.day;
    const state = { view: 'schedule', date: day === dayKey(new Date()) ? null : day };
    history.replaceState(state, '');
    render(state);
  });
}

// Both are called straight from the tap, so the keyboard comes up. Edit adds a
// blank line at the end, ready for another block.
$('schedule-edit-btn').addEventListener('click', () => {
  const key = current.date || dayKey(new Date());
  openEditor(SCHEDULE, `${editText(scheduleOn(key), key)}\n`);
});

// The first day from `key` on that has no schedule yet. A weekday heading only
// reaches 6 days ahead, so if the whole week is planned it stays on `key`.
function freeDay(key) {
  const today = keyDate(dayKey(new Date()));
  for (let d = keyDate(key); d <= addDays(today, 6); d = addDays(d, 1)) {
    if (!scheduleOn(dayKey(d))) return dayKey(d);
  }
  return key;
}

// A blank schedule for the first unplanned day from the one on screen: today's
// has no heading, and a later day's starts with its weekday so it's saved for that day.
$('schedule-new-btn').addEventListener('click', () => {
  const today = dayKey(new Date());
  const key = freeDay(current.date || today);
  const head = key !== today ? `${keyDate(key).toLocaleDateString('en-US', { weekday: 'short' })}\n` : '';
  openEditor(SCHEDULE, head);
});

$('schedule-past-btn').addEventListener('click', () => go({ view: 'entries', cat: SCHEDULE }));
