# Storage: everything counts, measured nightly

**Decided by Adil, 2026-09-14.** Everything an account stores counts toward
its allowance. 25 GB free for everyone; accounts tagged team or test in the
admin players list get 100 GB; Adil's own account keeps its grant. Matches
attached to a paid review count too (the paid upload is still let through).
A coach's lesson video is charged to the coach. Feedback screenshots and QA
attachments are ours and stay out.

Audit page with the numbers: https://claude.ai/code/artifact/5548647e-a044-4907-859b-ffe7ec569369

## What was wrong

- `my_storage_state` counted originals, cut videos and lesson originals
  only. Point clips, reels, recaps, voice notes, sketches and photos were
  booked in `storage_ledger` and filtered out of the sum.
- Four routes never booked at all: coach photo, offering image, review
  attachments, review voice notes.
- Only the match upload route (and lesson video create) checked the
  allowance before accepting a file.
- The ledger drifted from the buckets by about 40 GB, because a running
  tally is only right if every write and delete remembers it: lesson
  cleanup deletes files without a negative row, worker bookings are
  best-effort, `match.json` is rewritten without booking the change, and
  149 files were booked twice while 22 were below zero.
- Measured 2026-09-14: buckets 307 GB of user files, ledger 269 GB,
  allowance counted 197 GB.

## The mechanism

1. **Nightly measurement.** `/api/cron/storage-snapshot` (Vercel cron,
   08:15 UTC; also the admin's Measure now button) lists both buckets,
   attributes every object to its account by path
   (`src/lib/storage/inventory.ts`), and writes `storage_snapshots`: bytes,
   object count, a per-kind breakdown, and what the tally said at that
   moment. Reels are keyed by match or tag and looked up. Research,
   tutorial, feedback and QA files are the platform's. Anything under a
   prefix the inventory does not know is reported as unattributed on the
   admin page, never dropped.
2. **Used space = snapshot + ledger rows since the snapshot**
   (`_storage_used_bytes`). The tally only has to be right for the last
   day; historic errors retire after the first run; the difference between
   tally and measurement is a column on the admin storage page.
3. **One check on every upload route.** `checkUploadAllowed` with
   `MEDIA_UPLOAD_RULES` on voice notes, sketches, journal photos, re-cut
   clips, coach photo, offering image and review attachments, refusing
   with the same "Storage is full." sentence web and iOS already recover
   from. Match upload and lesson video create were already checked.
4. **The missing bookings.** `ledger_append_own_media` for avatar, offer
   and review files; a delete trigger on `review_attachments`; the review
   attachment route owns deletion (file, then row) and both apps call it.
5. **Allowances.** `default_storage_bytes` 25 GB, `team_storage_bytes`
   100 GB, `_ensure_quota` and `admin_player_kind_set` pick by tag.
6. **Surfaces.** Account page (web and iOS) says everything counts and
   shows the breakdown; a storage line sits beside the lesson video
   import on web and iOS; Terms say everything counts; the admin storage
   page shows measured vs tally per account with Measure now.

The worker is untouched on purpose: its releases are sealed, and the
snapshot absorbs what it forgets to book.

## Rollout

1. Apply migration `20260914230000_storage_everything_counts.sql`.
2. Merge to main; the push deploys the web app and the cron.
3. Press Measure now on /admin (storage) so the first snapshot exists.
4. Check the Accounts table: no ordinary account over its limit.
5. Ship the iOS build (Account copy, storage line on lesson videos,
   attachment delete through the route).

## Follow-up Adil asked for

After this ships: a cleanup of repeated test uploads on Adil's own account.
Separate conversation; do not start it without telling him first.
