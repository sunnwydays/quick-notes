# Removed features

Features that used to be in Dash and were taken out because they weren't used. Git history has the code if one is ever wanted back.

## Schedule screen (removed 2026-11-27)

Dash had its own Schedule screen: today's blocks as a list, the one on now in black, finished blocks folded behind **See done**, gaps shown as "Free until 15:00", ‹ › or a sideways swipe to change day, and keys E/N/S/←/→. It had **Edit** and **New** buttons that opened the text editor, **Woke at…** to restack after a late start, and a **Review today** link after 21:30.

The Week planner replaced it: tapping Schedule opens `plan.html`. Woke at and Review today are in the planner (a day's menu and the header). Writing a schedule as text is still possible by holding Schedule or with the planner's **Paste** button.

## Version history: All saved (removed 2026-11-27)

Every save of a day's schedule added a new note, and **All saved** on the Schedule screen listed them all. Saves still add a note per version (the newest per day is the one used), but there's no screen to browse old ones. They're still in the Schedule category's data and in exports.

## Skip and Ran over marks (removed 2026-11-27)

A block could be marked **Skipped** (the Skip button on the Schedule screen, holding a line in the home glance, or **Skipped** in the planner's block editor) or **Ran over** (hold the Skip button, the **Ran over…** button, or the planner editor's **Ran over…**). Ran over asked for the real end time and an optional reason, then restacked the rest of the day from that time. Finished blocks with no mark counted as done. The planner's Review today showed each block's mark, and Claude read them at the evening review.

Marks were rows in Supabase's `qn_block_marks` table (`day`, `block_start`, `block_text`, `status` of done/skipped/over/cleared, `marked_at`, `ended_at`, `reason`), insert-only, with the newest per day and start time winning. Dash no longer reads or syncs them and drops its local copy. The table and its old rows are still in Supabase (`schema.sql`). Days saved with a ran-over end time (`actualUntil`) still lay out with it.

## Review today (removed 2026-11-27)

From 21:30 the planner showed a **Review today** button (and Dash's Schedule screen linked to it via `plan.html?review=1`). It listed today's timed blocks with their marks and a NEXT box on each project block; **Apply NEXT** saved those boxes. The built-in Weekday, Exam / interview and Welding Sunday templates also put a 15-minute `Review` block at 21:30. The evening review is now just writing in Journal. A block's Next is still in the block editor under **More**.
