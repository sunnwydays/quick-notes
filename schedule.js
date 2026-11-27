// ---------- schedule ----------
// A schedule is an ordinary note in the Schedule category, kept exactly as it was
// pasted or typed. Its times are read from the text each time it's shown, so the
// original stays as written. Changing a plan saves a new note: the newest one for
// a day is the one used. The week planner (plan.html) is where schedules are shown.

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SCHEDULE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
const REVIEW_START = 21 * 60 + 30;

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

function datedScheduleHeading(key) {
  const date = keyDate(key);
  const weekday = WEEKDAYS[date.getDay()];
  return `${weekday[0].toUpperCase()}${weekday.slice(1)} ${date.getDate()} ${SCHEDULE_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function datedScheduleKey(heading) {
  const match = /^(\w{3}) (\d{1,2}) (\w{3}) (\d{4})$/i.exec(heading || '');
  if (!match) return null;
  const [, weekday, day, month, year] = match;
  const monthIndex = SCHEDULE_MONTHS.findIndex((name) => name.toLowerCase() === month.toLowerCase());
  if (monthIndex < 0) return null;
  const date = new Date(Number(year), monthIndex, Number(day));
  return date.getDate() === Number(day) && WEEKDAYS[date.getDay()] === weekday.toLowerCase() ? dayKey(date) : null;
}

// Dated headings keep their day when edited later. Short headings count from the save date.
function scheduleDay(entry) {
  const saved = new Date(entry.createdAt);
  const head = parseSchedule(entry.text).head;
  const exact = datedScheduleKey(head);
  if (exact) return exact;
  const word = dayWord(head || 'today');
  return dayKey(addDays(saved, dayOffset(word, saved)));
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

function emptyDay() {
  return { template: '', wake: '07:00', blocks: [] };
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
    lines.push(scheduleNoteLine(text, 'To do'));
  }
  for (const block of blocks) {
    const text = block.done ? `${block.text} (done = ${block.done})` : block.text;
    lines.push(`${blockKey(block.start)}-${blockKey(block.until)} ${scheduleProse(text)}`);
    for (const line of (block.next || '').split('\n').filter((line) => line.trim())) lines.push(scheduleNoteLine(line, 'Next'));
  }
  return lines.join('\n');
}

// A typed Schedule has no pin metadata. Recognize named commitments and the
// explicit Fixed: prefix when it's pasted into the planner.
function pinScheduleCommitments(day, previous) {
  const fixedTitle = /^(?:fixed\s*:|breakfast\b|lunch\b|dinner\b|wake\b|walk outside\b|afternoon cardio\b|screens? off\b|wind[- ]down\b|sleep\b|bedtime\b|review$|welding\b|game\b|foosball\b|(?:exam|interview)(?!\s+(?:prep|practice|review)\b)\b)/i;
  const known = previous ? layoutDay(previous).blocks.filter((block) => block.pinned || block.tier === 'fixed') : [];
  return {
    ...day,
    blocks: day.blocks.map((block) => {
      if (block.shelf || block.pinned || block.tier === 'fixed' || block.importedStart == null) return block;
      const prior = known.find((timed) => timed.start === block.importedStart && timed.text === block.text);
      if (!fixedTitle.test(block.text) && !prior) return block;
      return { ...block, pinned: blockKey(block.importedStart), tier: prior?.tier ?? 'fixed' };
    }),
  };
}

// The newest schedule for a day, or undefined.
function scheduleOn(key) {
  return entriesFor(SCHEDULE).find((e) => scheduleDay(e) === key);
}

// To-dos the planner has put on a day: a Map of Todo id -> {order, label, past}.
// A slot still ahead (today's not yet ended, or a later day) wins, the earliest
// if there are several. Otherwise the latest slot already gone by counts, with
// past set, since it's taken as done; moving that block later brings it back.
// A day edited in Dash since the planner saved it only counts blocks whose text
// is still in it. skipWeek leaves out one week's saved plan, for the planner,
// which goes by its own unsaved copy of the week it shows.
function scheduledTodos(skipWeek = null) {
  const now = new Date();
  const today = dayKey(now);
  const tomorrow = dayKey(addDays(now, 1));
  const yesterday = dayKey(addDays(now, -1));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const ahead = new Map();
  const gone = new Map();
  for (const [week, { value }] of plannerNotes(PLAN_WEEK)) {
    if (week === skipWeek) continue;
    for (const [key, day] of Object.entries(value.days || {})) {
      if (!Array.isArray(day?.blocks) || !day.blocks.some((block) => block.todoId)) continue;
      const schedule = scheduleOn(key);
      const stale = (schedule?.id ?? null) !== (value.sources?.[key] ?? null);
      const times = new Map(layoutDay(day).blocks.map((block) => [block.id, block]));
      for (const block of day.blocks) {
        if (!block.todoId) continue;
        if (stale && !schedule?.text.toLowerCase().includes(String(block.text).toLowerCase())) continue;
        const timed = block.shelf ? null : times.get(block.id);
        const start = timed?.start ?? null;
        const past = key < today || (key === today && timed?.until != null && timed.until <= nowMinutes);
        const order = `${key} ${start == null ? 'zz' : String(start).padStart(4, '0')}`;
        const into = past ? gone : ahead;
        const have = into.get(block.todoId);
        if (have && (past ? have.order >= order : have.order <= order)) continue;
        const dayName = key === today ? 'Today' : key === tomorrow ? 'Tomorrow' : key === yesterday ? 'Yesterday' : dayLabel(key);
        into.set(block.todoId, { order, past, label: start == null ? dayName : `${dayName} · ${clock(start, true, true)}` });
      }
    }
  }
  for (const [id, slot] of gone) if (!ahead.has(id)) ahead.set(id, slot);
  return ahead;
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
  } else if (!datedScheduleKey(head)) {
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

// ---------- on the home screen ----------
// Beside the to-dos: today's block on now, with the one before it and as many of
// the ones after as there are lines for (glanceLines, home.js). Between blocks,
// "Free until 15:00" takes the place of the one on now. Hidden when there's
// no schedule for today. It only redraws when a block starts or ends: each
// redraw flashes an e-ink screen.
let homeScheduleTimer = 0;

function homeBlockLine(b, state) {
  const line = document.createElement('div');
  line.className = ['glance-block', state].filter(Boolean).join(' ');
  const time = document.createElement('time');
  time.textContent = clock(b.start, true, true);
  const text = document.createElement('span');
  text.className = 'glance-text';
  text.textContent = b.lines.find(Boolean) || '';
  line.append(time, text);
  return line;
}

function renderHomeSchedule() {
  clearTimeout(homeScheduleTimer);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = dayKey(now);
  const entry = scheduleOn(today);
  const blocks = entry ? parseSchedule(entry.text).blocks : [];
  const line = homeBlockLine;
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

// Timers stall while the app is in the background, so catch up on return.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && $('home-schedule') && !current) renderHomeSchedule();
});

$('home-schedule')?.addEventListener('click', () => {
  location.href = 'plan.html';
});
