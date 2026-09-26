# Cut again: interface contract

Companion to `2026-09-25-cut-again-design.md` (approved by Adil 2026-09-25 with assumptions A, B, C as written). Web, iOS and the database/worker build against exactly this. Phase 1 only: automatic Replace stays unavailable.

**As shipped (2026-09-26).** What changed after this spec; the code and these lines win where they differ below.

- **Pick-one, nothing selected.** The two ways (Automatically, Mark the points yourself) are one pick-one group under "Process again", and nothing is selected until the player taps one. Replace this match / Keep this match and add a new one also start with nothing selected, not Keep.
- **Minutes line.** With the automatic way's Process again button: "Uses N of your M minutes."
- **No cut strictness.** Strictness is not a choice anywhere a player sees; automatic re-cuts always send `normal`.
- **Trim is `TrimPreview`,** the raw page's trim with its preview, on web and iOS.
- **Keep is one call.** Automatic Keep calls `claim_auto_recut(p_replace := false)`, which copies the match and claims its processing in one transaction; `copy_match_for_recut` + `/api/process` is no longer used, so a refused charge leaves no unprocessed copy.
- **Automatic Replace is on for everyone** (`app_config.recut_auto_replace = on`).
- **Replace by hand says "Point notes will be deleted."** Marking by hand keeps each point's score through its mark; automatic Replace keeps "Points, scores and point notes will be deleted."

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

## Phase 2 (built 2026-09-25, not yet released)

Automatic Replace is `claim_auto_recut(p_match_id uuid, p_replace boolean, p_trim_start_s numeric, p_trim_end_s numeric, p_strictness text)` returning jsonb `{job_id, match_id}`: charged like `claim_processing`, refunded if it fails, the candidate made live when ready. It arrives with the main/fast release that gives candidates the body-first assembler; until then `recut_auto_replace` stays `off` and `replace_automatic` false. Migration `20260925170532_cut_again_auto_replace.sql`.

| Where | As built |
| --- | --- |
| Replace | A `match_reprocess` job (no support request, options `recut: 'replace'`) on the main lane; `match_id` = this match. `my_match_processing_feedback` names it while it runs, so both apps show the ordinary stages |
| Keep | Also accepted (`p_replace` false): the copy plus `claim_processing` on it, `match_id` = the new match. Both apps keep using `copy_match_for_recut` + `/api/process` |
| Refusals | `claim_hand_recut`'s (`already_processing`, `bad_state`, `support_request`, `no_source`, `duration_unknown`, `coach_review` for Replace), then the charge's (`commerce_disabled`, `invalid_input`, `trim_too_short`, `queue_full`, `insufficient_minutes`), and `not_enabled` while the switch does not allow this account. Copy: the contract's for its codes, the raw page's Process sentences for `insufficient_minutes` / `queue_full`, else "Something went wrong. Try again." |
| Failure | Bell "The new cut didn't finish." (no second line); email "The new cut of your match didn't finish" saying the match is unchanged and the minutes are back |
| Success | The ordinary "Match ready" bell and ready email |

As built in phase 1 (database half): `docs/research/2026-09-25-cut-again/RELEASE.md`, "Contract notes for web and iOS".
