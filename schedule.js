// ---------- schedule ----------
// A schedule is an ordinary note in the Schedule category, kept exactly as it was
// pasted or typed. Its times are read from the text each time it's shown, so the
// original stays as written. Changing a plan saves a new note: the newest one for
// a day is the one shown, and every version stays under All saved.

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// A line that starts with a day: "Sun (full day)", "Monday:", "Tue 27 Oct", "Tomorrow".
// What follows the day has to look like a heading, so "Sat runs late" stays text.
const DAY_HEAD = /^(today|tomorrow|sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?)\.?(?=\s*(?:$|[(:,–—-]|\d|[a-z]{3,9}\.?\s+\d))/i;
// 9:00, 14:30, 9am, 2:30 p.m., and plain numbers: 10, 830, 1030. Groups: hour,
// the colon (or ''), minutes, a/p. Whether a plain number counts is up to readTime.
const TIME = String.raw`(\d{1,2}?)(?:(:?)([0-5]\d))?(?!\d)(?:\s*([ap])\.?\s?m\b\.?)?`;
const TIME_AT = new RegExp('^' + TIME, 'i');
const TO_TIME = new RegExp(String.raw`^\s*(?:-|–|—|to)\s*` + TIME, 'i');
// "17:00 dinner, 17:45 chess" is two blocks: a comma or semicolon followed by a time starts a new one.
const NEXT_BLOCK = /[,;]\s+(?=\d{1,2}(?::[0-5]\d|\s*[ap]\.?\s?m\b))/i;
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

function clock(min) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

// {head, intro, blocks}. head is the day heading line, intro the lines before the
// first time. Each block is {start, end, until, lines}: end is the end time as
// written (or null), until is when it's over (end, else the next block's start,
// else midnight). A line with no time joins the block above it.
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
      // A bare number only starts a block if it comes after the one above
      // (counting afternoon, so "1 lunch" after "10 brunch" is 13:00); otherwise
      // it's a line of that block, like "5 sets" under "20:00 gym".
      if (!start || (start.bare && last && at <= last.start)) {
        (last ? last.lines : plan.intro).push(part);
        continue;
      }
      const block = { start: at, end: null, lines: [] };
      let rest = part.slice(start.length);
      const end = readTime(rest, TO_TIME);
      if (end) {
        block.end = minutes(end, block.start);
        rest = rest.slice(end.length);
      }
      block.lines.push(rest.replace(/^[\s:.,;–—-]+/, ''));
      plan.blocks.push(block);
    }
  }
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

function blockRow(b, state) {
  const div = document.createElement('div');
  div.className = state ? `block ${state}` : 'block';
  const time = document.createElement('time');
  time.textContent = b.end != null ? `${clock(b.start)}–${clock(b.end)}` : clock(b.start);
  div.append(time);
  if (state === 'now') {
    const now = document.createElement('b');
    now.className = 'block-now';
    now.textContent = b.until < DAY_END ? `Now, until ${clock(b.until)}` : 'Now';
    div.append(now);
  }
  div.append(textLine('', b.lines.filter(Boolean).join('\n')));
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
  $('schedule-day').textContent = isToday ? `Today, ${dayLabel(key)}` : dayLabel(key);
  $('schedule-edit-btn').textContent = entry ? 'Edit' : 'New';
  $('schedule-edit-btn').hidden = key < today;

  const box = $('schedule-list');
  box.replaceChildren();
  const plan = entry ? parseSchedule(entry.text) : { head: null, intro: [], blocks: [] };
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (!entry) {
    box.append(textLine('empty', 'No schedule for today. Tap New, then paste one or type a line per block, like "9:00-11:30 Foosball".'));
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
    for (const b of plan.blocks) {
      const d = done.indexOf(b);
      if (d >= 0 && d < hidden) continue;
      if (b === nextBlock) box.append(textLine('free', `Free until ${clock(b.start)}`));
      box.append(blockRow(b, d >= 0 ? 'done' : b === nowBlock ? 'now' : ''));
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
  if (!document.hidden && current && current.view === 'schedule') renderSchedule(current);
});

for (const id of ['day-prev', 'day-next']) {
  $(id).addEventListener('click', () => {
    const day = $(id).dataset.day;
    const state = { view: 'schedule', date: day === dayKey(new Date()) ? null : day };
    history.replaceState(state, '');
    render(state);
  });
}

// Called straight from the tap, so the keyboard comes up. A blank line is added
// at the end, ready for another block.
$('schedule-edit-btn').addEventListener('click', () => {
  const key = current.date || dayKey(new Date());
  const entry = scheduleOn(key);
  openEditor(SCHEDULE, entry ? `${editText(entry, key)}\n${BULLET}` : BULLET);
});

$('schedule-past-btn').addEventListener('click', () => go({ view: 'entries', cat: SCHEDULE }));
