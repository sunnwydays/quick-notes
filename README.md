# Quick Notes

One-tap dictation notes for Android phones and Boox e-readers. Writing comes first: tap a category, and the text box is open with the keyboard up, ready for Gboard voice typing. Reading is behind one extra tap.

Live: https://quick-notes-liart.vercel.app

## Using it

**Install:** open the link in Chrome, tap ⋮ and then **Add to Home screen** (or **Install app**). On a Boox, use Chrome rather than the built-in browser.

**Write a note**
1. Tap a category: a project, Todo, Journal, Random thought or Bring from home.
2. The text box opens with `- ` in it and the keyboard up. Tap the Gboard mic and talk.
3. Press Enter to start a new `- ` line.
4. Tap **Save**, or use Android's back button. Both save the note and go home. **Discard** throws it away.

What you type is saved as you go. If the app is closed mid-note, it reopens on that note next time.

**Projects:** tap **+ project** to add one. Projects get their own buttons above the built-in categories, with a line between the two groups. To remove one, go to **Read**, open the project, and tap **Remove project**. That deletes its notes too.

**Read:** tap **Read**, then a category. Notes show newest first, each with its time and a Delete button.

**Back up**
- **Export** on the home screen downloads every note as a `.txt` file.
- **Copy all** on the Read screen copies the same text to the clipboard.

**Sync between devices:** tap **Log in** at the bottom of the home screen, enter your email, then the code from the email. Do this once on each device and it stays logged in. Notes, deletes and projects then sync between devices. Logging in is optional: without it, notes stay on that device only. The line next to the button shows "Synced 3:42 PM", or "Offline" with how many changes are waiting.

**Offline:** after the first load, the app works with no internet. Notes save on the device first and sync later, when the app is opened, brought back to the front, or gets a connection. For voice typing offline, download Gboard's offline speech pack in Gboard settings, then Voice typing.

## How it works

Plain HTML, CSS and JS. There's no framework and no build step.

| File | What it does |
| --- | --- |
| `index.html` | The five screens (home, editor, read, entries, login) as `<section>`s. Only one is shown at a time. |
| `app.js` | All the logic: storage, switching screens, the editor, read view, export, login and sync. |
| `schema.sql` | The Supabase tables, row-level security and triggers that sync uses. |
| `style.css` | E-ink friendly: black on white, thick borders, large tap targets, no animations. |
| `sw.js` | Service worker: a background script that caches the app files so the app opens offline. |
| `manifest.json` | Tells Android the app's name and icon, and to open full-screen without the browser bar. |
| `icons/` | App icons, 192 px and 512 px. |

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

**Keyboard on tap:** the category button's click handler shows the editor and calls `textarea.focus()` in the same tick. Android only raises the keyboard when focus comes directly from a real tap, so this can't be moved into a timeout or an async callback.

**Bullets on Enter:** Enter is caught on `keydown` for physical keyboards. Gboard usually doesn't report Enter on `keydown` (it sends key code 229), so `beforeinput` (`insertLineBreak`) catches it there. Both insert `\n- `. On save, empty `- ` lines are removed.

**Offline and updates:** `sw.js` answers each request from its cache right away, then fetches a fresh copy in the background. So after a deploy, the new version appears the *second* time you open the app. It only handles the app's own files; requests to Supabase always go to the network.

**Sync:** the tables `qn_entries` and `qn_categories` live in the Supabase project `job-tracker` (see `schema.sql`). Row-level security limits each account to its own rows, which is why the publishable key in `app.js` is safe to ship. Sync uses plain `fetch` calls to Supabase's REST and Auth endpoints, with no library. One sync:

1. **Push:** upload every `dirty` row (an upsert).
2. **Pull:** download rows whose server-set `synced_at` is after the last pull. The cursor is in `quicknotes-sync`.
3. **Merge:** notes are never edited, only added or deleted, so merging is a union by id, and a delete always wins. For categories, the newer `updatedAt` wins, since a project can be removed and re-added. The database triggers apply the same rules, so an out-of-date device can't undo a newer change.
4. If a note was written offline into a project that the other device removed, the project comes back so the note isn't hidden.

Sync runs on app open, when the app comes back to the foreground, on reconnect, and after each save, delete or project change. It never blocks the UI, and a failure just leaves rows `dirty` for next time.

**Login:** Supabase emails a one-time code (`/auth/v1/otp`, with `create_user: false`), and entering it (`/auth/v1/verify`) returns a session kept in `quicknotes-auth`. The access token lasts an hour and is renewed with the refresh token, so you stay logged in. The Magic Link email template must include `{{ .Token }}` so the email contains the code. New sign-ups are turned off in the Supabase dashboard. On login every local row is marked dirty, so a device's existing notes upload and merge in.

## Development

Service workers only run on `https://` or `localhost`, so serve the folder instead of opening `index.html` as a file:

```sh
npx serve .
# or
python -m http.server 8000
```

Test in Chrome DevTools' device emulator. To check the keyboard and Gboard behaviour, use a real Android device.

## Deploying

The Vercel project `quick-notes` is linked to this GitHub repo. Every push to `main` deploys to production. Pushes to other branches get preview URLs.
