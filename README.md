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
- Anything else → Todo. Schedule is never picked.

**Home screen:** built-in categories are circles in a "flower" round **Add note**; projects sit above them. Icons are SVG so they stay sharp on e-ink. Under the top row are a few to-dos (newest, then the oldest with its age) and today's schedule (the block on now in black). Hold a to-do or schedule line to tick it (`HOLD_TO_DONE_MS`). The ☰ menu holds **New project**, **Transfer**, **Export**, **Help** and **Log in**. Help's text lives in `index.html`, so update it when behaviour changes.

**Search:** the box at the top shows every note containing all the typed words, grouped by category.

**Read:** tap a category to see its notes, newest first, with Delete and Replace (delete and write the next one). In Todo, Bring, Working on, Random projs and projects, a tick marks a note done; swipe to delete without counting it done. Everything has Undo. **Show times** is remembered per category. Double-tap or hold a blank spot to go back.

**Projects:** ☰ → **New project**. To remove one, open it and tap **Remove project** (deletes its notes).

**Schedule:** shows today's plan with the current block highlighted, gaps as "Free until 15:00", and finished blocks folded. Write one by holding Schedule or tapping **New**/**Edit**, one block per line:

```
Sun (full day)
7:15-8:45 IBM OA: 30m prep, then the real thing
11:30 lunch
17:00 dinner, 17:45 chess, 18:30 job apps
No new material after that, early night
```

- A block starts with a time or range (`9:00`, `9am`, `10:30 to 12`, or bare `10`/`830` if it follows the block above). Without am/pm, a time earlier than the last one counts as afternoon. Lines without a time are notes under the block above; a comma then a time starts another block.
- A line starting with a day (`Sun`, `Tomorrow`, `Tue 27 Oct`) starts that day's schedule, so a multi-day paste saves one note per day.
- Each save adds a version; the newest per day is shown, and unchanged saves are skipped. **All saved** lists every version. ‹ › or swiping steps through days.
- The box beside each block cycles unmarked → Done → Skipped. Holding it marks **Ran over**, asking for the end time and an optional reason. Marks go to `qn_block_marks`.

**Transfer:** three text boxes for copying text between computers, at `/#transfer/1` to `/#transfer/3`. They sync like notes (needs login on both sides), autosave a second after typing, and poll every 5 s (`PAD_POLL_MS`). **Previous** swaps in the last overwritten text (two kept, `PAD_KEEP`). No file support.

**On a computer:** Esc goes back (saving in the editor); Ctrl+Enter/Ctrl+S saves; A/E opens the editor; 1–8 open the built-in categories; / searches; on the notes screen ↓↑ or J/K pick a note, X ticks, Delete deletes, R replaces; T toggles times, U/Ctrl+Z undoes, ? opens Help. Single keys don't fire while typing. Full list in Help.

**Back up:** **Export** downloads every note as `.txt`; **Copy all** copies a category.

**Sync:** ☰ → **Log in** with your email and the emailed code, once per device. Optional; without it notes stay on the device. The cloud icon shows sync state.

**Offline:** works with no internet after the first load; changes sync later. For offline voice typing, download Gboard's offline speech pack.

## How it works

Plain HTML, CSS and JS: no framework, no build step. The JS files are plain `<script>` tags sharing one global scope, loaded in `index.html` order; top-level code can only use files above it. Add any new file to `sw.js`'s cache list too.

| File | What it does |
| --- | --- |
| `index.html` | The seven screens as `<section>`s (one shown at a time), plus Help's text. |
| `data.js` | Constants, saved data (`data`) and helpers. |
| `views.js` | Screen switching, history/back, Undo banner, reload after deploy. |
| `gestures.js` | Hold-and-release, double-tap and hold-to-go-back. |
| `home.js` | Home screen, ☰ menu, New project, Add note. |
| `editor.js` | Note editor: Enter to add, drafts, Save/Discard. |
| `autofile.js` | Picks Add note's folder. |
| `search.js` | Search. |
| `entries.js` | Notes screen. |
| `transfer.js` | Transfer pads (hidden categories `Transfer 1`–`3`). |
| `schedule.js` | Schedule parsing, screen, block marks, home schedule column. Redraws only when a block starts or ends (e-ink flash). |
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
