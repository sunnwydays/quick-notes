# Dash

One-tap dictation notes for Android phones and Boox e-readers. Tap a category to read its notes; hold it and let go to write one with the keyboard up, ready for Gboard voice typing.

Live: https://dash-notes.vercel.app

## Using it

**Install:** open the link in Chrome, ⋮ → **Add to Home screen**. On a Boox, use Chrome, not the built-in browser.

**Write a note:** hold a category until it turns black and let go. The text box opens with `- ` and the keyboard up. Enter adds the note and resets the box (in a Schedule, Enter starts a new `- ` line instead); a note already in that category isn't added twice. **Save** or Android's back button saves and goes home; **Discard** throws it away. Drafts are saved as you type and reopen if the app closes.

**Add note** (the big button in the middle) files each note by its first words:
- A folder's name or a word for it goes there and is removed: `bring blender` → `- blender` in Bring. Words, including Gboard mishearings, are in `FOLDER_WORDS` in `autofile.js`.
- A project's own name works too.
- `I think …` / `I feel …` → Thought, `today was …` → Journal, keeping the words (`FOLDER_CUES`).
- `now call the dentist` or `asap call the dentist` → Todo as `now: call the dentist`. The planner offers it under **Fit in now**.
- Anything else → Todo. Schedule is never picked.

**Home screen:** built-in categories are circles in a "flower" round **Add note**; projects sit above them. Icons are SVG so they stay sharp on e-ink. Under the header are a few unscheduled to-dos (newest, then the oldest with its age) and today's schedule (the block on now in black). Hold a to-do or schedule line to tick it (`HOLD_TO_DONE_MS`). The document icon opens **Transfer** and the calendar icon opens the **Week planner**. The ☰ menu holds **New project**, **Export**, **Help** and **Log in**. Help's text lives in `index.html`, so update it when behaviour changes.

**Search:** the box at the top shows every note containing all the typed words, grouped by category.

**Read:** tap a category to see its notes, newest first, with Delete and Replace (delete and write the next one; not in Todo, Journal, Thought, Bring, Working on or Back burner). In Todo, Bring, Working on, Back burner, Discord and projects, a tick marks a note done; swipe to delete without counting it done. Everything has Undo. **Show times** is remembered per category. Double-tap or hold a blank spot to go back.

**Todo:** to-dos the planner has put on a day (today or later) sit under **Scheduled** at the bottom, soonest first, each with its day, and its time if it has one.

**Back burner:** the lower half of the Working on screen, for goals set aside for later (no button of its own). ↓ on a Working on note, or the flame on a Todo note, moves it there; ↑ moves it back up to Working on. Tap its heading to fold it away; its **Add** writes straight into it, and Add note files `back burner …` there. A move deletes the note (`deleted_how = 'moved'`) and saves a copy on top of the other list.

**Projects:** ☰ → **New project**. To remove one, open it and tap **Remove project** (deletes its notes).

**Schedule:** tapping Schedule (or today's schedule on home) opens the Week planner. Schedules are still saved as notes in the Schedule category, one per day. To write one as text, hold Schedule or tap **Paste** in the planner, one block per line:

```
Sun (full day)
7:15-8:45 IBM OA: 30m prep, then the real thing
11:30 lunch
17:00 dinner, 17:45 chess, 18:30 job apps
No new material after that, early night
```

- A block starts with a time or range (`9:00`, `9am`, `10:30 to 12`, or bare `10`/`830` if it follows the block above). Without am/pm, a time earlier than the last one counts as afternoon. Lines without a time are notes under the block above; a comma then a time starts another block.
- A line starting with a day (`Sun`, `Tomorrow`, `Tue 27 Oct`) starts that day's schedule, so a multi-day paste fills one day each. Without a heading it's today.
- **Paste** replaces each named day in the planner, after asking. Undo reverses it for days in the open week. Start a title with `Fixed:` to pin it at its time; meals, wake, sleep, exams and games are pinned too.
- Removed features are listed in [docs/removed-features.md](docs/removed-features.md).

### Week planner

Open the **calendar icon** in Dash's home header. Drag a Todo onto a day's **Untimed** shelf to commit to the day, or into the timeline to give it a time. Scheduling copies the Todo and hides it from the planner's To Do while it's on a day. The original stays in Dash, where you can still tick it. Renaming or deleting a scheduled block does the same to its Todo, and the block editor's tick marks the Todo done while the block stays on the day. Open the planner and it scrolls to the current time. Click a block to rename it, or change its length, goal, **Day** and **Starts**. A new day or time is placed like a drop and stays unpinned unless 📌 is on; **To do (no day)** sends it back to the week tray. The editor's **+15m**, **Later today**, **Tomorrow** (that day's To do shelf) and **To do** buttons reschedule in one tap, and Undo reverses them. Kind and Copy to sit under **More**. When adding an item, type a time and/or length in its title (`gym 5pm 1h`, `call mom 30m`, `study 454 9-11`); a hint shows what will be used. Pinned blocks have a hatched stripe, finished blocks fade, and each day's load shows in its header. Click a day's name to open its menu: **Template…** adds the template's blocks at their usual times and **Woke at…** restacks it. Template blocks aren't pinned, so other blocks can push them; tick **Pinned event** on a block in **Edit template** to pin it. Use **Routine** in the header to pick a template for each remaining day of the week in one window: tap a day on the left, then its template on the right (every day starts as Weekday). After a late night, pick **Recovery / social** for the next day: up by 09:00, a morning walk, a nap of at most 25 minutes and the usual bedtime. Click a **Working on** goal to set its weekly hours.

- Deleting, shrinking, or renaming a block leaves the surrounding schedule in place. A pin stays attached when you drag its block to another time or day. Clear **Pin** in the editor to release it. For timeline drops, see [Rescheduling a block](#rescheduling-a-block).
- Dashed outlines with a **+** are suggestions. The planner checks the day's shelf first, then the week tray. It stays below 75% load and respects goal budgets. Click a ghost to schedule it. Old Todos prompt you to split off a first step, and days with at least ten parked AI tutor ideas show a drift badge.
- **Fit in now** fits an interruption into today. Up to 15 minutes uses a gap, free time, or a buffer. Longer interruptions restack the day and return bumped blocks to the tray.
- **Review today** shows the day's blocks with Dash's marks. Apply **NEXT** on a project block to carry the text into the next timed block for that goal.
- On a phone or Boox (under 700px wide) the planner shows the tray beside one day; an empty To Do shrinks to a strip. Switch days with the tabs or by swiping sideways on the day (past Monday or Sunday goes to the next week), or drop a block on a tab to move it to that day. Tap the open day's tab for its Template and Woke at menu. Normal swipes scroll; hold a block for about a third of a second (it lifts and the phone buzzes) to drag or resize it. Tap **Goals** to show the goal chips.
- The planner saves itself a second after each change, writing changed days as normal Schedule notes (no save button). Log in on both devices to see the plan on your phone or Boox.
- Items added in the planner (**+**, a To do shelf, or drawing on a timeline) are also added to Todo, unless their kind is Free, Buffer, Meal or Routine; an existing Todo with the same text is linked instead.
- The circle on an item in the week's To Do or a day's To do marks it done: it leaves the planner, and so does its Todo. **Undo** brings both back.
- When adding a timed item, the gray **Buffer** link next to Cancel saves that time as a Buffer in one tap.

#### Rescheduling a block

Drop an event just above **Shower and read** to finish when the routine begins. For a 45-minute event before a 10 PM shower, the preview shows **9:15–10:00 PM**.

| Neighboring blocks | Break between them |
| --- | --- |
| Either block is a routine, meal, exercise or buffer | 0 minutes |
| Other blocks, earlier session under 35 minutes | 5 minutes |
| Other blocks, earlier session 35 minutes or longer | 10 minutes |

**Shower and read** and **Morning wash up and walk** count as routines. Names like gym, run, intramurals, scrim, prac or throw count as exercise, and travel, commute, TTC, Uber or go count as travel. You can also set a block's kind in the editor. The break uses the actual scheduled length of the earlier session.

- **Resize in place.** Drag the bottom edge or change **Length** in the editor. Pinned and unpinned blocks use the free time below first. Once the end reaches the next block or midnight, extra minutes move the start earlier. Neighboring blocks stay put, and a pin follows the new start. For example, a 70-minute Buffer before a 10 PM shower can run from 8:50 to 10 PM. When both sides are full, the drag stops and the editor tells you how many minutes fit.
- **Watch the drop.** Once a drag starts, a small copy of the card follows the pointer (above your finger on touch). The day shows the result: the block where it lands, other blocks at their new times, and a solid blue line when it's inserted before or after a block. Release applies exactly that; Esc or a cancelled touch puts everything back.
- **Place it before or after.** With the pointer over a block, its upper half means before it and its lower half means after it, wherever you grabbed the card. Halves are judged against the day as it was when the drag began, so they don't flip as previews slide. After a block means after its break: if Study 454 ends at 7:30 PM after 75 minutes, another study task lands at 7:40 PM. Before a block uses the space above it if there's room, otherwise it takes that spot and shifts flexible work later. For example, with Upload travel photos 1:30–2:15 PM, Workout 2:15–3:15 PM and a 90-minute deer project, before Workout gives deer project 2:25–3:55 PM and Workout 4:05 PM; after Workout gives 3:25 PM. Dropping in open time keeps the gap you chose, apart from snapping out of a break or just clear of the next block.
- **Fit the session.** The planner tries the original duration and shifts flexible work later when necessary. Pinned blocks and recorded times hold their positions. When one limits the opening, the preview can shorten the dragged session if at least 70% of the original duration fits, rounded up to the next whole minute. Dragging a shortened block again uses its original estimate. An explicit resize sets a new estimate.
- **Choose another slot.** A refused drop leaves the task in place. The planner highlights up to three full-length openings across the drop day and later days in the displayed week, with at most one per day. Click a suggested time, click its grid highlight, or drag the task onto it. Highlights pulse between 45% and 72% opacity for three seconds, then settle at 72%. Reduced motion keeps them steady.
- **Skip one break.** If skipping the dragged session's outgoing break makes it fit, choose **Skip break this time**. For example, Dinner ends at 6:05 PM and Workout starts at 6:30 PM. A 35-minute practice needs at least 25 minutes. Keeping its five-minute break leaves only 20 minutes. Skipping the break schedules practice from 6:05 to 6:30.
- **Keep the remainder.** After a squeeze, **Keep remaining minutes in To do** puts the leftover time on that day's shelf and makes the two portions independently sized sessions. Otherwise the original estimate stays available for a future move. **Undo** reverses the latest change.

**Transfer:** three text boxes for copying text between computers, at `/#transfer/1` to `/#transfer/3`. They sync like notes (needs login on both sides), autosave a second after typing, and poll every 5 s (`PAD_POLL_MS`). **Previous** swaps in the last overwritten text (two kept, `PAD_KEEP`). No file support.

**On a computer:** Esc goes back (saving in the editor); Ctrl+Enter/Ctrl+S saves; A/E opens the editor; 1–8 open the built-in categories; / searches; on the notes screen ↓↑ or J/K pick a note, X ticks, Delete deletes, R replaces, B moves to or from Back burner; T toggles times, U/Ctrl+Z undoes, ? opens Help. Single keys don't fire while typing. Full list in Help.

**Back up:** **Export** downloads every note as `.txt`; **Copy all** copies a category.

**Sync:** ☰ → **Log in** with your email and the emailed code, once per device. Optional; without it notes stay on the device. The cloud icon shows sync state; logged out, it reads **Log in** and tapping it opens login.

**Offline:** works with no internet after the first load; changes sync later. For offline voice typing, download Gboard's offline speech pack.

## How it works

Plain HTML, CSS and JS: no framework, no build step. The JS files are plain `<script>` tags sharing one global scope, loaded in `index.html` order; top-level code can only use files above it. Add any new file to `sw.js`'s cache list too.

| File | What it does |
| --- | --- |
| `index.html` | The six screens as `<section>`s (one shown at a time), plus Help's text. |
| `data.js` | Constants, saved data (`data`) and helpers. |
| `views.js` | Screen switching, history/back, Undo banner, reload after deploy. |
| `gestures.js` | Hold-and-release, double-tap and hold-to-go-back. |
| `home.js` | Home screen, ☰ menu, New project, Add note. |
| `editor.js` | Note editor: Enter to add, drafts, Save/Discard. |
| `autofile.js` | Picks Add note's folder. |
| `search.js` | Search. |
| `entries.js` | Notes screen. |
| `transfer.js` | Transfer pads (hidden categories `Transfer 1`–`3`). |
| `schedule.js` | Schedule parsing, block marks, and the home schedule column. |
| `plan.html`, `plan.css`, `plan.js` | Week planner, tray, templates, budgets, and review. |
| `plan-engine.js` | Timing and restacking shared by the planner and Schedule. |
| `export.js` | Export and Copy all. |
| `sync.js` | Supabase sync. |
| `login.js` | Email-code login. |
| `help.js` | Opens Help. |
| `keys.js` | Keyboard shortcuts. |
| `main.js` | Startup, loaded last. |
| `schema.sql` | Supabase tables, RLS and triggers. |
| `style.css` | E-ink friendly: black on white, big targets, no shadows or animations. |
| `sw.js` | Service worker caching the app for offline. |
| `manifest.json`, `icons/`, `fonts/` | PWA metadata, icons, Atkinson Hyperlegible and Literata. |

**Data** lives in `localStorage` under `quicknotes`:

```json
{
  "categories": [
    { "name": "Todo", "updatedAt": "1970-01-01T00:00:00.000Z", "deletedAt": null, "dirty": false }
  ],
  "entries": [
    { "id": "lq3x9a2k4f", "category": "Todo", "text": "- buy milk", "createdAt": "2026-10-23T18:05:00.000Z",
      "updatedAt": "2026-10-23T18:05:00.000Z", "deletedAt": null, "dirty": false }
  ]
}
```

Deletes set `deletedAt` (a tombstone) so they can sync; `dirty` means not uploaded yet. The draft is in `quicknotes-draft`. Startup calls `navigator.storage.persist()`.

**Back button:** each screen pushes a history entry, and the editor saves in `popstate`, so Save (`history.back()`) and the hardware back button behave the same.

**Keyboard on tap:** Android only raises the keyboard when focus comes straight from a real tap, so `textarea.focus()` must run in the click/`pointerup` handler, never in a timeout or async callback.

**Enter adds the note:** caught on `keydown`, on `beforeinput` (`insertLineBreak`, since Gboard sends key code 229), and as a fallback in `input`. On save, each non-empty line becomes its own note, a millisecond apart.

**Updates:** `sw.js` serves from cache and refreshes in the background. When a file changed, open pages reload ~2 s later (`reloadForUpdate`), but only on home with search empty or on a saved Transfer pad, so nothing typed is lost. Supabase requests always go to the network.

**Sync:** tables `qn_entries`, `qn_categories` and `qn_block_marks` in the Supabase project `job-tracker` (`schema.sql`). RLS limits each account to its own rows, so the publishable key in `sync.js` is safe. Plain `fetch`, no library. Each sync pushes `dirty` rows, pulls rows with `synced_at` after the cursor (`quicknotes-sync`), and merges: notes are a union by id with deletes winning; categories take the newer `updatedAt`. Triggers enforce the same rules server-side. Block marks are insert-only; the newest `marked_at` per `(day, block_start)` wins. Claude reads them via the Supabase MCP at the evening review. Sync runs on open, on focus, on reconnect, every minute while the page is visible and after each change, never blocks the UI, and failures just stay `dirty`. Tabs share `localStorage`, so storage is re-read before saving after a network wait ([docs/two-tabs-sync-bug.md](docs/two-tabs-sync-bug.md)).

**Login:** Supabase emails a one-time code (`/auth/v1/otp`, `create_user: false`; the Magic Link template must include `{{ .Token }}`), verified at `/auth/v1/verify`. The session is kept in `quicknotes-auth` and refreshed automatically. Sign-ups are off. Logging in marks every local row dirty so existing notes merge in.

## Discord sender

`discord/DashSender.plugin.js` is a [BetterDiscord](https://betterdiscord.app) plugin that sends the notes in the **Discord** category as DMs from your own account, so you never open Discord to write them. A note is `- alex see you at 6`: the first words are the recipient (friend nickname, display name or username; up to 3 words), the rest is the message. Only notes untouched for 2 minutes (the Undo window) go out, at most 10 per run, 3-6 s apart, on start and every 60 s while Discord is open. A sent note is ticked off with `deleted_how = 'sent'` and listed under **Sent** in Dash. A failed one is rewritten as `- ! alex see you at 6 (no friend called alex)` and skipped until you fix it.

**How it works:** Dash only stores the note in Supabase. The plugin runs inside the Discord desktop app, so **Discord must be open** (it can sit in the background) for anything to send; there is no server. Every 60 s it logs in with your saved session, asks Supabase for Discord notes older than 2 minutes, finds the recipient among your friends and open DMs, and sends the message through Discord's own internal send function, as you. It then marks the note sent in Supabase, and Dash picks that up on its next sync. Notes queued while Discord is closed just wait and go out a few seconds after it next opens.

**Install:** install BetterDiscord, copy the file into `%APPDATA%\BetterDiscord\plugins\`, enable it in Settings > Plugins, then log in from its settings (email, then the code, same as Dash). After editing the repo copy, copy it over again. **Aliases** (one per line, `name = username | user id | channel id`) cover names that don't match anyone. The plugin only holds the publishable key and your login session, never a service key.

## Development

Service workers need `https://` or `localhost`, so serve the folder:

```sh
npx serve .
# or
python -m http.server 8000
```

If edits don't show, hard-refresh or unregister the service worker in DevTools. Use DevTools' device emulator, and a real Android device for keyboard and Gboard behaviour.

## Deploying

The Vercel project `quick-notes` is linked to this repo. Every push to `main` deploys to production; other branches get preview URLs.

## Android app (Boox)

A Trusted Web Activity wrapping https://dash-notes.vercel.app. It holds no app code, so it only needs rebuilding if the name, icon or start URL changes.

1. **Build:** on pwabuilder.com, paste the live URL, Package for Stores → Android, signing key "New". Keep `signing.keystore` and `signing-key-info.txt`. Install the signed `.apk`, not the `.aab`.
2. **Install:** copy the `.apk` to the Boox, open it from the file manager (not Neo Reader), allow installs, and map the side button to it.
3. **URL bar:** [.well-known/assetlinks.json](.well-known/assetlinks.json) links the site to package `app.vercel.dash_notes.twa` and the signing key's SHA-256. If the bar shows, reinstall after the file is live; update the fingerprint if the key changes.
