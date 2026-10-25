# Quick Notes

One-tap dictation notes for Android phones and Boox e-readers. Tap a category to read its notes; hold it and let go to open the text box with the keyboard up, ready for Gboard voice typing.

Live: https://quick-notes-liart.vercel.app

## Using it

**Install:** open the link in Chrome, tap ⋮ and then **Add to Home screen** (or **Install app**). On a Boox, use Chrome rather than the built-in browser.

**Write a note**
1. Hold a category until it turns black, then let go (or tap **Write**, then the category): a project, Todo, Working on, Schedule, Thought, Random projs, Bring or Journal.
2. The text box opens with `- ` in it and the keyboard up, under that category's latest notes. Tap the Gboard mic and talk. Once the text is longer than the box (a long schedule, say), the latest notes are hidden and the box takes the whole screen.
3. Press Enter to add the note. The box goes back to `- ` with the keyboard still up, ready for the next one. There's no way to type a line break in a note (except in a Schedule, where Enter starts a new `- ` line). A note that's already in its category (ignoring case, spacing and a full stop at the end) isn't added again; the banner at the bottom says "Already in Bring." instead.
4. Tap **Save**, or use Android's back button. Both save what's in the box and go home. **Discard** throws it away.

What you type is saved as you go. If the app is closed mid-note, it reopens on that note next time.

**Add note** (the black button in the middle of the built-in categories, where the thumb rests) opens the same text box without picking a category. Each note is filed by how it starts:
- A folder's name, or a word for it, goes there and is taken off the note: `bring blender` saves `- blender` in Bring. The words are in `FOLDER_WORDS` in `autofile.js`, including the ways Gboard mishears them (`brain` for bring, `yeah tutor` for ai-tutor). Add to that list when dictation gets one wrong.
- A project's own name works too (`deer clear research` goes to deer; `ai tutor` to ai-tutor).
- `I think …` / `I feel …` go to Thought and `today was …` to Journal, keeping those words (`FOLDER_CUES`).
- Anything else goes to Todo. Schedule is never picked, since a one-line schedule would replace the day's plan.

Above the text box are the latest notes from every folder, each with its folder's name, so you can see where the one you just added went.

**Menu:** the ☰ button at the top right of the home screen holds **New project**, **Export**, **Help** and **Log in**. Tapping anywhere else closes it without doing anything else.

**Category buttons** are circles, three to a row, each with a line icon (projects get a folder) over its name. The icons are SVG rather than emoji so they stay sharp on e-ink. The built-in categories form a "flower": seven smaller circles evenly round a larger **Add note** (Todo at the top, then clockwise), so the main button sits where the thumb rests instead of at the bottom edge. **Write** is an ordinary button under it.

**To-dos on the home screen:** the three newest to-dos show as plain lines under the top row, so they can be seen without opening anything, with "+5 more" when there are others. Tap them to open Todo. They're hidden when there are no to-dos, or while searching.

**Projects:** open the ☰ menu and tap **New project** to add one. Projects get their own circles above the built-in categories, with a line between the two groups. They zigzag up and down four to a row, each a slightly different size, and a short last row is centred. To remove one, tap the project and tap **Remove project**. That deletes its notes too.

**Help:** **Help** in the ☰ menu opens a short list of the non-obvious things (holding a category, going back, search, Undo). If you change how something works, update that text in `index.html` too.

**Search:** type in the small box beside the sync icon and ☰ menu at the top of the home screen; that row stays put while the results scroll below it. The category buttons are replaced by every note that contains all the words you typed (any order, any case), grouped under its category with a count. Tap a category's heading to open its notes. **Clear** puts the buttons back.

**Read:** tap a category. Its notes open, newest first, each with a Delete button and a Replace button (two arrows). Replace deletes the note and opens the text box for that category, so you can tick off a task and write the next one; the new note gets the current time, not the old note's. Back on the notes screen, Undo brings the old note back. **Show times** adds each note's time, and is remembered per category (e.g. on for Journal only). **Write** on the home screen only applies to the next tap; tap it again to cancel. Double-tap anywhere on the notes (not on a button) to go back, or hold a blank spot for a moment. Holding a note still selects its text.

**Schedule:** tap Schedule to see today's plan. The block happening now is shown in black with "Now, until 11:30", a gap between blocks shows "Free until 15:00", and finished blocks fold into a **See 5 done** row (each tap shows 3 more, newest first; **Hide done** folds them again). To write one, hold Schedule (or tap **New**/**Edit** on its screen) and paste a plan or type a line per block:

```
Sun (full day)
7:15-8:45 IBM OA: 30m prep, then the real thing
11:30 lunch
17:00 dinner, 17:45 chess, 18:30 job apps
No new material after that, early night
```

- A block is a time or a range (`9:00`, `9:00-11:30`, `9am`, `2:30 pm`, `10:30 to 12`) and then its text. A plain number at the start of a line counts too, as an hour (`10 brunch`, as voice typing writes it) or hours and minutes (`830 gym`, `1030-1130 email`), as long as it comes after the block above (counting afternoon, so `1 lunch` after `10 brunch` is 13:00). Otherwise it's a line of that block, like `5 sets` under `20:00 gym`. A number joined to more text (`2h30`, `15m`) is never a time. A block with no end time lasts until the next one starts. A comma followed by a time starts another block on the same line. A line with no time is a note under the block above it.
- Without am/pm, a time earlier than the block before it counts as afternoon, so `12:30` then `1:00` reads as 13:00.
- A line starting with a day (`Sun`, `Monday:`, `Tue 27 Oct`, `Tomorrow`) starts that day's schedule, so a paste covering several days is saved as one note per day. Without one, it's today's. A day means the next one on or after the day it was saved, so `Sun` saved on a Saturday is tomorrow's. After saving from the schedule screen, it shows the day the schedule was saved for, and an empty today links to the next day that has one.
- **New** opens a blank schedule for the first day without one, starting from the day on screen: with Saturday and Sunday planned, New on Saturday opens Monday's. A later day's starts with its weekday, so it's saved for that day. If the whole coming week is planned, it opens the day on screen. **Edit** opens the day's schedule in the editor with a new line at the end. Neither shows on a past day. Saving it adds a new version; the newest one for a day is the one shown. A day that comes out the same as its current version isn't saved again, so saving Edit without changes, or pasting the same plan twice, adds nothing. **All saved** lists every version, for any day, as plain notes (with Delete, Show times and Copy all). The ‹ › arrows step through the days that have a schedule; swiping left or right on the screen does the same.

**Back up**
- **Export** in the home screen's ☰ menu downloads every note as a `.txt` file.
- **Copy all** on a category's notes screen copies the same text to the clipboard.

**Sync between devices:** open the ☰ menu and tap **Log in**, enter your email, then the code from the email. Do this once on each device and it stays logged in. Notes, deletes and projects then sync between devices. Logging in is optional: without it, notes stay on that device only. The cloud icon at the top right, next to the ☰ menu, shows a tick when synced, dots while syncing and a line through it otherwise; tap it for the details (time of last sync, or "Offline" with how many changes are waiting).

**Offline:** after the first load, the app works with no internet. Notes save on the device first and sync later, when the app is opened, brought back to the front, or gets a connection. For voice typing offline, download Gboard's offline speech pack in Gboard settings, then Voice typing.

## How it works

Plain HTML, CSS and JS. There's no framework and no build step. The JS files are ordinary `<script>` tags, loaded in the order they appear in `index.html`, and they share one global scope (not ES modules), so a file can call functions and use variables from any file. Top-level code that runs while a file loads can only use files above it; everything else runs later, once all of them are loaded. `sw.js` lists the files to cache, so add any new file there too.

| File | What it does |
| --- | --- |
| `index.html` | The six screens (home, editor, entries, schedule, login, help) as `<section>`s. Only one is shown at a time. |
| `data.js` | Constants, the saved data (`data`) and helpers for reading it. |
| `views.js` | Switching screens, the history/back button and the Undo banner. |
| `gestures.js` | Hold-and-release on a category; double-tap or hold blank space to leave the notes or schedule screen. |
| `home.js` | The home screen: category buttons, the ☰ menu, New project, Add note, Write. |
| `editor.js` | The note editor: Enter to add, drafts, Save and Discard. |
| `autofile.js` | Add note: picks each note's folder from its first words. |
| `search.js` | The search box on the home screen: notes that match, grouped by category. |
| `entries.js` | The notes screen: list, times, delete, replace, remove project. |
| `schedule.js` | The schedule screen: reads times and day headings out of a Schedule note, highlights the block on now, folds finished ones, and splits a multi-day paste on save. Redraws only when a block starts or ends, since each redraw flashes an e-ink screen. |
| `export.js` | Export and Copy all. |
| `sync.js` | Supabase sync: push, pull, merge and the status line. |
| `login.js` | Email-code login. |
| `help.js` | Opens the Help screen (its text is in `index.html`). |
| `main.js` | Startup. Loaded last. |
| `schema.sql` | The Supabase tables, row-level security and triggers that sync uses. |
| `style.css` | E-ink friendly: black on white, large tap targets, no shadows or animations. Main actions are solid black, others a 2px outline, minor ones (`.quiet`) plain bold text or an icon. |
| `sw.js` | Service worker: a background script that caches the app files so the app opens offline. |
| `manifest.json` | Tells Android the app's name and icon, and to open full-screen without the browser bar. |
| `icons/` | App icons, 192 px and 512 px. |
| `fonts/` | Atkinson Hyperlegible (interface) and Literata (note text), Latin subset, with their Open Font License files. |

**Data** is kept in `localStorage` under the key `quicknotes`:

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

Deleting a note or project sets `deletedAt` instead of removing it (a "tombstone"), so the delete can sync. `dirty` means changed here and not uploaded yet. Data saved by the first version (plain category names, no sync fields) is upgraded on load, and the original is kept under `quicknotes-backup-v1`.

The note in progress is kept separately under `quicknotes-draft` as `{ cat, text }`, and cleared on save. On startup the app calls `navigator.storage.persist()` to ask Chrome not to clear its storage when the device is low on space.

**Screens and the back button:** opening a screen pushes a browser history entry (`history.pushState`), so Android's back button returns to the previous screen instead of closing the app. The editor saves inside the `popstate` handler, which is why Save (`history.back()`) and the hardware back button behave the same.

**Keyboard on tap:** the category button's click handler shows the editor and calls `textarea.focus()` in the same tick. Android only raises the keyboard when focus comes directly from a real tap, so this can't be moved into a timeout or an async callback. That's also why holding a category opens the editor when the finger lifts (`pointerup`) rather than when the hold timer fires.

**Enter adds the note:** Enter is caught on `keydown` for physical keyboards. Gboard usually doesn't report Enter on `keydown` (it sends key code 229), so `beforeinput` (`insertLineBreak`) catches it there, and if a line break still gets through, the `input` handler does the same thing. Either way the box is saved without closing the editor, then reset to `- `. The text box has `enterkeyhint="send"` so Gboard's Enter key shows that it sends rather than starting a line. In a Schedule, Enter inserts `\n- ` instead. On save, empty `- ` lines are removed and each remaining line (say, from a pasted list) is saved as a separate note, a millisecond apart so they list in the order typed.

**Offline and updates:** `sw.js` answers each request from its cache right away, then fetches a fresh copy in the background. So after a deploy, the new version appears the *second* time you open the app. It only handles the app's own files; requests to Supabase always go to the network.

**Sync:** the tables `qn_entries` and `qn_categories` live in the Supabase project `job-tracker` (see `schema.sql`). Row-level security limits each account to its own rows, which is why the publishable key in `sync.js` is safe to ship. Sync uses plain `fetch` calls to Supabase's REST and Auth endpoints, with no library. One sync:

1. **Push:** upload every `dirty` row (an upsert).
2. **Pull:** download rows whose server-set `synced_at` is after the last pull. The cursor is in `quicknotes-sync`.
3. **Merge:** notes are never edited, only added or deleted, so merging is a union by id, and a delete always wins. For categories, the newer `updatedAt` wins, since a project can be removed and re-added. The database triggers apply the same rules, so an out-of-date device can't undo a newer change.
4. If a note was written offline into a project that the other device removed, the project comes back so the note isn't hidden.

Each open tab keeps its own copy of the notes in memory but shares `localStorage`, so the app re-reads storage before saving after any network wait and follows other tabs' saves. Why: [docs/two-tabs-sync-bug.md](docs/two-tabs-sync-bug.md).

Sync runs on app open, when the app comes back to the foreground, on reconnect, and after each save, delete or project change. It never blocks the UI, and a failure just leaves rows `dirty` for next time.

**Login:** Supabase emails a one-time code (`/auth/v1/otp`, with `create_user: false`), and entering it (`/auth/v1/verify`) returns a session kept in `quicknotes-auth`. The access token lasts an hour and is renewed with the refresh token, so you stay logged in. The Magic Link email template must include `{{ .Token }}` so the email contains the code. New sign-ups are turned off in the Supabase dashboard. On login every local row is marked dirty, so a device's existing notes upload and merge in.

## Development

Service workers only run on `https://` or `localhost`, so serve the folder instead of opening `index.html` as a file:

```sh
npx serve .
# or
python -m http.server 8000
```

Then open `http://localhost:3000` (`serve`) or `http://localhost:8000` (Python). There is no build step. If edits don't show up, hard-refresh or unregister the service worker in DevTools under Application → Service Workers. Login and sync work from localhost.

Test in Chrome DevTools' device emulator. To check the keyboard and Gboard behaviour, use a real Android device.

## Deploying

The Vercel project `quick-notes` is linked to this GitHub repo. Every push to `main` deploys to production. Pushes to other branches get preview URLs.
