# Reversible cuts: proposal (2026-09-25)

The processing-versions layer already keeps every cut of a match as a complete, switchable snapshot, so letting a player re-cut a match either way mostly means recording how each version was cut, letting the owner (not only an admin) make and switch versions, and fixing the two places where a hand cut still assumes it is the only cut. "New match", switching back, and re-marking by hand can ship with database, web, iOS and a hand-lane release only; replacing a hand cut with an automatic one needs a main/fast release, because a reprocessed version today skips the body-first assembler. One line in the worker must change before any of it ships: a failed hand cut deletes every point on the match, not just its own.

---

## 1. What exists

### 1a. The pieces

| Piece | Where | What it does today |
| --- | --- | --- |
| Versions table | `supabase/migrations/20260907212000_match_processing_versions.sql` | `match_processing_versions`: one row per cut, status `candidate` → `ready` → `active` / `superseded` / `failed`, with its own `raw_path`, `cut_path`, `match_json_path`, settings, release and a snapshot of the match row (`match_state`). One `active` per match. |
| Active pointer | same file | `matches.active_processing_version_id`, owned by the database. `points.processing_version_id` is NOT NULL; `(processing_version_id, idx)` is unique, so each version has its own complete set of points. |
| Version fence | same file | RLS on points shows only the active version. Triggers refuse any client edit to an inactive point, and to notes, tags, drawings, coach findings and new share links that name one. Split/Join/Adjust/Insert/server override all call `require_active_point`. |
| Derived jobs | `20260907221000_derived_job_versions.sql` | Placement jobs are stamped with the active version when queued; reclip and reel jobs carry it too. |
| Guard asserts | `20260907223000_match_version_postconditions.sql` | The migration fails if any rewritten function lost its version guard. |
| Switching | `activate_match_processing_version` (live definition read) | Archives the current reels into `match_processing_version_reels`, marks current reels failed ("Match version changed."), supersedes the old version, activates the new one, and projects cut, clips, placement status, first server and spoken scores from the version onto `matches`. Refuses while a reclip, placement or reel job is queued or running. |
| Canonical score | live triggers `match_score_input_revision`, `match_score_shadow_refresh` | A change of `active_processing_version_id` marks the score stale and rebuilds `match_score_state` / `point_score_state` from the new version's points in the same transaction. |
| Player request | `20260907210000_match_processing_feedback.sql`, `/api/match-issues/[matchId]` | `match_processing_feedback`, kinds `positive`, `problem`, `reprocess`, `refund`. |
| Rollout gate | `20260907220000_match_reprocess_rollout_gate.sql` | `match_reprocessing_enabled` = `false` live, so only admins can request reprocessing. |
| Admin review | `/admin/issues`, `admin_start_match_reprocess`, `admin_publish_match_version`, `admin_keep_current_match_version`, `admin_restore_match_version`, `admin_refund_match_issue` | Admin starts a `match_reprocess` job (free: `funding: support`, 0 minutes), compares, publishes or keeps, and can restore an older version. Each step emails and rings the owner. |
| Worker candidate path | `worker/worker.py` `MatchProcessingDestination` (4164), `load_match_reprocess_destination` (4220), `finalize_match_reprocess_success` (4339) | Writes the candidate's clips under `points/<user>/<match>/versions/<version>/` and its cut to `results/<user>/<match>/versions/<version>.mp4`, never touching the live match. Requires a support request row to exist. |
| Hand cut refusals | `match_reprocess_source` (null when `cut_source = 'manual'`), `create_match` guard (worker.py 4864), `_hand_cut_claim_checks` (`bad_state` when a cut exists, `already_cut` when any point exists) | These are what make a hand cut one-way today. |
| Web entry | `src/app/match/[id]/feedback/MatchFeedback.tsx`, `matchFeedbackView.ts` | The Tools row Adil calls "Problems with the cut" is labelled **Processing** (trailing "Report a problem"). It opens a request form: "Request reprocessing", "Request N minutes back", or "Report a problem". |
| iOS entry | `ios/.../Screens/MatchProcessingFeedbackScreen.swift` (`ProcessingToolRow`, `MatchProcessingSheet`), `Core/MatchIssue.swift` | The same row and panel as a sheet. |
| Hand cut copy | `src/app/match/[id]/MarkPoints.tsx:2809`, `ios/.../Screens/PlayerTakeoverMark.swift:1272` | "This match cannot be processed automatically afterwards." |

### 1b. What a version switch does to each thing (verified against live definitions and RLS)

| Thing | Tied to | When a new version becomes active | When switching back |
| --- | --- | --- | --- |
| Winners, lets, stars, server corrections, game ends, clip edits | the point rows of a version | New version brings its own. Old ones are frozen, not lost. | Restored exactly. |
| Canonical score | derived from active points | Rebuilt at once by trigger. | Rebuilt at once. |
| First server, spoken scores, clip pads, placement status | the version's snapshot | Taken from the new version (a candidate copies the match's own at creation, so first server carries). | Taken from the old snapshot. |
| Opponent, venue, date, your side, names | the match row | Unchanged. | Unchanged. |
| Match notes (not on a point) | the match | Unchanged. | Unchanged. |
| Point notes, tags, drawings, coach findings | point id | Hidden with the old version (RLS). | Visible again. |
| Coach access | the match | Unchanged; the coach sees the new cut. | Same. |
| Share links | the match (token unchanged) | Match link shows the new cut. A single-point link keeps playing its own clip from the old cut (by design). Starred, tag and selection links show the new cut's stars and tags. | Back to the old. |
| Highlights and reels | `match_reels` | Current reels marked failed and archived. | Archive is NOT restored; reels render again. |
| Placement | point rows + snapshot | New version has its own; retry counters reset. | Old placement returns. |
| Files | R2 | Old cut and clips kept: `_referenced_cut_paths` includes every version's cut, clip cleanup checks every version's points and archived reels. | Nothing to fetch back. |
| Switching back at all | `activate_match_processing_version` accepts `superseded` | Admin-only today (`admin_restore_match_version`). Needs the version's job row, and job rows are never purged. | Possible. |

### 1c. Live facts and known defects

| Fact | Value |
| --- | --- |
| Source | Read-only, live database `pdycinmyfnritemrsfjf`, 2026-09-25; nothing changed |
| Matches / hand-cut matches | 240 / 9 |
| Matches with more than one version | 1 |
| `match_reprocess` jobs ever run | 2 |
| Matches with at least one scored point | 147 |
| Matches with coach reviews / open reviews | 6 / 2 |
| Flags | `match_reprocessing_enabled` false, `hand_cut` off (admins only), `device_hand_cut` admins, canonical score commands and readers on |
| Defect, known | A candidate never runs the body-first assembler: `if active and points_kwargs.get("pipeline") == "bodies"` (worker.py 10756). A reprocessed version is v2 while uploads are bodies. |
| Defect, known | After a switch, `matches.job_id` moves, and web Home and the library show the original upload job as a stray card (`HomeOverview.tsx:338`, `MatchLibrary.tsx:317`). |
| Defect, new | Live `resolve_share_placement` lost its version filter (it bypasses RLS), so after any switch a public match link's serve map mixes both cuts' placements. One-line fix. |

---

## 2. How to extend it

The core change: **a version records how it was cut.** Add `cut_source` (`auto` / `manual`) to `match_processing_versions`, backfill it, and have `activate_match_processing_version` write it onto `matches.cut_source`. The match column becomes a projection, like `cut_path` already is, so every reader that uses it today (web and iOS analysis gating, `job_queue_name` routing hand-cut placement to the hand lane, `hand_cut_clip_pre`) keeps working unchanged.

```
             Replace                                   New match
  current ──────────────► candidate version ──► active      copy the match row (same original)
  version                  (own points, own clips,          ──► ordinary processing or hand cut
  kept, superseded ◄─────  own cut file)                        on the copy; original untouched
             "Use this cut" switches back
```

| Direction | Replace | New match | Worker change | Price |
| --- | --- | --- | --- | --- |
| (a) Hand cut → automatic | Candidate version from the original through the existing `match_reprocess` path, with no support request, charged like `claim_processing`, refunded if it fails, activated when ready. | Copy the row, then the ordinary `claim_processing`. Runs bodies like any upload. | Replace: **main/fast release** (body pass on candidates, a candidate without a support request). New match: none. | Minutes for the length, as for an upload |
| (b) Automatic → hand cut | Marker opens on the processed match and plays the original. Draft prefilled from the current cut. Claim makes a candidate version; the hand lane cuts it into `versions/<version>/` and activates it. | Copy the row with the prefilled draft, then the ordinary `claim_hand_cut`. | Replace: **hand-lane release**. New match: none. | Free |
| (c) Hand cut → hand cut again | As (b). Prefill from the current version's points, not from the old frozen draft, because the points include later Split, Join, Adjust and scoring. | As (b). | As (b). | Free |
| (d) Switch back | Owner RPC wrapping `activate_match_processing_version`, restoring that version's archived reels. | n/a | None | Free |
| (e) New match | `copy_match_for_recut`: new `matches` row with the same `raw_path`, details, first server, side, duration and `content_checked_at`, no second storage charge for the original. Nothing else is copied. | | None | As the chosen method |

What the prefill is: every visible point of the current version becomes a mark (`t0`, `t1` in source seconds, winner, let, star). Both clocks are already source seconds (`points.t0` = `mark.t0`, `hand_cut_device.plan_hand_cut`). Server corrections and game-end marks have no place in a mark, so they stay with the old cut. The marks must be clamped to the claim's rules (0.7 s to 180 s, no overlap, at most 400).

Why not use the ordinary path for Replace: it writes into the active version, sets the match to `processing` and deletes that version's points (`create_match`, worker.py 4872). That is exactly the one-way behaviour this removes.

---

## 3. What the player sees

### 3a. Where

A new Tools row, **Cut**, directly above **Processing**, on web desktop, mobile web and iOS. Processing stays as it is: a request form we review, with a message box, whose row reads "Report a problem". A direct action with an immediate result does not belong in it. Automatic → automatic stays the reviewed "Request reprocessing" there.

### 3b. Copy

| Moment | Copy |
| --- | --- |
| Tools row | **Cut**, trailing "Automatic", "Marked by hand", "Cutting" or "Processing" |
| Sheet title | Cut |
| Current cut | "Automatic, 20 Sep" or "Marked by hand, 25 Sep" |
| Action on an automatic cut | "Mark the points yourself", trailing "Free" |
| Action on a hand cut | "Mark the points again", trailing "Free" |
| Action on a hand cut | "Process automatically", trailing "12 min" (hidden when the original is no longer stored) |
| Marker, prefilled | Opens on the current cut's points; outlined "Start again" clears them |
| Choice, at "Cut the match" or before processing | "Replace the current cut" / "You can switch back at any time." and "Make a new match" / "This match stays as it is." |
| Primary button | "Cut the match" (hand) or "Process · 12 min" (automatic); outlined "Keep marking" or "Cancel" |
| Under the choice, Replace selected | "Notes, tags and coach reviews stay with the current cut." |
| While it runs | "Your current cut stays available until the new one is ready." |
| Done (bell) | "Your new cut is ready." |
| Failed | "The new cut did not finish. Your current cut has not changed." Hand cut adds "Your marks are saved." |
| Earlier cuts | Heading "Earlier cuts", rows like "Automatic, 20 Sep" with outlined "Use this cut" |
| Switch confirm | "Use this cut?" / "Scores, stars and notes belong to each cut." / "Use this cut" / "Cancel" |
| Match has a coach review | Replace not offered: "This match has a coach review, so the new cut will be a new match." |
| Removed | "This match cannot be processed automatically afterwards." (`MarkPoints.tsx:2809`, `PlayerTakeoverMark.swift:1272`) |

### 3c. What carries over

| Item | Replace, marked by hand (prefilled) | Replace, automatic | New match |
| --- | --- | --- | --- |
| Match details, your side, first server | Kept | Kept | Copied |
| Winners, lets, stars | In the marks, editable | Start empty; the old cut keeps them | By hand: in the marks. Automatic: empty |
| Server corrections, game-end marks | Stay with the old cut | Stay with the old cut | Not copied |
| Point notes, tags, drawings | Stay with the old cut | Stay with the old cut | Not copied |
| Match notes | Kept | Kept | Not copied |
| Coach access | Kept | Kept | Not copied |
| Coach reviews | Replace not offered | Replace not offered | Untouched on the original |
| Share links | Same links, new cut; single-point links keep the old clip | Same | None yet |
| Highlights, placement | Built again for the new cut | Built again | As a new match |
| The old cut | Kept, "Use this cut" any time | Kept | The original match, untouched |

### 3d. Price

| Action | Cost |
| --- | --- |
| Mark by hand, either choice | Free |
| Process automatically | Same minutes as an upload of that length, refunded if it fails |
| Switch back | Free |
| Process automatically when an automatic cut already exists | Offer "Use this cut" on it instead, free |
| New match storage | The original is not counted twice; the new clips count |

### 3e. Per surface

| Surface | Difference |
| --- | --- |
| Web desktop | Cut is one tile in the three-column Tools grid; its sheet uses the existing match-page sheet; the marker is the floating desktop card. |
| Mobile web | Checked at 393 x 660. List row; buttons full width, 44 px; marker pad under the video. |
| iOS | `PLSheetScaffold` + `Form`; marker is `PlayerTakeoverMark`; the phone cuts when `device_hand_cut` allows it. Needs a TestFlight build. |
| Coach | No Cut row; sees the active cut only. |

---

## 4. Changes needed

### 4a. Work items

| # | Change | Layer | Phase |
| --- | --- | --- | --- |
| 1 | `cut_source` on versions, projected by `activate_match_processing_version`, which also restores the target version's archived reels | Migration | 1 |
| 2 | Owner RPCs: `my_match_cuts`, `use_match_cut`, `start_recut` (writes the prefilled draft, unfreezes it), `claim_hand_recut` (candidate version + `hand_cut` job with intent), `copy_match_for_recut` | Migration | 1 |
| 3 | `_hand_cut_hand_back` deletes only the candidate's points and never touches the match row for a candidate | Migration | 1 |
| 4 | `claim_device_hand_cut` returns version-scoped clip keys; `deviceCutKeys` in `/api/hand-cut/device` and `hand_cut_device.device_keys` agree | Migration, web, hand lane | 1 |
| 5 | `publish_hand_cut_candidate`: `publish_hand_cut_v2` and `normalize_manual_cut_observations` both require the cut to be the active one on a `processing` match | Migration | 1 |
| 6 | `match_reprocess_source` drops the hand-cut refusal (a candidate never touches active points) | Migration | 1 |
| 7 | One open candidate per match (the existing unique index only covers support requests); clients cannot create candidate jobs directly | Migration | 1 |
| 8 | `resolve_share_placement` version filter | Migration | 1 |
| 9 | `ledger_on_match_delete` hands a shared original's storage row to the surviving match | Migration | 1 |
| 10 | `process_hand_cut` candidate mode: points into the candidate version, clips under `versions/<version>/`, no `create_match` on the match row, then activate if Replace; `_hand_cut_rollback` and the "already has points" check scoped to that version | Hand lane release | 1 |
| 11 | Cut row, sheet, choice step, earlier cuts, marker on a processed match, remove the old line, fix the Home/library stray card | Web, iOS | 1 |
| 12 | `claim_auto_recut` (charge like `claim_processing`), refund on a failed candidate, activate when ready (retrying while a derived job runs) | Migration | 2 |
| 13 | Body pass for candidates (worker.py 10756); candidate without a support request; count candidate clips in storage | Main/fast release + Modal twin | 2 |

`/admin/processing` needs nothing new unless a new stage is added: `hand_cut` ("Hand cut") and `match_reprocess` ("Reprocessing a match") already have labels.

### 4b. Releases

| Surface | Phase 1 | Phase 2 |
| --- | --- | --- |
| Hand lane sealed release | Yes. No cloud twin; three were done on 24 and 25 Sep | No |
| Main/fast release + Linux twin | **No** | **Yes, unavoidable** for automatic Replace. Bundle it with the release already due to carry the three cloud-twin `worker.py` changes |
| Database | Yes | Yes |
| Web deploy / iOS build | Yes / Yes | Small / none (the UI already exists, Replace just becomes available) |

### 4c. Risks

| Risk | Evidence | Answer |
| --- | --- | --- |
| A failed hand cut on a match that already has a cut deletes the current cut's points | `_hand_cut_rollback` (worker.py 7125) and `_hand_cut_hand_back` run `delete from points where match_id = …` with no version filter | Scope both to the job's version. Must land first |
| The new cut overwrites the current cut's clips | Every cut writes `points/<user>/<match>/NN.mp4` (193 live clips named `01.mp4`), and the phone's claim hard-codes that prefix | Write under `versions/<version>/`, as reprocess candidates already do |
| Canonical score out of step | Switching rebuilds it (verified); but the hand-cut publish assumes the active version | Separate candidate publish (item 5); the rebuild happens on activation |
| Share links after Replace | Highlights link breaks until the reel renders again; serve map mixes cuts; starred and tag links show the new cut's | Restore archived reels on switch back; fix item 8; say it in the confirm line |
| Coach review findings vanish | RLS hides inactive points even for a completed review | New match only when a review exists |
| An open support request can no longer be published | `admin_publish_match_version` refuses when the source version changed | Offer Cut actions only when no support request is open, and the reverse |
| A shared original deleted | The content gate deletes a rejected original at once | The copy carries `content_checked_at`, so the gate never runs on it. Deleting a match leaves the original in place (`/api/delete-match` checked), and the sweep protects any original a live match points at |
| Automatic Replace is lower quality than an upload | Candidates skip the body assembler | No automatic Replace until item 13 ships |
| Switching refused mid-job | Activation refuses while reclip, placement or reel work runs | Retry, then say "Try again in a minute" |
| Edits made while the new cut runs | They land on the old cut | Covered by "Scores, stars and notes belong to each cut" |

---

## 5. Decisions for Adil

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| 1 | Where the entry goes | A new Tools row **Cut**, above Processing | Processing is a reviewed request form that reads "Report a problem"; re-cutting is a direct action with an immediate result |
| 2 | What re-marking starts from | The current cut's points, winners and stars prefilled, with "Start again" | Turns a re-cut into an edit, carries the scores the player can see, and works the same from an automatic cut |
| 3 | Scores when switching to automatic | Start unscored; the old cut keeps its scores and is one tap away | Matching rallies across two different cuts is guesswork, and the canonical score spec forbids attaching owner truth without a proven match. 147 matches have scores, so say it in the confirm step |
| 4 | Pricing | Automatic costs its normal minutes (refunded on failure); by hand and switching back are free; if an automatic cut exists, offer it free instead of charging again | The same rule as uploads, and no one pays twice for a cut they already have |
| 5 | Order | Phase 1 now: New match either way, re-mark by hand with Replace, switch back. Phase 2: automatic Replace in the next main/fast release | Phase 1 needs no main/fast release. Automatic Replace today would quietly give a lower-quality cut than a fresh upload |

Also assumed, say if not: a match with a coach review only offers "Make a new match".
