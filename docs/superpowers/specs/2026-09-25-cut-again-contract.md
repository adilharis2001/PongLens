# Cut again: interface contract

Companion to `2026-09-25-cut-again-design.md` (approved by Adil 2026-09-25 with assumptions A, B, C as written). Web, iOS and the database/worker build against exactly this. Phase 1 only: automatic Replace stays unavailable.

## Database calls (all SECURITY DEFINER, owner only, `authenticated`)

| Call | Returns | Does |
| --- | --- | --- |
| `recut_options(p_match_id uuid)` | jsonb `{available bool, reason text\|null, replace_by_hand bool, replace_automatic bool, has_coach_review bool, has_match_notes bool, cut_source text}` | What the More options sheet may offer. `available` false with `reason` one of `not_ready`, `processing`, `no_source`, `support_request`. `replace_by_hand` false when `has_coach_review`. `replace_automatic` false in phase 1 (driven by `app_config.recut_auto_replace`, seeded `off`, on the public read list). Hand-cut rows are offered only when `hand_cut_enabled(auth.uid())` (the client already reads that) |
| `start_recut(p_match_id uuid, p_fresh boolean default false)` | jsonb `{marks: Mark[], mode: 'cut'\|'score', updated_at}` | Prepares the hand-cut draft for marking again. If an unsubmitted draft exists and `p_fresh` is false, returns it unchanged (resume). Otherwise writes the draft from every visible point of the active version (full Mark shape: `id`, `t0`, `t1`, `winner`, `isLet`, `starred`, `tap` = null, `rate` = null; source seconds), clamped to the claim's rules, `submitted_at` null, `mode` = `score` if any point has a winner or let, else `cut`. Never changes the match |
| `claim_hand_recut(p_match_id uuid, p_marks jsonb, p_replace boolean)` | jsonb `{job_id uuid, match_id uuid}` | The hand-cut claim for a processed match. `p_replace` true: builds a candidate version on this match (match stays `ready` and playable; `match_id` = this match). False: creates the copy (as `copy_match_for_recut`) and claims an ordinary hand cut on it (`match_id` = the new match). Same mark validation and error codes as `claim_hand_cut`, plus `coach_review` (replace refused), `support_request`, `already_processing` |
| `copy_match_for_recut(p_match_id uuid)` | uuid (new match id) | For automatic "Keep": a new `uploaded` match with the same original, details, side, first server, duration and content-check stamp; no points, no notes. The client then calls the existing `/api/process` for the new match (charging, trim, strictness unchanged) |

Existing `hand_cut_drafts` rules apply unchanged: insert when no row is known, conditional update of `marks, mode, updated_at` otherwise, never upsert.

## Error codes to player copy

| Code | Copy |
| --- | --- |
| `coach_review` | not shown as an error: Replace is greyed with "Has a coach review" |
| `support_request`, `processing`, `already_processing` | "Something is already running on this match." |
| `no_source` | "The original video is no longer stored." |
| everything else | the existing hand-cut messages from `RawMatchView.tsx` |

## Screens (web desktop, mobile web, iOS)

| Element | Copy and behaviour |
| --- | --- |
| Tools row | **More options** replaces the **Processing** row (same slot). Hidden for coaches |
| Sheet title | More options |
| Row 1 | "Process automatically", trailing the minutes (as the raw page's "Automatically": e.g. "12 min"). Accordion: the same trim and strictness controls as the raw page, then the choice, then the primary button "Process · 12 min" |
| Row 2 | "Mark the points yourself", trailing "{N} marked" when an unsubmitted draft exists, else nothing. Accordion: the Score switch (same rules as the raw page) and "Start marking" / "Keep marking". Only when `hand_cut_enabled` |
| Row 3 | "Report a problem": opens today's Processing request form, unchanged |
| The choice | Two rows, one selected: "Replace this match" / "Keep this match and add a new one". Default Keep. Under Replace when selected: "Points, scores and point notes will be deleted." and, only when `has_match_notes`: "Match notes stay with the match." Replace greyed with "Has a coach review" when `has_coach_review`. Under Process automatically, Replace is greyed with no line while `replace_automatic` is false |
| Where the choice sits | Process automatically: inside its accordion above the button. Marking: in the marker's review sheet above "Cut the match" (only when marking a processed match) |
| Marker on a processed match | Plays the original. Opens on the prefilled marks. Gate shows an outlined "Start again" when marks exist: confirm "Clear all marks?" with "Clear" / "Cancel" |
| After Replace | Sheet closes; the match keeps playing; the ordinary processing progress shows ("Cutting the video" etc.) |
| After Keep | Opens the new match's page (it shows as processing) |
| Failure (Replace) | Bell "The new cut didn't finish." with "Your marks are saved." for a hand cut. The match is unchanged |
| Never | "free", "Mac", "iPhone", "version", explanations of what automatic does to scores |

## Phase 2 (not built yet)

Automatic Replace will be `claim_auto_recut(p_match_id uuid, p_replace boolean, p_trim_start_s numeric, p_trim_end_s numeric, p_strictness text)` returning jsonb `{job_id, match_id}`: charged like `claim_processing`, refunded if it fails, the candidate made live when ready. It arrives with the main/fast release that gives candidates the body-first assembler; until then `recut_auto_replace` stays `off` and `replace_automatic` false.

As built in phase 1 (database half): `docs/research/2026-09-25-cut-again/RELEASE.md`, "Contract notes for web and iOS".
