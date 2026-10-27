# Working on Dash

See README.md for how the app works and how it deploys (every push to `main` goes live).

## Commits

- One commit per feature or fix. When one request covers several changes, split them into separate commits, even if they touch the same files.
- Commit each change as soon as it's done, without waiting to be asked.
- Once every feature requested in the chat is implemented and committed, push to `main` without asking. There's one user and downtime doesn't matter, so shipping beats waiting.
- For changes that can only really be checked on a phone (touch gestures, keyboard behaviour, sync), still commit and push.
- After committing and pushing, the whole reply is "Done." followed by a one-line summary of what changed, in plain words, including any address or behaviour the user needs to know to use it (e.g. "Done. Transfer boxes open at /#transfer/1 to /#transfer/3, and open pages now reload themselves ~2s after a deploy."). Answer any question the user asked in that line. No hash, no deploy note, no list of what to test or how to refresh the app.
