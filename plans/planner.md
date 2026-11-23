# Planner: drag-and-drop week planning for Dash

A second page in this repo, `plan.html`, for planning a week on a laptop. Blocks stack like Scratch, times come from the stack order, and Save writes normal Schedule notes, so the phone and Boox keep showing the day exactly as they do now. Dash itself stays simple.

Evidence behind the rules: `C:\Users\iF3LL\Documents\code grind\_coding_interview_prep\planning\planner_design_inputs.md` (referred to below as "inputs"). Read it before changing a default.

## Decisions already made

| Decision | Choice | Why |
| --- | --- | --- |
| Where it lives | `plan.html` in this repo, plain JS, no build step | Shares login, sync, `parseSchedule` and the Supabase tables. Nothing to import. |
| Framework | None. One `plan` object, redraw on every change. Add [SortableJS](https://sortablejs.github.io/Sortable/) as a single file only if hand-written dragging gets fiddly. | Small UI, no shared state across panels. |
| Block sizes | 30 / 45 / 60 / 90 min, fixed. No resize handle. | 45 is what worked in the Nov 15–16 crunch; 61–90 min blocks went 2 done / 18 missed. Fixed sizes make snapping and swapping trivial. |
| Times | Computed from stack order + pinned anchors. Never typed. | Removes the retype on every re-cut (4–6 revisions a day). |
| Sleep | 23:00–07:00. Screens off 22:00. 22:00–23:00 is a non-screen block (read, walk, paper). | Current target. The old "nothing after the 21:30 review" rule is dropped. |
| Scheduling a todo | **Copies** it. The Todo note stays until ticked in Dash; the tray shows a small clock on todos that already have a block. | No added friction. Concrete todos get done without a block anyway. |
| Auto-scheduling | Suggest only (ghost blocks). Nothing is placed without a tap. | A plan you didn't make is easy to ignore, and auto-reshuffle would recreate the re-cut churn. |
| Marking blocks | Stays in Dash as it is (one tap, latest mark wins). | Marking stopped after Nov 9; the planner shows the unmarked count instead of adding more marking UI. |

## Data model

Everything is stored as notes in hidden categories (like the Transfer pads: no category row, never shown as a project, never in search or Export). That reuses `qn_entries` sync with no schema change. One note per thing, newest wins, old versions kept as history.

| Category | One note per | Contents (JSON) |
| --- | --- | --- |
| `Plan week` | ISO week (`2026-W48`) | `{ days: { "2026-11-23": { template, phoneOff, wake, blocks: [...] } }, tray: { week: [...] } }` |
| `Plan template` | template name | `{ name, anchors: [...], startOffset, deepCap }` |
| `Plan goals` | week | `{ "Study": { hours: 25, colour }, "Chess": { hours: 7 }, ... }` keyed by Working on note id |

A block is:

```js
{
  id, text, size: 30|45|60|90,
  shelf: false,                        // true = committed to the day, not timed yet
  goal: <Working on note id> | null,   // colours the block and feeds the goal bar
  tier: 'fixed'|'must'|'high'|'medium'|'low',
  pinned: 'HH:MM' | null,              // anchors (from template or dragged to a time)
  todoId: <Todo note id> | null,       // when it came from the tray
  tail: minutes,                       // exercise shower/food tail, part of the block's height
  done: 'what finished looks like',    // project blocks only
  next: '',                            // written at day review; becomes tomorrow's block text
}
```

The week tray needs no storage: **This week** = live `Todo`, **Someday** = `Back burner`, **Goals header** = `Working on`. The planner reads them straight from `data.entries`. Dedupe Schedule rows on (day, text) when reading history (inputs §0).

**Each day also has a shelf**: a strip at the top of the column for things committed to that day but not timed yet ("do it Thursday, whenever"). Shelf items are blocks with `shelf: true` in the day's `blocks` array; they aren't laid out and don't count toward load. Dropping a tray item on the shelf commits it to the day; dropping it into the stack times it. Dragging shelf → stack times it, stack → shelf untimes it. Ghost suggestions for a day are built from its shelf first, then the week tray. On Save, shelf items go out as note lines under the day heading, before the first time, so Dash shows them as the day's intro text. Bumped blocks land on their own day's shelf, not the week tray, unless the day is over.

**Pinning**: any block can be pinned to a clock time (`pinned: 'HH:MM'`). Template anchors come pinned; a dragged block pins when dropped on a time rather than between blocks; the popover has a pin toggle with a time field. Pinned blocks never move when the stack is re-timed, and flexible blocks flow around them. `tier: 'fixed'` is for commitments that can't be bumped either (interview, game, welding, meals, sleep); a pinned block with another tier can still be dropped by Woke at… if the day no longer fits.

## Layout

```
┌ Goals ─────────────────────────────────────────────────────────────────────┐
│ Study ████████░░ 14/25h   Chess ██████ 6/7h   Fitness ████░░ 5/8h   Lab ██ 2/2h │
├ Tray ───────┬ Mon 23 ─┬ Tue 24 ─┬ Wed 25 ─┬ Thu 26 ─┬ Fri 27 ─┬ Sat 28 ─┬ Sun 29 ┤
│ This week   │ 📵 ⏰7:00│         │ ★ 9:30  │         │         │ ★ Game  │ Weld   │
│             │ shelf:  │ shelf:  │ shelf:  │ shelf:  │         │         │        │
│             │ cut nail│ –       │ –       │ prelab  │         │         │        │
│ ▭ ece311 lab│ ▬ wake  │ ▬ wake  │ ▬ wake  │ ...     │         │         │ 9–17   │
│ ▭ interview │ ▬ walk  │ ▬ walk  │ ▬ chess │         │         │         │        │
│   prep  🕒  │ █ chess │ █ chess │ ★ intvw │         │         │         │        │
│ ▭ photos→Mom│ █ chess │ █ chess │ ▬ lunch │         │         │         │        │
│   (27d) ✂   │ ▬ lunch │ ▬ lunch │ ▒ free  │         │         │         │        │
│             │ ▒ free  │ ▒ free  │ ░ ghost │         │         │         │        │
│ Someday     │ █ lab   │ █ study │   study?│         │         │         │        │
│ ▭ blog      │ █ lab   │ ...     │         │         │         │         │        │
│ ▭ foos      │ ▬ dinner│         │         │         │         │         │        │
│   ...       │ ──── load 78% ── │         │         │         │         │        │
└─────────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴────────┘
[ ‹ week › ]  [ Now… ]  [ Woke at… ]  [ Save to Dash ]
```

- **Height = minutes.** A 45 block is 1.5× a 30. Gaps are thin grey strips, anchors have a flat colour, ghosts are dashed outlines.
- **Columns scroll together** so 11:30 lines up across days.
- Click a block to edit text / size / goal / tier / done / next in a small popover. Double-click to delete.
- Day header: date, phone-off toggle (📵), wake time, template name, pinned events (★).
- Day footer: load bar and warnings (see Rules).

## Core mechanics

### Stacking and timing
1. Start at the day's `wake` (default 07:00; template may offset).
2. Walk the stack. Pinned blocks sit at their time. Flexible blocks fill from the top: each starts at the previous block's end + gap. If a flexible block would overlap a pinned one, it moves after it.
3. `until` of the last block ≤ 22:00. Anything past that is **bumped**: it returns to the tray with a "bumped from Thu" tag, lowest tier first. Never bump fixed blocks (sleep, meals, review).
4. Dragging within a day reorders the stack and re-times everything below. Dragging onto a pinned anchor's slot pins the block at that time instead.

### Gaps and breaks (inputs §4)
- Gap after a block: 10 min after 30/45/60, 15 min after 90. Drawn, not draggable.
- A **named free block of 25 min right after lunch** is in every template. It's a real block so it can hold a walk, reading or a small pop-up.
- Daily slack: at least 45 min of buffer on a full day. The template includes one 45 `buffer` block mid-afternoon (worst window: 12–17).
- Exercise blocks carry a `tail` (default 30 min) drawn as a lighter section of the same block.

### Load bar and warnings
Fixed items (routine, meals + dishes, walk, exercise, review, 22:00 wind-down) don't count toward load. Of the remaining time, warn (amber) at 75%, red at 90%. Also warn when:
- more than 4 deep blocks (`high`/`must` work) on one day,
- any gap under 5 min,
- no free/buffer block,
- a project block isn't followed by a meal or pinned anchor,
- a study block directly follows an AI-tutor/project block,
- a prep block lands after its deadline (greyed out),
- a tray todo is 5+ days old (shows ✂ "split into a first step"),
- a day has 10+ parked `ai-tutor` ideas (drift), shown on the day header after the fact.

### Goal budgets
Each `Working on` note can be given weekly hours and a colour in the Goals header. Placing a block tagged with that goal fills its bar. Blocks with no goal render grey so off-goal time is visible. The header also shows total placed vs. usable hours for the week.

### Ghost blocks (suggestions)
For each tray item with no block yet, the planner proposes one slot per day, drawn as a dashed ghost in the first gap that:
- fits the item's default size (45 unless the todo text has a size like `30m`),
- keeps that goal under its budget and the day under 75%,
- obeys the ordering rules below.
One click turns a ghost solid. Ignoring it costs nothing. Only one ghost per tray item is shown at a time (the earliest fit), and ghosts never appear on days marked `social`/`recovery`.

Ordering rules the suggester follows and the warnings enforce (inputs §5):
1. A deliverable due tomorrow goes in today's first work slot.
2. Study before any AI-tutor/project block; a project block ends on a meal.
3. Prep for a next-day event goes before the flow project.
4. "Almost done" low-tier items go right before a fixed item, never at the start of an open evening.
5. Open-ended fun never last; it goes before dinner.
6. No new material the night before an exam or interview.

### Pop-ups ("Now")
Something comes up mid-day:
- **Now…** button (or `now …` / `asap …` as the first word of a Dash note) adds a block at the next block boundary of today.
- ≤15 min pop-ups go into the next gap, free or buffer block without pushing anything.
- Longer ones push the rest of the stack down; anything past 22:00 is bumped to the tray with a "bumped from today" tag so the cost is visible.
- Dash side: `autofile.js` gets a cue for `now`/`asap` that files into Todo with a `now:` prefix; the planner treats such todos as pop-ups for today.

### Restack buttons (the two biggest re-plan triggers, inputs §2b/g)
- **Woke at HH:MM** sets the day's wake, shifts the flexible stack, keeps pinned anchors, bumps low tier first.
- **Ran over until HH:MM** on a block does the same from that block down and records an `over` mark (reusing `qn_block_marks`).
- Both are also offered from Dash's schedule screen as one-tap actions later (phase 4).

### Templates (inputs §3)
Stored as `Plan template` notes; applying one replaces the day's anchors, keeps flexible blocks.
- **Weekday** (default): 07:00 wake · 07:00–07:45 breakfast + routine · 07:45–08:15 walk · 11:30–12:20 lunch + dishes + read · 12:20–12:45 free · ~14:10 buffer 45 · 17:00–17:50 dinner + dishes · 21:30–21:45 review · 22:00–23:00 screens off.
- **Exam / interview day**: light recall only; nothing new after 16:00; "go + settle" 30 min before the event.
- **Recovery / social**: wake 09:30, two work blocks max, no ghosts. Auto-suggested when yesterday ended after 00:30 (journal timestamp or a late social block).
- **Welding Sunday**: 09:00–17:00 pinned, one evening review block.
- **Game day**: event pinned with 30 min travel; no work after it.

### Save to Dash
`Save to Dash` writes one Schedule note per changed day in the exact text format `parseSchedule` reads, e.g.

```
Mon 23 Nov
07:00-07:45 Wake + breakfast + routine
07:45-08:15 Walk outside
08:25-09:10 Chess: tactics set 3 (done = 20 puzzles)
...
```

- Unchanged days are skipped (`changesSchedule`).
- Block text goes out as `text` plus ` (done = …)` when set; `next` is appended as a note line under the block.
- Saving also stores the `Plan week` note so the layout can be reopened.
- A day already edited in Dash since the last save shows a "changed on phone" badge; Save asks which wins.

### Day review (phase 3)
At 21:30 the page (if open) or Dash's schedule screen shows the day's blocks with one-tap marks and a `NEXT:` field on project blocks. The `next` text becomes the default text of the next scheduled block for that goal. Shows "N blocks unmarked" on the week header so marking doesn't silently stop again.

## This week's budget (so the first real use has numbers)

Awake 07:00–22:00 minus routine, meals, post-lunch free, gaps and the exercise tail is about **10.5h usable**, so ~8.5h at the 75–80% line.

| Day | Chess | Fitness | Study (incl. 311 lab) | Notes |
| --- | --- | --- | --- | --- |
| Mon 23 | 2h | 1.5h | 2h lab + 1.5h | lab first, before chess |
| Tue 24 | 3h | 1h | 2h | exam/interview template tomorrow |
| Wed 25 | 45m warm-up | 1h | 3h | ★ chess.com interview 9:30 |
| Thu 26 | — | 1h, short and sharp | 4–5h | 45-min blocks, phone off |
| Fri 27 | — | 30m walk/throw | 4–5h | |
| Sat 28 | — | ★ Game | 2h | game template |
| Sun 29 | — | — | 1h evening | welding 9–17 |

Goals header defaults: Chess 6h, Lab 2h, Fitness 6.5h (not 21h: tapering while sick, game Saturday), Study 20h (4h/day target, 5th hour a bonus).

## Build phases (one commit per step, push after each phase)

**Phase 1 – static week (no drag yet)**
1. `plan.html` + `plan.css` + `plan.js`, loading `data.js`, `sync.js`, `login.js`, `schedule.js`. Add all three to `sw.js` `FILES`; bump `CACHE`.
2. Hidden categories `Plan week`, `Plan template`, `Plan goals` (same mechanism as `PADS`: no category row, excluded from search/Export/project list).
3. Render tray (Todo / Back burner / Working on header), each day's shelf, and 7 columns from the stored `Plan week` note or the saved Schedule notes for that week (`parseSchedule` → blocks with `pinned` where the text had a range).
4. Stacking + timing engine as pure functions (`layoutDay(day) → blocks with start/until`), unit-tested in `tests/plan.test.mjs` with `node --test`.
5. Save to Dash (write Schedule notes).

**Phase 2 – interaction**
6. Drag tray→shelf, tray→stack, shelf↔stack, day→day, reorder, drag back to tray (pointer events; fall back to SortableJS if needed). Drop on a time pins. Block popover (text, size, goal, tier, pin + time, done).
7. Templates: weekday / exam / recovery / welding / game. Apply from day header.
8. Load bar + warnings. Goal budgets + header bars.
9. Woke at… / Ran over… restack.

**Phase 3 – suggestions and pop-ups**
10. Ghost blocks.
11. Now… button; `now`/`asap` cue in `autofile.js`; bumped tags.
12. ✂ split prompt on 5+-day tray items; drift badge from `ai-tutor` counts.
13. Day review view with marks + NEXT.

**Phase 4 – Dash-side touches**
14. "Woke at" / "Ran over" one-tap on Dash's schedule screen (re-times the saved note using the same engine; schedule.js already has the parser).
15. Link in ☰ menu ("Plan week"), opens `plan.html`.
16. README + Help text.

## Done when
- A week can be laid out from the tray by dragging, saved, and shows up on the phone as today's schedule with no manual retyping.
- Woke at… re-times a day in one tap and nothing fixed moves.
- Ghost blocks appear for unscheduled todos and one click accepts them.
- Now… inserts a pop-up and shows what it bumped.
- Load bar and goal bars reflect the placed blocks; this week's budget above can be entered as is.

## Open questions (decide while building, defaults in bold)
1. Block names: course-level name + optional sub-step checklist, or **one concrete line with `done =`** (inputs §6.1)?
2. Exercise slot: **afternoon cardio as the 14:10 reset**, gym in the morning only after breakfast + walk (inputs §6.2).
3. Should weekends get a full plan or **a short must-list plus pinned events** (inputs §6.8)?
4. Does a Todo tick count as done, or **only a block mark with an end time** (inputs §6.11)? Affects any stats view later, not phase 1–3.
