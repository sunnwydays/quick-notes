# The two-tabs sync bug

Fixed in commit `421cbbc` ("Fix sync losing rows when two tabs are open").

**Symptom:** with the app open in two tabs or windows (on a phone, an installed app plus a Chrome tab counts), some notes and projects went missing on that device. They were still on the server, but the device never downloaded them again.

## Background: what each tab shares and what it doesn't

Every tab runs its own copy of the app. They share two things and keep one thing apart:

| | Shared between tabs? |
| --- | --- |
| `localStorage` (the saved notes, and the sync cursor `quicknotes-sync`) | Yes |
| The `data` variable (the notes held in memory while the app runs) | **No**, each tab loads its own copy at startup |

The app reads `localStorage` into `data` once, changes `data`, and `persist()` writes the **whole** of `data` back. That is fine with one tab. With two, a tab writes whatever it has in memory, whether or not it has seen what the other tab saved.

The sync cursor is the other half. A pull asks the server for rows with `synced_at` after the cursor, then moves the cursor forward. Rows before the cursor are never asked for again.

## What went wrong

Both tabs sync on startup, when they come to the foreground and when the connection returns, so they often sync around the same time.

1. Tab A pulls rows X and Y from the server, adds them to its `data`, saves them to `localStorage` and **moves the shared cursor past them**.
2. Tab B still has the old `data`, without X and Y, in memory.
3. Tab B saves something. Anything will do: finishing its own upload (which clears a row's `dirty` flag and calls `persist()`), saving a note, deleting a note.
4. `persist()` writes B's whole stale `data` over the top. X and Y are gone from `localStorage`.
5. The cursor is already past X and Y, so no later sync asks for them. They stay missing on this device until something forces a full download.

The same overwrite could drop a note typed in tab A before it had uploaded (for example, while offline), because B's copy didn't contain it. Deleting a note in a list that had been drawn from stale data also changed an object that was no longer the one in storage.

Slow networks make it worse. The old `pullChanges()` merged each page of results into `data` between network waits, so there was a long window for another tab to save in the middle.

## The fix

All three changes are in the commit above.

1. **Re-read before saving after any network wait.** `reload()` replaces `data` with what is in `localStorage`. `pushChanges()` calls it after each upload before clearing `dirty` flags. `pullChanges()` now downloads everything first, then calls `reload()`, merges and saves the rows and the cursor together with no network wait in between. The cursor can no longer move past rows that weren't saved.
2. **Follow the other tab.** A `storage` event listener runs `reload()` and redraws the screen whenever another tab saves, so each tab's memory stays close to the truth.
3. **Don't hold on to stale objects.** The Delete button now looks the note up again by id when tapped, instead of using the object from when the list was drawn.

**Recovering the lost rows:** the cursor key was renamed from `quicknotes-sync` to `quicknotes-sync-v2` (the old one is removed on load). With no cursor, each device downloads everything once more. Merging is a union by id, so rows it already has are untouched and the missing ones come back.

## What's still true

- Browsers don't offer a lock around `localStorage`. The reload-merge-save step in each tab is synchronous, so two tabs would have to hit it at the very same instant to clash, but this is a small window, not a guarantee.
- The note being typed is not affected: it lives in the text box and is saved as a draft (`quicknotes-draft`) separately from `data`.
- If you ever need to force a full download again, change the cursor key name (`SYNC_KEY` in `sync.js`) the same way.
