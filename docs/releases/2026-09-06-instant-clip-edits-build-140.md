# Instant clip edits release: build 140

Released September 6, 2026 from `claude/paulins-video-edit-processing-u0wozl`,
fast-forwarded onto `main` at `ce3dae33`, plus `5be8714c` (Build 140) and two
fixes found while verifying this release, `214621cb` and `bec0f9f8`.
Design and full status: `docs/superpowers/specs/2026-09-06-instant-clip-edits-design.md`.

- The timeline is now the truth and the clip file is a copy that catches up. A
  point whose timing changed plays straight from the cut video, windowed, the
  moment it is saved — no "Updating clip", no Adjust lock, and no waiting for a
  re-cut before adjusting the same point again.
- `adjust_point` re-anchors `cut_t0` instead of leaving it where it was, so a
  timing edit no longer misplaces the serve on the cut clock forever. Moving a
  point's end also clears the observed ending it invalidates.
- Re-cut requests come from a trigger on `points` rather than from a timer in
  the browser, one queued job per match with five seconds of queue delay.
- The worker cuts by presigned URL and range, from the cut video where
  `match.json` proves the window is kept and from the original otherwise,
  through `_CutMap`. Small jobs get a `jobs_fast` lane, and re-cuts use the
  VideoToolbox-first encoder.
- The phone can cut its own clip (`ClipCutter`, `recutOnDevice`), behind
  `device_reclip`. The worker's job stays as the safety net.
- Retention copy and code now say what the product actually does: the original
  upload and the cut video stay for the life of the match. The 30-day clocks
  that remain are for orphans nothing references.

## Production database

Six migrations were applied through the Supabase tooling before this release
and verified as recorded: `20260906174049 originals_are_kept`,
`174457 adjust_point`, `174620 insert_point_tight_edges`,
`174653 reclip_requests`, `174708 device_reclip`, `174730 fast_lane`. The files
on `main` carry those exact versions, so a later `supabase db push` sees them as
applied. The `jobs` insert policy was deliberately left as it is: the library
still inserts processing jobs as the signed-in user, and the Modal-control
migrations that make that safe live only in the Mac checkout.

`app_config.reclip_lane` is `main` and `device_reclip` is `off`.

## Backfills

Run from `worker/` against production, dry run first in both cases, and re-run
afterwards to confirm they are idempotent:

- `backfill_raw_path.py` — **13 matches filled**, **46 raws no longer stored**.
  The 46 are legacy matches whose original was swept before the commerce flip;
  null is the honest state for them. Re-run: 0 filled.
- `backfill_cut_t0.py` — **11,903 original points checked, 631 anchors moved**
  across 155 matches. Re-run: 0 would move.

`backfill_cut_t0.py` died on its second match before writing anything: it
checked that `match.json`'s point entries carried `idx`, `clip_t0` and `cut_t0`
as keys and then called `float()` on them, and a `match.json` written before the
cut clock was stamped has those keys present and null. Fixed in `214621cb`;
points with no known birth anchor are now skipped the way a split child is.

## Web

`main` deploys to `www.ponglens.com` through Vercel. The landing FAQ now reads
"Your original upload and cut video stay in your library until you delete them",
replacing the "deleted 30 days after upload" claim.

Checked signed in against production, at 393×660 and at 1280×850, on a recent
match with an original (`60af2908`, Chris) and against the database after each
edit:

- Adjust the start 3 s earlier: `t0` 52.28 → 49.28 and `cut_t0` 41.05 → 38.05,
  the same 3 s. The point view flipped from the clip file to the cut video and
  parked at exactly 38.05. No "Updating clip", Modify never disabled. Adjusting
  a second point by −2 s and back by +2 s returned `cut_t0` to its original
  value exactly, so the re-anchor round-trips.
- Adjust the end 5 s later on a scored point: `t1` 17.68 → 22.68, `cut_t0`
  unchanged, `rally_end_cut_s` and `scored_at_cut_s` both cleared, and the
  confirmed winner kept.
- Split three ways: children at 24.60–29.54 and 29.54–34.09 with anchors 20.01
  and 24.95, contiguous and correct, `clip_path` null on both. A child with no
  file at all played the right window from the cut video.
- Join twice: the children merged back and the parent returned to 18.65–34.09
  with its original anchor.
- Add a missing rally on a removed seam (the 21.5 s skip between cards 72 and
  73): the "+" carried the honest tooltip, the new card landed at
  795.11–816.63 with `tight_start` and `tight_end` both set and no clip file.
- Reload one second after an edit: the re-cut job was still queued, which the
  browser's four-second timer used to lose.
- Delete an edited point, let the Undo toast expire, restore it from the
  Removed list: the entry showed the edited timing, the point came back with
  `t0`, `t1` and `cut_t0` intact, and no spinner appeared at any point.

The Add-a-missing-rally sheet opened the original at 0:00 instead of at the
seam. On a removed seam the sheet sets the original as its source and the
landing effect runs in the same tick the `<video>` gets its `src`, so
`readyState` is 0, the seek guard drops the request, and the autoplay that
follows plays the start of the match. Setting `currentTime` by hand landed
correctly, so the file was always seekable. Fixed in `bec0f9f8` by landing
again on `loadedmetadata`. A continuous seam was never affected because it
reuses the cut video already streaming behind the sheet.

## Worker

The Mac worker runs from the working tree of `/Users/adil/Desktop/Projects/PongLens`,
which had drifted well behind `origin/main` — it was missing `_CutMap`,
`ORPHAN_RAW_DAYS`, `jobs_fast` and `email_templates`. `main` was merged into it
on branch `prod-merge-140`. All 57 conflicts fell outside `worker/` — the coach
side was built twice, once there and once on `main` — and every one takes
`main`'s version, which is the code Vercel deploys and the iOS build ships.
Kept from the Mac side: `worker/README.md`'s Mac-and-Modal parity section, the
local research directories, and the deliberate local worker state.

The pre-merge tree is recorded byte for byte on branch `prod-live-2026-09-06`
and as `/private/tmp/claude-501/worker-live-backup-2026-09-06.tgz`.

Restarted at 17:48 PT on `a7155b2c` (the merge plus the two liveness commits
that landed on `main` meanwhile), with the queue empty. The first re-cut it
ran tells the whole story: the old worker's last re-cut at 17:43 downloaded
the entire original and took 21 s for one clip; the new one cut the same
point in 2.7 s by range from the original, noticed a second edit had landed
mid-run and requested another pass, then cut it again in 1.4 s from the cut
video.

The fast lane is live: `PongLensWorkerFast.app` built from the same runner
command as the main one, `com.adil.ponglens-worker-fast` loaded, and
`reclip_lane` set to `fast` once its log showed it reading `jobs_fast`. Two
more re-cuts then ran on the fast process alone, 2.9 s and 1.6 s, done within
twelve seconds of the edit, with the main worker's log untouched.

`test_raw_retention` (7), `test_reclip_sources` (6) and
`test_journal_media_retention` (1) pass on the merged tree. The full worker
suite runs 783 tests with 2 failures and 11 errors — exactly the same set that
`origin/main` produces on this machine, so the merge adds no regression. One
failure that the merge did introduce, `test_keypoints_run_before_any_paid_model`,
was traced to the Mac tree still carrying the pre-2026-08-26 calibration-ladder
comment naming Luna before Sol; taking `main`'s comment block cleared it, and
the file's only non-comment difference was that same ordering in the docstring.

## iOS

`ios/Tests/run.sh` passes 665/665 (the 649 baseline plus this release's 16).

The release's Swift had never been compiled. The first build on a Mac produced
one error: `Core/DeviceReclip.swift` uses the Supabase query builder and never
imported the module. With that import added the iPhone 17 Pro simulator build
succeeds with no errors.

Version 1.0 build 140 archived and uploaded. App Store Connect processed it as
`VALID`, kept the number 140, and it is attached to the internal **Team** group
only — External testers remains on build 135.

Archive: `/tmp/PongLens-clip-edits-1.0-140.xcarchive`.
Build log: `/tmp/ponglens-clip-edits-140-archive.log`.
Upload log: `/tmp/ponglens-clip-edits-140-export.log`.

## Not verified

- **`device_reclip` is still `off`.** Turning it on needs a handset running
  build 140 to edit a point on, and then a check that the phone-made file plays
  in desktop Chrome. Nothing here was run on a physical device.
- **Adding a rally on a continuous seam.** Not reachable in this account's
  data. The cutter trims the gap between rallies to about a second, so a seam
  wide enough to be offered a "+" (four seconds) is always one the cut removed
  footage from. The one continuous seam found above the threshold had a deleted
  point sitting inside it, which suppresses the offer. The path is covered by
  the insert-geometry parity tests on both platforms but was not exercised
  against production.
- **The phone.** Build 140 installs and launches on the iPhone 17 Pro simulator
  with no crash, but the app is signed out there, so none of the signed-in edit
  flows were exercised on iOS. Nothing in this release has been run on a
  physical device.
- Starred still plays clip files and shows "Updating clip" on a stale one;
  public and coach surfaces still play a stale clip of an edited point with no
  filter. Both are listed in the design's "not done" section.

## After the release

Adil's first pass with the new Adjust found the one thing the design got
wrong on purpose: saving a Split or a Join lands the pad on the next point
and plays it, but saving an Adjust closed the sheet and left the pad paused
inside the old window, so the change only showed on a replay. Fixed on all
four surfaces in `fb1fab2a` — the pad lands on the point's new start and
plays; the point view replays the window whether the start or the end
moved. Verified live at 393×660 on both web surfaces; the iOS half ships
with the next build.

Two test rallies added and removed on the Chris match during verification
remain as removed rows. Score the Match treats a removed card's span as dead
footage, so they cost a one-second skip before points 7 and 73 until they
are deleted outright.
