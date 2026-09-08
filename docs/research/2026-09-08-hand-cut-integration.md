# Hand cut: how it fits the rest of PongLens

Date: 2026-09-08. Status: analysis only. Nothing in production was changed:
no merge, no push, the migration is not applied, the worker was not
restarted. The feature lives on branch `hand-cut` (worktree
`.worktrees/hand-cut`), twelve commits on top of local `main`. The design
record is `docs/superpowers/specs/2026-09-07-hand-cut-design.md`; sections
7, 10 and 14 there are the ones this document corrects.

## How this was produced

Five independent read-only passes, each over three trees: GitHub
`origin/main` (what Vercel deploys), the production worker checkout on the
Mac Studio (`/Users/adil/Desktop/Projects/PongLens/worker`, what launchd
runs), and the `hand-cut` branch. The passes: iOS app; web app (owner
surfaces); database (migration, RPCs, triggers, roles); worker downstream
(reclip, reels, placement, backfills, ledgers); second-person and derived
surfaces (share links, coach review, reels, starred, stats, research,
admin). Every claim that decides a rank below was re-checked by hand
against the live database or the file named. Where a pass and the check
disagreed, the check wins and the correction is stated in place.

No other written analysis exists. The only prior document is the design
spec; nothing from ChatGPT is in the repository.

## Verdict

The feature is sound on its own path: marks become a cut, clips, points
and a score; the match plays, scores, shares, and shows to a coach. It goes
wrong at the edges where the rest of the product assumes every ready match
came out of the ball detector and may be sent back through it. Three of
those edges are dangerous, one of them for Adil's own account on the first
test. The rest are copy and cosmetics.

Underneath there is one structural problem: the branch was built on a base
that GitHub has since moved past, and the Mac's worker is behind GitHub
too. The merge is not a fast-forward, and one worker function has to be
re-placed by hand rather than merged as text.

## 1. The environment, as it actually is

These are the facts the spec got wrong or did not know. Verified
2026-09-08 unless noted.

- **Live database = `origin/main`'s migrations plus `20260908120318`
  (QA bug areas).** The processing-versions layer IS applied:
  `match_processing_versions`, `matches.active_processing_version_id`
  (a BEFORE INSERT trigger mints it), `points.processing_version_id NOT
  NULL` (a trigger fills it from the active version when a writer leaves
  it NULL), and the sync trigger that copies job, cut, thumbnail and
  settings into the active version. `match_reprocessing_enabled` is
  `false`, but `is_admin()` bypasses the flag. `automatic_highlights` is
  on for three accounts, Adil's included.
- **The Mac worker is not GitHub's worker.** It runs local `main`'s
  working tree, which has zero references to processing versions;
  `origin/main`'s worker has 140. It works against the versioned schema
  only because the triggers cover for it. `MATCH_STRUCTURE_ENABLED` is off
  in the running daemon. That tree also carries another chat's
  uncommitted highlight changes (`HighlightRefreshObsoleteError`,
  `_prepare_automatic_highlight_manifest`) that the branch does not have.
- **The worker signs in as `postgres`.** The Keychain item
  `ponglens-db-url` carries the username `postgres.<project>`, the pooler
  form of the `postgres` role, which bypasses RLS and owns every migrated
  table. `pg_stat_activity` shows only `postgres` via Supavisor. The
  restricted `ponglens_worker` login (BYPASSRLS, explicit grants on 23
  tables, created out of band per
  `docs/superpowers/plans/2026-09-04-modal-backup-worker.md`) is the Modal
  backup lane's identity. It is not connected, and per CLAUDE.md that lane
  never claims media jobs. No grants contract test exists on any branch.
- **Repo state.** Local `main` and `origin/main` diverged at "Build 141"
  (9e14be1c): 141 commits exist only on GitHub, 100 only locally. Local
  `main`'s web build fails (missing `serveMiss.ts` exports that GitHub
  has). `hand-cut` is rooted in local `main`, and local `main` has moved
  again since (invite links build 165, QA areas). 25 remote migration
  versions are missing from the local tree.
- **Job kinds in the last 30 days:** deadspace_cut 195, reclip 188,
  content_check 181, placement_generate 97, reel 55, youtube_import 19.
  No `match_reprocess` job has run yet.

## 2. Breaks

Ranked by damage. "Who" says who can hit it the day the option is visible.

### B1. Tapping Generate under Highlights runs the whole ball detector on the original

Who: the three `automatic_highlights` accounts, Adil's included. Verified
end to end.

- `MatchView.tsx` (origin/main, about line 3143) shows the Highlights row
  whenever the match has cut offsets. `GET /api/highlights` answers
  `needs_generation` and enqueues nothing (route.ts 171-177). The row
  reads "Generate" and the sheet says "Highlights haven't been generated
  for this match" (`highlights.ts` 86-93).
- On tap, `POST /api/highlights` finds `highlight_evidence` NULL on every
  point, so `automaticHighlightEvidenceRefreshNeeded` is true and it
  enqueues a reel job with `refresh_evidence: true` (route.ts 257-264).
- Worker: `refresh_match_evidence_for_render` calls
  `highlight_backfill._prepare_diagnostic`. There is no `serves.json` for
  a hand cut, so it downloads `jobs.input_path`, which `claim_hand_cut`
  set to the raw original, and runs `run_blurball_only` plus the full
  points pipeline over the whole file (`_diagnostic_from_video`, with
  4-hour and 6-hour timeouts). All of it sits inside
  `timed_stage("reel_encoding")`, so the cost dashboard books a roughly
  40-minute detector run as reel encoding. If it raises, the queue
  redelivers the message and it runs a second time (`MAX_READ_CT=2`).
- Usual ending: no qualifying rallies, the row settles on "No highlight
  rallies", and the sheet can be asked again.
- `worker/backfill_highlights.py` selects ready matches with a confirmed
  winner, so an admin rollout would fan this over every hand-cut match.

Fix (small): in `/api/highlights`, select `cut_source` with the match row
and return `{status: "unavailable"}` from GET and `409
highlights_unavailable` from POST when it is `manual`. In the worker, skip
the evidence refresh when the match has no detections (`match.json`
`pipeline == "hand-v1"`, or `cut_source = 'manual'`) and go straight to
`build_manifest`. Exclude `cut_source = 'manual'` in the backfill. iOS then
shows unavailable instead of its spinner/Generate loop.

### B2. "Try processing again" is offered and would replace the marked points

Who: admins today (Adil), everyone when `match_reprocessing_enabled`
flips.

- `match_issue_state.canReprocess` is owner, ready, `match_reprocess_source`
  non-null (the original is kept), and `match_reprocessing_enabled(user)`.
  A hand-cut match passes all of it. The feedback sheet reads "Try
  processing again" with the reason "Some rallies were missed or cut at
  the wrong time" (`matchFeedbackView.ts:39`), which is nonsense on a match
  the player cut by hand.
- On the Mac's worker the job fails as an unknown kind (harmless, wasted).
  On GitHub's worker, `admin_start_match_reprocess` reads the version's
  `settings`, which the sync trigger has overwritten to `{"match_id"}`,
  builds a candidate version from defaults and runs the full pipeline;
  activating it would replace the hand-marked points. The branch's guard
  lives in `create_match(existing=True)` at publish, after the whole run,
  and on GitHub that code was rewritten around `locked_ordinary_match_attempt`,
  so the guard as written is not guaranteed to sit on the reprocess path.

Fix (small): add `and coalesce(m.cut_source,'auto') <> 'manual'` to the
`canReprocess` expression in `match_issue_state`; refuse in
`stamp_match_issue_source_version` and `admin_start_match_reprocess`; give
the feedback sheet a hand-cut variant without "How was the cut?" and
"Report a problem" (the refund is correctly 0 already). Keep the worker
guard as the backstop, placed inside the lock (see B7).

### B3. Placement maps are offered forever and always fail

Who: every owner and every coach, on web and iOS. Verified.

- `PlacementToolsRow` renders unconditionally (`MatchView.tsx:3173`). With
  `placement_status = 'not_requested'`, no retries and an original present,
  `placementLifecycleView` yields "Generate placement maps". The branch's
  RPC refuses (`P0001 'placement unavailable for a hand-cut match'`), the
  route maps that to `generation_unavailable` and a 409 reading "Placement
  maps aren't available for this match.", and the failure resolution
  re-reads `not_requested`, so the button returns. A permanently offered
  action that always fails with a message that never says why.
- The same promise is printed without a tap: the aggregate section's
  empty state and every point sheet say "Placement maps haven't been
  generated for this match. You can generate them from Tools." A coach
  sees "The match owner can generate placement maps." iOS says "Couldn't
  start it. Try again."
- If a placement job ever reaches the worker (the owner can insert a job
  row directly; only the RPCs are guarded), `placement_backfill.py:172`
  reads `source["fps"]` and `hand-v1`'s `source` has only `duration`, so
  it raises KeyError after a full blurball run: two attempts, admin
  emails, lifecycle `final_failed`. The early "calibration missing" return
  does not save it because `worker.py:3368-3370` injects a fresh
  calibration first.

Fix (small): put `cut_source` on the web `Match` type and return an
"unavailable, no action" view from `placementLifecycleView` for `manual`,
which also hides the notice; iOS gets a `generation_unavailable` string.
Worker: `placement_for_match` bails with `failure_code = "source_missing"`
when `match.json` has no `source.fps`, before blurball runs.

### B4. When a hand cut fails, nobody is told and it cannot be retried

Who: any player whose cut hits a transient error (R2, ffmpeg, network).
Verified against the branch worker.

- `process_hand_cut` reads the draft and checks "submitted" before its
  `try`. The rollback in `except` deletes the points, sets
  `cut_source = 'auto'` and `status = 'uploaded'`, clears `cut_path` and
  `job_id`, and nulls `hand_cut_drafts.submitted_at`.
- A failure that is not a `UserFacingError` is not archived, so the queue
  redelivers the same message about 30 minutes later; it now dies before
  the `try` with "draft was never submitted", and that string becomes the
  job's final error.
- Nothing surfaces it: `jobs_notify_failed` (migration 066) rings only for
  `deadspace_cut` and `youtube_import`; `send_failure_emails`
  (worker.py:997) covers those plus `content_check`; the raw page's banner
  keys off `match.status === 'failed'` (RawMatchView.tsx:723), and the
  rollback has just set it back to `uploaded`. The progress bar simply
  vanishes. Only the admin gets an alert.
- While it runs, the dashboard cannot see it either: `liveJobFor`
  (`src/app/dashboard/shared.tsx:112-117`) matches only
  `kind === "deadspace_cut"`, so Home shows "Not processed" and Delete
  match stays live.

Correction to the database pass: the missing table grant is not a break
on the Mac. The worker is `postgres` and owns the table. Add
`grant select, update on public.hand_cut_drafts to ponglens_worker`
(guarded by role existence) for the Modal lane's parity, nothing more.

Fix (small): clear `submitted_at` only for `UserFacingError` and let other
failures keep the draft submitted (or archive the message deliberately);
add `hand_cut` to the failure-notice trigger and the email kinds; let
`liveJobFor` accept `hand_cut`; key the raw page's failure banner on the
job's status, not the match's.

### B5. A rally whose clip fails to encode is dropped from the match

The branch sets `clip = None` and continues, then keeps only points with
a clip, so the player marked N rallies and gets N-1 with only a log
warning. The comment beside it claims the point is left for the reclip
trigger; there is no row for the trigger to see. `points.clip_path` is
nullable and `points_request_reclip` fires on INSERT when `edited and not
deleted`.

Fix (small): insert failed points with `clip_path` NULL and
`edited = true`.

### B6. The original is fetched with `curl` and no `--fail`

Every other download in the worker is `r2().download_file` or
`_download_backfill_object`. On an expired or denied presign curl exits 0
with the error body saved as the video; the probe returns None, the
duration silently falls back to the client's claim, and the failure
surfaces minutes later as a confusing cut error. No retries or multipart
for a multi-GB original.

Fix (small): `_download_backfill_object(raw_path, local)`.

### B7. GitHub's worker refuses the job kind (structural; bites at reconciliation)

Today the hand cut works on the Mac because the triggers cover the
versions layer (checked: the version is minted at upload, points get their
version id from the trigger, the sync trigger re-points the version at the
hand-cut job and stamps `completed_at` when the match goes ready). On
`origin/main`'s worker it does not: `locked_ordinary_match_attempt`
(worker.py:4213) raises `MatchVersionChanged("ordinary processing job is
terminal or stale")` for any job kind outside
`{deadspace_cut, youtube_import}`, and lines 4220-4233 require
`processing_version_id` and `originating_match_job_id` in the job's
options. `create_match` was rewritten around that lock, so the branch's
edit conflicts textually and the manual guard must be re-placed inside the
lock, not merged as text.

Fix: allowlist `hand_cut` there; have `claim_hand_cut` stamp
`processing_version_id` (the active version) and
`originating_match_job_id` (the new job's id) into the job options;
re-place the guard.

### B8. A crash between `create_match` and `finish_match` with the database unreachable strands the match

`create_match(existing=True)` writes `status = 'processing'`. If the
rollback cannot run, the match stays `processing` with
`cut_source = 'manual'`: `claim_hand_cut` refuses, the guard refuses
automatic processing, and the generic rescue at worker.py:8908 handles
only `deadspace_cut`. Admin SQL is the only exit. Rare; fix by including
`hand_cut` in the status-flip rescue (not the refund).

## 3. Money and accounting

- **M1. Storage double-counted per attempt.** The rollback deletes rows
  but not R2 objects and never calls `ledger_negate_keys`. The cut
  self-heals through the orphan sweep; the clips under
  `points/<uid>/<match>/` are in the kept tier and never swept, and their
  positive `storage_ledger` row stays. A resubmit overwrites the same keys
  and appends a second positive row. Fix: negate the result path and the
  clip prefix in the rollback.
- **M2. Retry compute vanishes; clip encoding unmetered.** `attempt_key`
  is `job_id` where every other call site uses `job_id:read_ct`, so a
  second attempt's minutes dedupe away. The per-clip encode loop sits
  outside any `timed_stage` (the automatic path books
  `point_clip_encoding`). Fix both.
- **M3. Stale refund function on the branch: no live effect.** The
  database pass flagged `refund_processing_spend_direct` lacking
  `reverses_id`. That is an old migration file inherited from local
  `main`; the hand-cut migration redefines only `claim_hand_cut`,
  `request_placement_retry` and `request_placement_generation`, and the
  two placement bodies match the newest definition on GitHub
  (`20260906174049`). Disappears with the rebase.

## 4. Degrades

Owner surfaces

- The feedback sheet still asks "How was the cut?" and offers "Report a
  problem" on a hand cut (refund correctly 0).
- Home's "Processed videos" list shows the hand-cut job as a "Playtime
  only" card with no Download (`HomeOverview.tsx:337-344` includes any job
  with `options.points !== true`; `result_path` is never set).
- The thumbnail stays the content-check walk-in frame forever
  (`process_hand_cut` writes no thumb; the content-check writer is
  `where thumb_path is null`).
- No "your match is ready" email, although the card says "We can email
  you when the match is ready" (RawMatchView.tsx:676). The bell still
  fires. If it were sent, `original_name` falls back to the literal
  "Hand cut", giving "Hand cut is ready to watch point by point."
- Keep score plays about 2.8 s of pads between points
  (`scored_at_cut_s` and `rally_end_cut_s` are NULL); this self-heals as
  points are scored. Serve rows show "—" until the first server is set;
  AnalysisCards already says "Set who served first to see serve stats.",
  which the owner can do.
- The share sheet's "Include score and stats" toggle promises "the
  placement maps"; none will exist. The 9:16 story render is a 1080×608
  strip centred in the frame (no `story_crop`).

Worker

- `_CutMap.dynamic_tails` is `pipeline != "v2"`, so `hand-v1` takes the
  dynamic-tail branch for inserted or split cards; the widened window
  misses every segment and falls back to the original, pulling unmarked
  footage. Original points are fine. One-word fix:
  `not in ("v2", "hand-v1")`. The `process_hand_cut` comment claims the
  opposite.
- `_encode_clip` is not the reclip ladder: no `-pix_fmt yuv420p`, no
  `-allow_sw 1`, so a 10-bit source yields High 10 clips some players
  refuse; reuse `_run_ffmpeg_encoded`.
- The publish tripwire tolerance is a constant 2.0 s against a concat of
  up to 400 separately encoded parts; scale it with the count.
- Marks filtered by duration can empty the list after the "no marks"
  guard, giving a generic failure with no player message.
- `match_structure` gets a permanent "pending" stub if that flag is turned
  on (off in the running daemon).
- No side-change or game-end evidence (expected; only the automatic path
  runs it).
- Ordering: `hand_cut` is dispatched before reclip and has no cancel and
  no queue delay; the fairness cap reads `kind <> 'reclip'` where newer
  code uses `not in ('reclip','content_check')`. `clip_pads` survives the
  rollback. Arguably `cut_source` belongs on the version row now that
  versions exist.

Admin and research

- The admin uploads page prints Table "None found." (`readTable` treats a
  missing calibration block as a detector refusal) and "This upload
  predates the record of which assembler cut its cards." for `hand-v1`.
  Fix: `state: "unknown"` for that pipeline and a third RouteLine message.
  `readAssembly` is clean: `hand-v1` is not `v2`, so no serve counts.
- The processing page is covered: the branch adds "Hand cut" and "Reading
  the marks", so nothing renders raw. Daily upload limits and admin stats
  ignore `hand_cut` (they count minutes; a hand cut spends none).
- `/research/scores` counts a player's own omissions as dropped rallies
  (it pages every point with no match filter). Exclude
  `cut_source = 'manual'`.

iOS

- No breaks. The Highlights row loops spinner/Generate until B1's API
  change lands; placement copy needs a `generation_unavailable` string
  (B3); `InsertGeometryTests` lacks an abutting-points case with 1.2/1.3
  pads.

Migration mechanics

- The file cannot be applied with `supabase db push` as it stands: 25
  remote versions are missing locally and its timestamp sorts below the
  live head, so it needs renaming above `20260908120318` (or
  `--include-all`). Adding the CHECK column takes a brief ACCESS EXCLUSIVE
  lock on `matches`. Apply only on Adil's go.

## 5. Checked and fine

- Share links: score bug, result, stats and clip playback all work; serve
  rows hide rather than print "—"; the placement section never renders
  (`placement_status` is never `ready`; the share RPC returns zero rows,
  not empty candidate lists). Highlight share is gated on a reel existing.
- Coach review: the ready notification copy is right; the playhead maths
  uses the stamped `clip_pads`, which is exactly what stamping them in
  `claim_hand_cut` bought.
- Reels and exports: starred, full, tag and point reels render from
  `cut_t0` plus pads; `v:hl:*` scopes are refused before enqueue.
- Versions layer: no NULL version ids are possible; points are visible;
  the edit RPCs work.
- Reclip: `trim_start` stays 0; `NN.mp4` originals never match
  `_RECUT_KEY_RE`, so they are never deleted; split edges land inside
  their segments.
- Storage: `'cut'` and `'clip'` are valid ledger kinds; the cut is
  protected from the sweep; delete-match removes the prefix and the draft
  cascades.
- Content check: a rejected match (`raw_path` nulled) can never be
  hand-marked.
- Costs: `hand_cut_encoding` prices at the existing Mac compute rate and
  never lands in the unmapped rollup.
- match.json readers: `backfill_cut_t0` computes the identical anchor;
  `rally_end_backfill` excludes it; `backfill_card_audio` reads
  `source.duration`, which exists. The arithmetic (`play_cut_segments`,
  `segment_cut_offsets`, `cut_position`, `_CutMap.locate`) was executed in
  the worker's own venv and agrees, including the merge and clamp cases.

## 6. Spec assumptions now false

1. "The versions layer is not applied." It is, from GitHub; the Mac's
   worker predates it and survives on triggers.
2. "The Mac runs what is on GitHub." It runs local `main`'s tree, 141
   commits behind on the web side and without the versions code.
3. "The worker can read any table." True on the Mac (`postgres`); false
   for the Modal lane (`ponglens_worker`, explicit grants).
4. "A hand-cut match cannot be reprocessed." The guard fires at publish,
   after a full run, and the offer is visible to admins now.
5. "Missing detector data hides the highlights and placement rows." They
   are offered, and each tap fails or, for highlights, costs a detector
   run.
6. "The migration applies with `db push`." Not as it stands.
7. "A failed clip is left for reclip." It is dropped.
8. "Every later re-cut takes the flat-pad branch." Inserted and split
   cards take the dynamic one.
9. The section 7 list of what a hand-cut match does not have is right
   about the data and wrong about the UI: nothing reads that list.

## 7. Recommended order

1. **Rebase `hand-cut` onto `origin/main`** once local `main` is
   reconciled with GitHub. Resolve `create_match` by hand: allowlist
   `hand_cut` in `locked_ordinary_match_attempt`, stamp the version
   options in `claim_hand_cut`, place the manual guard inside the lock
   (B7). This also restores the web build and retires M3.
2. **Gate the three offers** (B1, B2, B3): highlights API plus worker skip
   plus backfill exclusion; `canReprocess` plus RPC refusal plus feedback
   copy; the placement view on web and iOS plus the worker's early bail.
3. **Make failure honest** (B4, B5, B6, B8, M1, M2): keep the draft
   submitted on retryable failure, notification kinds, `liveJobFor`, the
   failure banner, insert failed clips, the proper download, ledger
   negation, the attempt key, the clip-encoding meter.
4. **Cosmetics** (section 4): feedback copy, Home card, thumbnail, ready
   email, admin uploads page, `dynamic_tails`, encoder flags, tripwire,
   share copy, research exclusion, iOS strings and test.
5. **Migration**: renumber above the live head, add the `ponglens_worker`
   grant, apply on Adil's go, then start the worker from the reconciled
   tree.
6. **Test on production with Adil's account**, which is in the highlights
   rollout: until step 2 lands, do not tap Generate under Highlights on a
   hand-cut match.

Sizes: every fix above is one condition, one string or one small
function. The rebase is the real work, because `create_match` and the
worker file have moved under the branch and another chat's uncommitted
worker changes sit in the production tree.

## 8. What changed on the branch after the decisions (2026-09-08, later)

Adil's decisions, in order: rebase first; hide the highlights and placement
rows and the reprocess offer on a hand-cut match; make failure honest;
gate the rollout per account; fix the accounting gaps before shipping;
apply the migration by hand on his go; test on production with his own
account. Everything below is on branch `hand-cut`, rebased onto
`origin/main` (c9294638). Nothing has been merged, pushed or applied.

**Rebase.** Thirteen commits replayed onto GitHub's main with one stop
(two add/add conflicts: a job label and an import). The lock-based
`create_match` merged on its own with the manual guard already inside the
lock. Verified afterwards: 33 reducer tests, the worker tests, the whole
project typecheck (only GitHub's four pre-existing test-file errors
remain) and a real `npm run build`.

**B1 highlights.** `/api/highlights` answers `unavailable` (GET) and 409
(POST) for `cut_source = 'manual'`; the match row is read with `*` so the
route survives the window before the column exists. The worker's
`_prepare_automatic_highlight_manifest` never refreshes evidence on a hand
cut, and `backfill_highlights.py` excludes them. The row itself is hidden
in `MatchView` (`handCut`).

**B2 reprocessing.** `match_reprocess_source` answers null for a hand-cut
match, which closes `canReprocess`, the request trigger and the admin's
start button in one place. The worker guard stays as the backstop.

**B3 placement.** The Tools row, the aggregate empty state, the point-sheet
notice and the coach's notice are all gated on `handCut` in `MatchView`.
The worker's `placement_for_match` treats a hand cut as `source_missing`
before the detector runs. iOS still reads `placement_status` and shows its
own row; the RPC refusal stands, and the iOS string is a follow-up (iOS is
untouched by decision).

**B4 failure.** The handler's rollback is split: a retryable failure keeps
the draft submitted and the job linked so the queue's redelivery can run
again; a terminal one (a user-facing error, or the queue giving up) hands
the marks back (`submitted_at` null, `cut_source` auto, `job_id` null).
Only the job the match still points at may undo anything, so a stale
message can never delete a resubmission's points. `jobs_notify_failed`
rings for `hand_cut` ("Cut failed", linking the match); the worker emails
the player on a terminal failure (`match.hand-cut-failed`) and on success
(`notify_job_done`, the promise the raw page already made). `liveJobFor`
recognises the kind, so Home shows the cut running. The raw page shows a
"Marked by hand" section when the latest hand cut failed, and the marker
row reads "N marked" so the player can send them again.

**B5, B6.** A rally whose clip fails to encode is inserted with no clip and
`edited = true`, which fires the reclip trigger; `insert_points` accepts a
point without a clip. The original is fetched with
`_download_backfill_object` (a missing object is terminal, anything else
retries).

**B7.** `locked_ordinary_match_attempt` allowlists `hand_cut`;
`claim_hand_cut` stamps `processing_version_id` and
`originating_match_job_id` on the job and links `matches.job_id` to it,
which is what the lock checks at publish.

**Money.** The rollback negates the attempt's storage rows (the cut's key
and the clip prefix). The attempt key is the queue's `job_id:read_ct`, so
a retry's minutes are booked; clip encoding runs inside
`point_clip_encoding`.

**Cosmetics done.** `_CutMap.dynamic_tails` treats `hand-v1` like `v2`;
`_encode_clip` uses the reclip ladder (8-bit output); the publish tripwire
tolerance scales with the segment count (`hand_cut_length_tolerance`,
tested); marks emptied by the duration filter fail with a message; a
thumbnail is taken from the first rally's serve; Home's download list
skips `hand_cut` jobs; the admin uploads page reports a hand cut as "never
asked" with its own route line.

**Rollout gate.** `app_config` key `hand_cut` (`off` by default; `on`,
`user:<id>` or `users:<id>,<id>`), read through `hand_cut_enabled(uuid)`,
which also passes admins. The match page asks it and the claim RPC
enforces it. To open it for one account later:

```sql
update public.app_config set value = 'users:<id>' where key = 'hand_cut';
```

**Migration.** Renumbered to `20260908140000_hand_cut.sql`, above the live
head. It adds the `ponglens_worker` grants where that role exists. Apply
it by hand (the Supabase SQL editor or the MCP `apply_migration`) after
the web deploy, or before it; the code tolerates either order.

**Not done, deliberately.** iOS placement copy for a hand cut; the
`/research/scores` exclusion (needs the column to exist before the query
can name it); the story crop fallback and the share-sheet toggle copy.

**Not verifiable here.** The migration has not run anywhere, so the marker
row, the claim, the job and the failure path were not exercised end to
end on this pass. The reducer, the pad, the segment arithmetic and the
publish tripwire have tests; the rest is the production test with Adil's
account, in this order: apply the migration, open an unprocessed match on
a phone, mark a few points, send, watch the job on `/admin/processing`,
open the match, confirm no Highlights or Placement rows and no "Try
processing again", then open Home and the library card.
