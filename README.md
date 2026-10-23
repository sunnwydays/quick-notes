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

Notes live only on the device they were written on, so export now and then.

**Offline:** after the first load, the app works with no internet. For voice typing offline, download Gboard's offline speech pack in Gboard settings, then Voice typing.

## How it works

Plain HTML, CSS and JS. There's no framework and no build step.

| File | What it does |
| --- | --- |
| `index.html` | The four screens (home, editor, read, entries) as `<section>`s. Only one is shown at a time. |
| `app.js` | All the logic: storage, switching screens, the editor, read view, export. |
| `style.css` | E-ink friendly: black on white, thick borders, large tap targets, no animations. |
| `sw.js` | Service worker: a background script that caches the app files so the app opens offline. |
| `manifest.json` | Tells Android the app's name and icon, and to open full-screen without the browser bar. |
| `icons/` | App icons, 192 px and 512 px. |

**Data** is kept in `localStorage` under the key `quicknotes`:

```json
{
  "categories": ["My project", "Todo", "Journal", "Random thought", "Bring from home"],
  "entries": [
    { "id": "lq3x9a2k4f", "category": "Todo", "text": "- buy milk", "createdAt": "2026-10-23T18:05:00.000Z" }
  ]
}
```

The note in progress is kept separately under `quicknotes-draft` as `{ cat, text }`, and cleared on save. On startup the app calls `navigator.storage.persist()` to ask Chrome not to clear its storage when the device is low on space.

**Screens and the back button:** opening a screen pushes a browser history entry (`history.pushState`), so Android's back button returns to the previous screen instead of closing the app. The editor saves inside the `popstate` handler, which is why Save (`history.back()`) and the hardware back button behave the same.

**Keyboard on tap:** the category button's click handler shows the editor and calls `textarea.focus()` in the same tick. Android only raises the keyboard when focus comes directly from a real tap, so this can't be moved into a timeout or an async callback.

**Bullets on Enter:** Enter is caught on `keydown` for physical keyboards. Gboard usually doesn't report Enter on `keydown` (it sends key code 229), so `beforeinput` (`insertLineBreak`) catches it there. Both insert `\n- `. On save, empty `- ` lines are removed.

**Offline and updates:** `sw.js` answers each request from its cache right away, then fetches a fresh copy in the background. So after a deploy, the new version appears the *second* time you open the app.

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
