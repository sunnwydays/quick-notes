# Working on Dash

See README.md for how the app works and how it deploys (every push to `main` goes live).

## Supabase

- To query or change this app's Supabase DB, use `node dash.mjs "<sql>"` (or `-f file.sql`) instead of the Supabase MCP wherever possible. It's gitignored and reads its credentials from `vibe/resume-framework/.env.local`.

## Commits

- One commit per feature or fix. When one request covers several changes, split them into separate commits, even if they touch the same files.
- Commit each change as soon as it's done, without waiting to be asked.
- Once every feature requested in the chat is implemented and committed, push to `main` without asking. There's one user and downtime doesn't matter, so shipping beats waiting.
- For changes that can only really be checked on a phone (touch gestures, keyboard behaviour, sync), still commit and push.
- After committing and pushing, the whole reply is "Done." followed by a one-line summary of what changed, in plain words, including any address or behaviour the user needs to know to use it (e.g. "Done. Transfer boxes open at /#transfer/1 to /#transfer/3, and open pages now reload themselves ~2s after a deploy."). Answer any question the user asked in that line. No hash, no deploy note, no list of what to test or how to refresh the app.

## Writing planner blocks for Sunny

When adding or renaming blocks in his schedule or planner, match how he names things:

- Keep names short and plain: `Study 345`, `Cardio`, `Get haircut`, `Commute home`. Put detail in a short colon tail at most (`Workout: lower`, `Study 345: recurrences`), not a sentence.
- Capitalize the first letter. He types lowercase out of laziness, not by choice.
- No `·` or `+` in names. He writes "and" (`Wash up and stretch`, `Shower and read`) and drops template extras (`Lunch + dishes + read` became `Lunch`).
- Study blocks use the bare course number (`Study 311`); labs and assignments keep the course code (`ECE311 lab`, `ECE345 assignment`).
- A parenthetical is fine for a reason or context (`Apply to jobs (ended jobright subscription)`).
- His day: up 07:00, `Wash up and stretch` (24m) and `Walk outside` (16m), `Lunch` 11:15 (50m), `Dinner` 17:00 (65m), `Buffer` 21:00, `Shower and read` 22:00.
