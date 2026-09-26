# Cut a match again

**Date:** September 25, 2026. **Status:** Design from Adil's decisions of the same day. Not implemented.

**As shipped (2026-09-26).** What changed after this spec; the code and these lines win where they differ below.

- **Pick-one, nothing selected.** The two ways (Automatically, Mark the points yourself) are one pick-one group under "Process again", and nothing is selected until the player taps one. Replace this match / Keep this match and add a new one also start with nothing selected, not Keep.
- **Minutes line.** With the automatic way's Process again button: "Uses N of your M minutes."
- **No cut strictness.** Strictness is not a choice anywhere a player sees; automatic re-cuts always send `normal`.
- **Trim is `TrimPreview`,** the raw page's trim with its preview, on web and iOS.
- **Keep is one call.** Automatic Keep calls `claim_auto_recut(p_replace := false)`, which copies the match and claims its processing in one transaction; `copy_match_for_recut` + `/api/process` is no longer used, so a refused charge leaves no unprocessed copy.
- **Automatic Replace is on for everyone** (`app_config.recut_auto_replace = on`).
- **Replace by hand says "Point notes will be deleted."** Marking by hand keeps each point's score through its mark; automatic Replace keeps "Points, scores and point notes will be deleted."

**Research behind it:** `docs/research/2026-09-25-reversible-cuts/PROPOSAL.md` (what exists in the database and worker, verified against live definitions).

---

## Summary

A player can cut any processed match again, by hand or automatically, from one Tools row called **More options**. At the last step they choose to replace the match (its points, scores and point notes are deleted, match notes stay) or to keep it and add the new cut as a new match. There is no switching between cuts: a replaced cut is gone for the player, and the current match stays exactly as it is until the new cut is ready.

---

## 1. Decisions (Adil, 2026-09-25)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Switching between cuts | Not a feature. A new cut either replaces the match or becomes a new match. Nothing lists earlier cuts |
| 2 | Where it lives | One Tools row, **More options**, which takes the place of today's **Processing** row. No new rows beyond it |
| 3 | What it holds | Process automatically, Mark the points yourself, Report a problem (today's request form, unchanged) |
| 4 | Marking again | Starts from the current cut's points, winners and stars, editable, with **Start again** to clear them. The same from an automatic cut |
| 5 | Replace or new match | The player chooses at the last step. Replace deletes points, scores and point notes; match notes stay with the match. New match leaves this one untouched |
| 6 | Price | Automatic costs its normal minutes and is refunded if it fails. Nothing is shown for marking by hand. The word "free" is never used, anywhere |
| 7 | Scores and automatic | No copy about scores when processing automatically. Automatic scoring is coming |
| 8 | Copy | Only what the player needs. No subtitles, no explanations, never Mac, iPhone, worker or version |
| 9 | Unprocessed matches | Both ways in are accordions on "Break it into points": Automatically (trim, strictness, minutes) and Mark the points yourself (Score toggle, Start marking). No overlay to choose a mode |

---

## 2. What the player sees

### 2a. Where

| Match state | Entry |
| --- | --- |
| Not processed yet | The "Break it into points" card, as today, with both rows as accordions (being built now, see section 6) |
| Processed | Tools → **More options** (replaces the **Processing** row). Opens a sheet with the same two accordion rows as the raw page, then **Report a problem** |
| Being processed | More options shows the running job; nothing else can start |
| Coach viewing | No More options row |

### 2b. The sheet

```
 More options
 ┌──────────────────────────────────────────────┐
 │ Process automatically                 12 min ▸│  accordion: trim, strictness,
 │                                               │  then the choice, then "Process · 12 min"
 │ Mark the points yourself                     ▸│  accordion: Score toggle, then
 │                                               │  "Start marking"
 │ Report a problem                             ▸│  today's request form, unchanged
 └──────────────────────────────────────────────┘
```

The accordions are the same components as on the raw page, so both places look and behave the same on web desktop, mobile web and iOS.

### 2c. The choice (last step of either way)

| Where it appears | Process automatically: inside its accordion, above the button. Mark the points yourself: in the marker's review sheet, above "Cut the match" |
| --- | --- |
| Options | **Replace this match** / **Keep this match and add a new one** (two rows, one selected; default: Keep) |
| Under Replace, when selected | "Points, scores and point notes will be deleted." Second line only if the match has match notes: "Match notes stay with the match." |
| Replace unavailable | Greyed with "Has a coach review" when a coach review exists (see section 7, assumption A) |
| Button | Automatic: "Process · 12 min". By hand: "Cut the match" |

No other copy. No price line for marking by hand. No line about scores for automatic.

### 2d. After pressing it

| Moment | Replace | Keep and add a new one |
| --- | --- | --- |
| Right away | The sheet closes. The match stays exactly as it was and plays as before; Tools shows the ordinary processing progress | A new match appears in Matches as processing, with the same title, date, venue, opponent, side and first server |
| When ready | The match shows the new cut. The ordinary ready notification and email | The new match is ready. The same notification and email |
| If it fails | The match is unchanged. Bell: "The new cut didn't finish." By hand adds "Your marks are saved." Automatic minutes are refunded | The new match shows as failed, like any failed upload. Minutes refunded |

### 2e. Marking again

| | |
| --- | --- |
| Opens with | Every visible point of the current cut as a mark: start, end, winner, let, star |
| Start again | Outlined button at the gate. Asks "Clear all marks?" with "Clear" and "Cancel", then starts empty |
| Kept from the current cut | Winners, lets and stars (in the marks) |
| Not carried | Server corrections and game-end marks (they have no place in a mark), point notes, tags, drawings |
| Rules | The same marker, the same Score toggle, the same review sheet, plus the choice from 2c |

### 2f. Copy removed or changed

| Where | Now | After |
| --- | --- | --- |
| Tools row | "Processing", trailing "Report a problem" | "More options" |
| Marker review sheet | "This match cannot be processed automatically afterwards." | Removed (being done now) |
| "Mark the points yourself" | Trailing "Free" | Nothing, or "{N} marked" when a draft exists (being done now) |
| Anywhere a cut runs | "on your iPhone", "on the Mac" | Never (being done now) |

---

## 3. What happens to the match's data

| Item | Replace | Keep and add a new one |
| --- | --- | --- |
| Title, date, venue, opponent, your side | Kept | Copied to the new match |
| First server | Kept | Copied |
| Match notes | Kept (they belong to the match) | Stay on this match; the new match has none |
| Points, winners, lets, stars | By hand: carried in the marks. Automatic: the new cut starts unscored | Same as Replace, on the new match |
| Server corrections, game-end marks | Deleted with the old cut | Stay on this match |
| Point notes, tags, drawings | Deleted | Stay on this match |
| Coach access | Kept; the coach sees the new cut | This match only |
| Coach reviews | Replace unavailable (assumption A) | Stay on this match |
| Share links | The match link shows the new cut. Links to single points, starred sets and highlights of the old cut stop working | Stay on this match |
| Highlights, placement maps | Built again for the new cut when requested | As any new match |
| Original video | Kept | Shared by both matches, stored and counted once |
| Old cut video and clips | No longer counted in storage from the moment the new cut is live; the files are removed 30 days later (a quiet safety window for support) | Kept; the new match's cut and clips add to storage |

---

## 4. How it works

### 4a. Replace keeps the match safe until the new cut is ready

The processing-versions layer already builds a new cut beside the live one without touching it (a "candidate" version with its own points, clips under `versions/<version>/` and its own cut file) and makes it live in one database step. Replace uses exactly that. The player never sees versions: there is no list of earlier cuts, and a replaced version is never offered again.

```
 More options → Replace
      │
      ▼
 candidate version  ── built by the hand lane (by hand) or the main lane (automatic)
      │                  live match untouched, still playable
      ├─ fails  → candidate discarded, match unchanged, marks saved, minutes refunded
      ▼
 ready → made live in one step → old version superseded, its storage uncounted,
                                   its files swept 30 days later
```

### 4b. Keep makes a new match that shares the original

`copy_match_for_recut` creates a new match row pointing at the same original, with the match details, side and first server copied and the content check already recorded (so the check never runs again and can never delete the shared original). Then the ordinary path runs on the copy: `claim_processing` for automatic, `claim_hand_cut` or the phone cut for by hand. Deleting either match leaves the original for the other (checked).

### 4c. What each combination needs

| From → To | Keep and add a new one | Replace |
| --- | --- | --- |
| Automatic → by hand | Copy + ordinary hand cut. Phase 1 | Candidate hand cut on the hand lane. Phase 1 |
| By hand → by hand | Copy + ordinary hand cut. Phase 1 | Candidate hand cut. Phase 1 |
| By hand → automatic | Copy + ordinary processing. Phase 1 | Candidate automatic cut. **Phase 2** |
| Automatic → automatic | Copy + ordinary processing. Phase 1 | Candidate automatic cut. **Phase 2** |

Automatic Replace waits for Phase 2 because a candidate automatic cut today skips the body-first assembler that every upload runs (worker.py, the `pipeline == "bodies"` guard on candidates), so it would quietly be worse than a fresh upload. Until then, "Replace this match" is shown greyed under Process automatically with no explanation line; Keep works.

---

## 5. Changes

### 5a. Must land first

| Defect | Why it matters here | Fix |
| --- | --- | --- |
| A failed hand cut deletes every point on the match (`_hand_cut_rollback` in worker.py and `_hand_cut_hand_back` in the database run `delete from points where match_id = …`) | A failed re-cut would wipe the player's current cut | Scope both to the job's own version |
| Every cut writes clips to `points/<user>/<match>/NN.mp4`, and the phone's claim hard-codes that prefix | A re-cut would overwrite the live clips | Candidates write under `versions/<version>/`, as support reprocessing already does |
| The public share page's serve map (`resolve_share_placement`) has no version filter | After any replace it would mix dots from both cuts | Add the filter (one line) |

### 5b. Work items

| # | Change | Layer | Phase |
| --- | --- | --- | --- |
| 1 | `cut_source` on each version, projected onto `matches.cut_source` when a version goes live (every current reader keeps working) | Migration | 1 |
| 2 | `start_recut(match)`: writes the prefilled draft from the current points and unfreezes it | Migration | 1 |
| 3 | `claim_hand_recut(match, marks, replace)`: candidate version + hand-cut job; `claim_device_hand_cut` gains the same `replace` mode with version-scoped keys | Migration, route, hand lane | 1 |
| 4 | `copy_match_for_recut(match)` for Keep, used by both ways | Migration | 1 |
| 5 | Candidate publish for hand cuts: points into the candidate, then make it live on success; the version-scoped rollback from 5a | Migration + hand-lane release | 1 |
| 6 | Superseded version: storage ledger negated when it is replaced; its files swept after 30 days | Migration (ledger), main-lane housekeeping for the sweep | Ledger 1, sweep 2 |
| 7 | One open cut job per match; clients cannot create candidate jobs directly | Migration | 1 |
| 8 | Share placement filter (5a) | Migration | 1 |
| 9 | Original's storage row passes to the surviving match when one of two sharing it is deleted | Migration | 1 |
| 10 | More options row and sheet (replacing Processing), the shared accordions, the choice, Start again, the failure bell text | Web desktop, mobile web, iOS | 1 |
| 11 | Home and library stop showing the original upload as a stray card after a replace (`HomeOverview.tsx`, `MatchLibrary.tsx`, iOS LibraryStore) | Web, iOS | 1 |
| 12 | `claim_auto_recut(match, replace, trim, strictness)`: charged like `claim_processing`, refunded on failure, candidate made live when ready | Migration | 2 (Keep path of automatic works in 1 through the copy) |
| 13 | Body-first assembler on candidates; candidate without a support request; candidate clips counted in storage | Main/fast sealed release + its cloud twin | 2 |

### 5c. Releases

| | Phase 1 | Phase 2 |
| --- | --- | --- |
| Hand lane | One release (candidate hand cuts, version-scoped rollback). No cloud twin | None |
| Main/fast | None | One release, bundled with the one already due for the cloud-twin `worker.py` changes |
| Database | Yes | Yes |
| Web / iOS | Deploy / TestFlight build | Replace under Process automatically stops being greyed (no build needed if driven by a flag) |

### 5d. Every surface that has to say it

| Surface | Change |
| --- | --- |
| `/admin/processing` | Nothing new unless a new stage is added: `hand_cut` and `match_reprocess` are already labelled. A candidate job's row says "Hand cut" / "Reprocessing a match" as today |
| Admin issues page | The reviewed "Request reprocessing" flow keeps working; it refuses while a player's own re-cut is running, and the reverse |
| Emails | The ordinary ready email for a replaced or new match; the failure email for a failed re-cut says the match is unchanged |
| Share page | Version filter (5a) |

---

## 6. Already in progress (the owner's copy pass of 2026-09-25)

These ship before Cut again and are its foundation:

- "Break it into points": Mark the points yourself becomes an accordion with the Score toggle and "Start marking", like Automatically.
- The marker's first question is gone; Score is a toggle inside the marker too; Done is the primary button.
- "Free" and every mention of where a cut runs are removed; a phone cut that can't finish hands over silently.
- "This match cannot be processed automatically afterwards." is removed.

---

## 7. Assumptions to confirm

| | Assumption | Why |
| --- | --- | --- |
| A | A match with a coach review offers only "Keep this match and add a new one" | Replace would delete the points a coach's paid findings are attached to; six matches have reviews, two still open |
| B | The default choice is Keep | Replace deletes the player's work; the safer default costs one tap to change |
| C | A support request in progress and a player's own re-cut cannot run on the same match at once | Both would build a candidate for the same live cut |

---

## 8. Build order

| Step | What |
| --- | --- |
| 1 | The three fixes in 5a (database migration + hand-lane release). Nothing user-visible |
| 2 | Keep and add a new one, both ways (items 4, 9, 10, 11). Uses only ordinary processing and hand cuts on the copy |
| 3 | Replace by hand (items 1, 2, 3, 5, 6-ledger, 7, 8) |
| 4 | Phase 2: Replace automatically (items 6-sweep, 12, 13) with the next main/fast release |

Each step goes out to the two admin accounts first, the way hand cutting did.
