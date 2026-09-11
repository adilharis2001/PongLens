# Scorekeeper and downstream playback: recommendation spec

Keep the winner, the observed ending, and the video used to show a point separate, so correcting one does not silently change the others. Apply the fixes to Watch, future scoring sessions, coach orders and findings, point views, and rendered reels, not just the scoring buttons. Missing-point access is investigated here as #5 but remains on hold, with no change to plus-button density authorized.

| Document control | Value |
| --- | --- |
| Date / status | September 11, 2026. Adil approved implementation on web desktop, mobile web and native iOS, in an isolated worktree. Deployment remains separate. |
| Approved decisions | Only a first answer during uninterrupted playback may create end evidence; preserve the exact clip revision cited by a coach; ask before a moved game boundary loses or changes a manually named winner. #5 remains on hold. |
| Numbering | Uses the **revised ranking** from the second audit: #3 is Undo; #5 is missing-point access; #7 is stale clip caching; #8 is missed pauses. |
| Scope | Web desktop, mobile web, native iOS, database mutations, Mac worker and the equivalent remote-worker code path. Coach orders includes active review workspaces and delivered findings. |
| Evidence boundary | Current local checkout, database migration definitions, targeted reproductions and existing tests. This does not establish the deployed database definitions, current production switches or device-level incidence. |
| Concurrent work | Automatic-highlight policy, its API, and worker files already contain uncommitted work by others. Their current behavior was inspected, not changed; reconcile that work before implementation. |
| Deliverable | Ten individual fix specifications, common contracts, downstream effects, acceptance cases and release gates. A task-by-task implementation plan follows design approval. |

## 1. Approach and limits

| Approach | Benefit | Cost / decision |
| --- | --- | --- |
| **Recommended: targeted fixes around shared ending and media-source contracts** | Repairs the originating mistakes and makes every consumer agree about point identity, trustworthy endings and available footage. Keeps the existing match cut and UI. | Requires coordinated client, API, database and worker changes, released in small groups below. |
| Patch the ten visible symptoms independently | Smaller first patch. | Leaves coach players, exports and narrower database queries using different assumptions. Suitable only for the immediate correction/Undo containment, not the completed fix. |
| Rebuild the complete match cut after every edit | Eventually makes the main file reflect the new card sequence. | Moves every cut-clock timestamp, interrupts playback and creates expensive invalidation work. Not recommended for this task. |

| Preserve | Do not introduce through this work |
| --- | --- |
| Existing scoring controls, colours, gestures and layout | A redesigned scorekeeper, new mandatory end-tapping step or a plus between every pair of points |
| The player's confirmed winner and first-server answers | Winner inference from body movement, ball detection or when playback paused |
| Body/ball card assembly and original recordings | Reprocessing all matches, changing detector thresholds, or deleting footage to implement playback trims |
| Separate highlight selection and viewing purposes | Identical tail lengths on every surface merely for code uniformity |
| Coach order terms and author-written findings | Repricing, reopening orders, rewriting feedback or extending access permissions |

## 2. What the downstream trace established

| Reader today | Current source / authority | Consequence for this spec | Evidence |
| --- | --- | --- | --- |
| Main Watch and scorekeeper | Match cut; separate inserted-point clips in some cases; shared effective-end helper | Fix both tap capture and playback-source selection. A timestamp alone does not prove the cut contains a rally. | E1, E2 |
| Point detail / breakdown video | Current point clip; windowed cut fallback when clip is stale or missing | Keep the immediate fallback only where the requested footage is demonstrably in the cut. Inspection can retain more context than Watch. | E3 |
| Active coach order, web | Match cut, point jumps and server-computed skip spans | Inherits bad tap endings; point jumps do not currently use the scorekeeper's inserted-clip detour. Its query also omits the detector ending. | E4 |
| Active coach order, iOS | Match cut in the inline workspace; shared takeover when opened | Inline and takeover must both be covered. The narrower workspace model drops detector endings and game overrides. | E5 |
| Delivered coach findings | Cited point IDs resolve to their current clip files; running scores are computed separately | A tap-only correction need not recut these files. Structural edits can change or remove the footage a finding cites, which needs explicit protection. | E6 |
| Normal full / starred / single-point rendered exports | API derives cut ranges and scores; worker prefers the cut whenever ranges are present | Can choose wrong footage for inserted points even after their own clips are ready. Both landscape and vertical renderers need a source decision. | E7 |
| Automatic highlights | Separate quality selection and end policy; rendered-file output timeline | Share trustworthy evidence and source checks, but retain the separate editorial policy. Freshness must include membership as well as ending changes. | E8 |
| Cross-match tag reels | Individual clips with no cut ranges | Not directly trimmed by a score tap today. Clip revision and explicit stale-clip handling still matter. | E9 |
| Public match / point links | Scoped share RPCs, cut skip spans or individual clips | New metadata must reach these narrow readers without broadening their access to other points or original recordings. | E10 |
| Scores, serve rotation, match analysis and placement presentation | Confirmed outcomes, ordered points, game boundaries and first-server answers | A pure viewing fix must not change these. A real winner, boundary or point-count correction must recompute them coherently. | E11 |

## 3. Common contracts

### A. An outcome is not an ending

| User action | Score mutation | Ending mutation |
| --- | --- | --- |
| First answer while continuously watching the target rally | Record the chosen winner | May record a live-score observation, but only with the eligibility checks below. |
| Correct an already answered point, including after replay | Change the winner | Preserve the existing ending. Never substitute the current playhead position. |
| Answer in Review, through a point card, after scrubbing, or after manually pausing | Record the winner | No new ending observation. |
| Answer after the app automatically paused at its estimated ending | Record the winner | No new observation from that pause: it would only turn the app's own estimate into supposed human evidence. |
| Clear a score or mark a point skipped | Apply the outcome change | Deactivate its score-tap ending; retain the prior state in the operation's undo/audit record. Do not reinterpret a stale tap as a detector observation. |
| Adjust the end / Split / Join | Apply the requested structural change | Record persistent manual end authority and invalidate observations that described the previous window. |
| Rebuild a clip | No score change | No change to end authority or observation validity. Only the media revision changes. |
| Undo | Restore the fields changed by that operation | Restore their ending state too, subject to the conflict checks in #3. |

| New live-score observation eligibility | Required behavior |
| --- | --- |
| Point identity | The displayed, scored and actually playing point IDs agree. A detour pins the ID; the main cut's clock must not relabel it. |
| Playback continuity | First answer for that point; active foreground playback; media ready; run began at/before the rally start; no intervening manual seek, scrub or source error. Playback speed alone does not disqualify it. |
| Time basis | Convert from the actual media source into the point's source-video clock. Do not treat an inserted point's virtual cut position as a real location in the cut file. |
| Boundary validity | Finite observation within the current point window; no new minimum rally duration that would reject short serves. A tap is an upper-bound human observation, not proof of the precise last ball contact. |
| Explicit intent | A manual end remains authoritative. Scoring it later does not silently undo that edit. |
| Rejected observation | Save the score normally; keep the prior valid ending or the existing conservative fallback. Do not block scoring or guess a replacement timestamp. |

| Deliberate behavior change to review | Downstream effect |
| --- | --- |
| Stop recording new end evidence from an automatic pause or a scrubbed/paused answer | Scoring still completes normally. Future Watch may retain more context when there is no valid earlier observation; an automatic highlight uses eligible detector evidence or declines the candidate rather than treating the app's pause as a human-measured ending. This is part of the proposed design, not an already-approved change. |

### B. Persistent facts, not the transient `edited` flag

| Proposed persisted fact | Purpose / compatibility rule |
| --- | --- |
| `end_authority`: automatic or manual | Manual means the chosen source window wins over tap/detector trimming. Set on explicit end changes and newly defined Split/Join boundaries; clip completion never clears it. Undo restores the previous value. |
| `end_observation`: source second, origin and timing revision | New trustworthy score observations record `continuous_first_score` and the timing revision they describe. Source seconds are relative to the processed source after library trimming. Worker observations remain distinguishable from human ones. |
| Existing `scored_at_cut_s` | Preserve as a legacy observation, not a field to repurpose with unrelated clocks. Use a compatibility adapter for old rows; do not call them newly validated. New source-only detours must not manufacture a physical cut timestamp. |
| Point mutation revision / timing revision | Compare-and-save prevents an old correction or Undo overwriting newer work. Timing revisions invalidate old mappings and evidence; changing a winner alone does not invalidate ball/pose measurements. |
| Clip source window and revision receipt | Identify the exact padded source range, file key and timing revision used to create the clip. Needed to map clip-local playback and to distinguish a fresh file from one with an old window. |

| Ending selection | Required rule |
| --- | --- |
| Manual authority | Use the manually chosen window with the applicable existing edge padding; never trim back to an older observation. |
| Valid live-score observation | Use it under the consumer's enabled tap policy, clamped to the available point window. |
| Legacy tap | Preserve existing behavior through an explicit compatibility path unless evidence proves it invalid. Do not silently fall through from a rejected human tap to weaker detector evidence. |
| Detector observation | Use only when policy permits it, no human authority rules it out, and its timing/mapping is valid. Missing is unknown, not zero. Retain current confidence/tail-distance safeguards. |
| No usable observation | Normal viewing keeps the padded window. Automatic highlights may decline a candidate when their evidence contract cannot be met. |
| Context buffers | Normal Watch currently adds 0.5 s after a usable tap; automatic highlights in the current working tree add 0.2 s after a tap or 0.25 s after detector evidence. Preserve those distinctions for this repair; calibrating them is a separate decision. |

### C. Pick footage before choosing where playback should stop

| Source resolution order | Requirement |
| --- | --- |
| Current individual clip | Use its revision receipt to locate the requested window. Never assume a filename's existence proves freshness. |
| Match cut | Use only when a source-to-cut map proves the **entire requested window** is present. Reuse the `_CutMap` semantics; do not infer availability from `cut_t0`, card order or available timeline room alone. |
| Original upload, bounded to the point | Owner and currently authorized match viewers can use the existing original-preview permission. Include the library trim offset exactly once. Stream the requested range; do not rebuild/download the whole match for this fallback. |
| No authorized source proves the window | Keep the point and its score. Show a specific unavailable/retry state; never show a neighbour under this point's identity. A completed-review/public-link viewer must not receive a full original URL as a shortcut. |
| Background replacement | Keep point identity and logical source position. Swap only when paused, ended or next opened; no mid-rally restart or duplicated sound. |

| Clock | Meaning / permitted conversion |
| --- | --- |
| Processed source | `t0` / `t1` refer to this clock; the stable coordinate for new observations and manual bounds. |
| Original upload | Processed-source time plus the library's trim-start offset. |
| Match cut | Mapping through kept source segments. Removed source intervals have **no** cut counterpart. |
| Individual clip | Source time minus that clip revision's actual padded source start. |
| Highlight output | Manifest output positions, including crossfades; not interchangeable with cut seconds. |

| Shared implementation boundary | Responsibility |
| --- | --- |
| Ending resolver | Return source-window start/end, chosen authority and reason; pure logic with shared fixtures across TypeScript, Swift and Python. |
| Media resolver | Return point ID, timing/media revision, source kind and source-local bounds, or an explicit unavailable reason. Server validates authorization before signing; clients do not supply arbitrary storage paths. |
| Rendering manifest | Carry resolved source kind/key, local bounds, point ID and relevant revisions. Renderers execute this choice rather than re-deciding that any cut range must be valid. |
| Scoring commands | Save coupled score/end fields atomically; use a request ID for safe retries and expected revisions for conflicts. Database enforcement protects against old clients, not just new UI guards. |
| Active-reader refresh | Revalidate the match revision on focus, point navigation and before creating a citation/export. Refresh data without losing a coach's draft; apply source/window replacement at a quiet transition. All labels and frames on a playing point remain tied to one revision, rather than mixing a new scorecard with an old source mapping. |

## 4. Individual recommendations

### #1 · High: winner corrections must not rewrite endings

| Item | Specification |
| --- | --- |
| Confirmed cause | Play-phase winner buttons stamp the current playhead even for an existing answer or paused replay. The effective-end reader then treats that value as authoritative. E1. |
| Recommended fix | Separate `set outcome` from `record eligible first-score observation`, using contract A. Make corrections preserve ending fields in the database as well as in web/iOS callers. Route button, keyboard, spoken-score and card callers through the same outcome command, even where they currently do not record a tap. |
| User experience | Correcting the winner changes the score, not the amount of the rally visible on the next watch. No new required button or confirmation for ordinary scoring. |
| Downstream constraint | Coach skip spans and newly requested normal exports use the unchanged ending. Winner-sensitive selections and score overlays may legitimately change; generic rally quality does not change merely because the other side won. |
| Existing records | Do not bulk erase historic taps or rerun the detector. Produce a read-only repair candidate list from available history; restore only provable prior values after approval. Ambiguous old endings remain explicitly legacy. |
| Acceptance | With a prior end of 60.5 s, correcting while paused at 51 s must leave 60.5 s on web, iOS, coach Watch and the normal export manifest. Test both directions, same-side toggle, Review, replay, raw fallback, voice input and clear/re-score. |

### #2 · High: an inserted or extended point must use footage that exists

| Item | Specification |
| --- | --- |
| Confirmed cause | Inserted points are excluded from separate-clip playback until `clip_path` exists; unavailable URLs also leave them on the cut. Point-detail fallback, coach jumps and renderers share the broader assumption that a cut timestamp implies usable footage. E2–E7. |
| Recommended fix | Apply contract C to both newly inserted points and changed windows reaching removed footage. Keep the point marked as requiring a different source while its clip is missing; independently track source readiness. Reuse the original window just previewed during Add, then resolve it afresh after reload. |
| User experience | Continuous-gap insertions still play instantly from the cut. Removed-gap insertions play their original-video window until the clip is ready. If neither is available, retain the card and explain the source failure rather than showing another rally. |
| Existing design compatibility | Preserve the approved instant-clip-edit behavior wherever the cut proves coverage. The change is a correction to its fallback precondition, not a return to spinners for every edit. |
| Render / coach requirement | Landscape, vertical and on-device exports must select the inserted clip or authorized original range, not its virtual cut position. Active coach workspaces need the same point-source resolver. Public/cited-only readers receive an authorized bounded clip, not expanded match access. |
| Acceptance | Use one kept gap, one removed gap, an extended end crossing a removed interval, two adjacent inserts, and an insert at each file edge. Delay generation, fail URL signing, reload, and compare point identity plus first/last frames in Watch, detail, coach workspace, landscape and vertical exports. No wrong-source fallback is permitted. |

### #3 · High: Undo and failed-save recovery must restore the complete operation

| Item | Specification |
| --- | --- |
| Confirmed cause | Web tap Undo omits the previous timestamp; failed `setWinner` writes restore winner/let but not ending state. iOS already snapshots/restores its score timestamp. E1, E12. |
| Recommended fix | Snapshot the scorer-owned fields that the command can change: winner, let/skipped state, active end observation and authority where relevant. Save/restore them together. Undo uses the revision produced by the original command; a newer edit causes a visible conflict rather than a silent overwrite. |
| Network ordering | Serialize mutations per point; use command IDs for retry. Optimistic UI may remain responsive, but acknowledgements and rollback apply only to their own revision. A stale response cannot replace a later answer. |
| User experience | Undo restores both the answer and subsequent playback. A failed save says it failed and offers retry without stealing the playhead from a later point. Reload shows committed truth, not a local-only ending. |
| Downstream constraint | Never render a new reel from pending local state. Failed writes must not publish a changed ending. Successful Undo invalidates only derived artifacts whose actual inputs changed. |
| Acceptance | Correction → Undo; clear → Undo; skip → Undo; network rejection; two quick answers with reversed response order; second-device edit before Undo. Assert complete field restoration, unchanged unrelated notes/stars and consistent future Watch/coach/export values. |

### #4 · High: move a game boundary as one complete, reversible change

| Item | Specification |
| --- | --- |
| Confirmed cause | Web moves the old and new markers with independent writes, ignores their success booleans and clears a named game winner without carrying or re-asking it. E13. |
| Recommended fix | One owner-authorized database operation validates adjacency against current visible order, locks the relevant match structure, updates both markers and resolves the winner as one transaction. Return all changed rows and an inverse for Undo. |
| Named winner | Preview the resulting game. If the new point scores prove the same winner, no question. If they do not prove a winner and the old game had a named winner, explicitly retain that answer with confirmation; if they prove a different winner, explain the changed result and require confirmation. Never silently transfer a contradictory answer or silently discard it. |
| User experience | The divider moves once, or nothing changes. Cancel and failure leave both the old boundary and its winner intact. No intermediate game score is broadcast as a saved result. |
| Downstream constraint | Recompute game grouping, score entering/after each point, serve rotation, physical side changes and derived pressure/serve statistics from the same resolved structure. Change score overlays in new exports, not the rally video windows. Preserve manual server answers. |
| Acceptance | Move up/down with a named winner, automatic 11-point result, deuce, unscored/let neighbour and deleted intervening rows. Simulate transaction failure and concurrent edit. Match header, coach score chips, point breakdown and export overlays must agree; boundary-only edits must leave video ranges unchanged. |

### #5 · High functional gap, **ON HOLD**: access to short-gap and edge insertions

| Item | Specification |
| --- | --- |
| Confirmed behavior | Current helpers reject the first/last match edge and gaps below eight seconds. History contains the prior four-second/edge behavior; tests disagree across platforms because the behavior drifted. This confirms restricted access, not the right button-density decision. E14. |
| Hold | Do not lower the threshold, restore edge buttons, alter layout, or activate an alternate entry point as part of the other nine fixes. |
| Requirement to resolve later | A player must eventually be able to repair a missed short serve or an edge rally without default plus buttons between every rally. Shortness alone is not evidence that no point occurred. |
| Shared technical groundwork | #2 may make existing inserts play correctly without changing where Add is offered. A future entry point must call the same insertion and media-resolution path. |
| Data contract when approved | Create the new point, chosen outcome and neighbour adjustments in one revision-checked operation. Restore affected neighbours/anchors on Undo only if none have subsequently changed. New point identity is stable; display numbering is recomputed, not used as identity. |
| Acceptance before activation | Compare the options below on representative dense and sparse matches at desktop, 393×660 mobile web and native iOS. Test missed serves, 4.5 s gaps, long gaps and both edges. Measure default strip density and the actions needed to reach Add; Adil chooses the tradeoff. |

| Held design option | Discoverability | Density / tradeoff |
| --- | --- | --- |
| Keep current plus offers; add an explicit Add entry within existing point tools | Available on request even at short gaps, with a before/after position choice | No default strip-density increase; less discoverable. Recommended option to evaluate first, **not approved**. |
| Temporary insertion mode | Show candidate seams and edges only after the player asks to add a point | Clear while correcting, quiet otherwise; adds a mode to learn and exit. |
| Lower the inline threshold / restore edge offers | Most immediate | More plus buttons; this is the exact tradeoff Adil has held. Do not silently choose it. |

### #6 · Medium: manual endings must survive Split/Join and clip completion

| Item | Specification |
| --- | --- |
| Confirmed scope | Adjust already clears old observations when its end changes. Split/Join retain observations on surviving rows; `edited=true` temporarily masks them and clip completion clears that protection. E15. |
| Recommended fix | Use persistent manual authority from contract B. Split gives each deliberately created edge its correct authority and invalidates mismatched observations; Join clears the survivor's old ending and invalidates old whole-rally evidence. Apply the same rules in the transaction and client mirror. |
| Preserve working behavior | Do not rework Adjust's correct clearing into a competing rule. Changing only the start must not move a still-valid physical ending; remap it correctly or invalidate it if coverage cannot be proved. |
| Clip completion | Worker and device claims update media state only and compare timing revisions. Late files cannot reset a later edit or restore an older ending. |
| Downstream constraint | Normal Watch/reels respect the new window. Automatic highlight eligibility waits for valid evidence for that window; joining two points does not automatically prove one quality rally. Structural edits must also satisfy the coach-citation guard in section 6. |
| Acceptance | Join a point whose old tap ends inside the joined window; verify the extension before/after reclip, reload and a later score correction. Split with taps before/after the split; verify both children, Undo, highlight evidence invalidation and no change caused solely by clearing `edited`. |

### #7 · Medium: use clip revisions, not point IDs, to cache media

| Item | Specification |
| --- | --- |
| Confirmed scope | Web's inserted-clip URL cache skips a point already in its map even when its file changes. iOS's takeover checks file changes and is the working comparison. E2, E16. |
| Recommended fix | Cache by viewer scope, point ID and media revision/file key. Fetch a new URL when that key changes; discard replies for superseded requests. Resolve the corresponding source mapping with the same revision. |
| User experience | The next open/replay uses the revised clip without refresh. A currently playing valid revision finishes or pauses before a safe swap; preserve logical source position and paused/playing state. |
| Failure / expiry | One bounded automatic re-sign for an actual playback failure, then an explicit retry. No idle request loops. A renewed URL for the same file is not a new content revision. |
| Downstream constraint | Apply to shared point/review/Starred readers where they cache live media. A deliberately pinned coach citation remains pinned; new-current-file behavior must not override it. Export manifests reference file identity, not expiring signed URLs. |
| Acceptance | Replace file A with B while open and paused, then while playing; return the A request after B; expire B's URL; repeat across two authorized viewer contexts. Verify correct first/last frames, stable cursor and only one audible player. |

### #8 · Medium: catch a natural boundary crossing despite delayed updates

| Item | Specification |
| --- | --- |
| Confirmed scope | Main web/iOS scorekeeping requires consecutive media timestamps less than one second apart to pause. The isolated 1.2 s crossing misses its boundary permanently in that run. E17. |
| Recommended fix | Track a playback-run identity, explicit seek reasons and consumed boundaries separately from update cadence. A natural crossing of an unconsumed target boundary pauses even after a delayed callback. A deliberate seek starts a new run; do not simply remove the one-second guard. |
| Pause resolution | Pin the earliest unconsumed eligible point in the run, seek back to its intended stop if necessary and pause once. Handle clip-end and pause callbacks through one state transition. Resume past a consumed boundary must remain possible. |
| User experience | A slow update does not skip the score prompt or relabel the next rally as the unanswered one. Background/foreground recovery never invents a score. |
| Downstream constraint | This is local session control only. A pause does not write ending evidence, edit points, change coach playback, or regenerate reels. |
| Acceptance | Cross with 0.2, 0.6, 1.0 and 1.2 s updates; test high speed, foreground recovery, manual seek across several rallies, replay, resume and an inserted clip ending on the stop frame. Exactly one correct pause, no loops and no database mutation. |

### #9 · Lower: respect deliberate inspection of a trimmed tail

| Item | Specification |
| --- | --- |
| Confirmed scope | Watch jumps whenever resumed playback is inside a trim span, regardless of how it arrived. Active coach workspace players repeat this behavior. Full clip/editor alternatives exist. E1, E4, E5, E10. |
| Recommended fix | Distinguish trim spans from deleted/let/highlight-selection exclusions. Explicitly seeking into a point's trimmed tail gives a session-local inspection exception for that point until it is exited or normal next-point navigation resumes. |
| User experience | Scrub back, press play and inspect the disputed ending without fighting an immediate jump. Normal continuous Watch remains concise. Preserve the same distinction in the active coach workspace. |
| Scope safety | This is not permission to resurrect deleted points, cross into unshared footage, or include an unselected rally in a highlights tape. A highlights viewer can open the authorized individual point for broader inspection. |
| Downstream constraint | No persistent timing/outcome change, no altered export, no new highlight membership and no changed breakdown. Only an explicit Adjust changes future playback bounds. |
| Acceptance | Natural crossing skips; deliberate landing and resume plays the tail; leaving the point resets the exception. Test pause, scrub, keyboard seek and replay. Verify both an authorized full-match viewer and a restricted share viewer. |

### #10 · Lower / conditional: carry ending metadata through every narrow reader

| Item | Specification |
| --- | --- |
| Confirmed scope | Native match loading omits `rally_end_cut_s`. The active web coach query and native workspace model also omit it; the native workspace adapter drops game overrides. Shared helpers cannot use values never fetched. E4, E5, E10, E18. |
| Recommended fix | Define a common projection of the inputs required by ending/source/score readers, then update each query, decoder, adapter, share RPC and pending-refresh merge. Include detector ending, manual authority, observation validity and relevant revisions; game overrides are required where a score is shown. |
| Switch behavior | Tap trimming and detector trimming remain independent. Test all four on/off combinations. Fetching a field must not enable a feature; retain the production setting until separately verified and approved. |
| User experience | With detector trimming enabled, the same eligible point has the same ordinary ending in web, iOS and coach Watch. With it disabled, adding the field causes no visible shortening. |
| Body pipeline constraint | This repairs delivery of the body/ball ending evidence, not card assembly. Missing evidence keeps the current conservative window. Do not re-run pose inference or infer a winner. |
| Acceptance | Exercise the actual query → response → decoder → adapter → resolver chain using a row with a detector ending, then a row without one. Hand-constructed models alone are insufficient. Test older responses, public allow-lists and the four switch states. |

## 5. Downstream impact matrix

| Fix | Watch / point video | Future scorekeeper playback | Coach order / review | Generated reels | Point-by-point breakdown |
| --- | --- | --- | --- | --- | --- |
| #1 Correction | Preserve rally length | Preserve ending on reopen/replay | Correct outcome and score chips, unchanged footage window | Update applicable winner selection/score overlay; preserve boundaries | Recompute winner-dependent values; do not reclassify ball events |
| #2 Source | Show actual point immediately where an authorized source exists | Correct point ID and video during/after insertion | Correct active point jump; bounded cited/public media only | Correct source for cut, clip and raw cases on every renderer | Same point data; the video now actually matches its card |
| #3 Undo | Restore pre-command playback state | Restore answer and ending together | See only committed result; newer work is not overwritten | Reuse or invalidate by actual restored inputs | Restore scorer-owned values, not unrelated annotations |
| #4 Boundary | Same footage; changed game overlay | New grouping/serve rotation, unchanged point timings | Consistent game totals and point scores | Change score overlay and related scope decisions, not frames | Recompute game/serve/side/pressure derivations coherently |
| #5 Held Add | No change now; future addition uses #2 | No new controls now; future point enters correct order | Existing citations remain stable; future current-match view includes added point | Future membership/score overlay may change; short serve is not automatically a quality highlight | Future counted point shifts scores and serve rotation; a let does not count |
| #6 Manual end | Keep selected window after file rebuild | Do not reapply stale end taps | Active current view uses new window; cited revision protected | New manual bounds; refresh structural evidence before automatic selection | Update point boundaries/count for actual structure; no invented analysis |
| #7 Cache | New-current clip at next safe transition | No page refresh required | Refresh live clips; do not replace pinned citations | New file revision invalidates affected cached render | No score/count change from URL or file replacement alone |
| #8 Pause | No Watch change | Correct prompt after delayed callback | No ordinary coach-Watch change | No change | No change |
| #9 Inspect | Temporarily play the sought tail | No stored ending change | Coach can inspect without fighting skip | No change | No change |
| #10 Projection | Consistent enabled end policy | Same fields after load/refresh | Same end inputs and game overrides | Device/server inputs agree; no automatic flag activation | No score change from detector metadata; correct omitted override inputs where displayed |

## 6. Coach citations and analysis integrity

| Risk found while tracing downstream | Recommended contract / approval boundary |
| --- | --- |
| A coach cites a point, then its timing changes | Active workspace follows current match truth after revision refresh. Existing cited evidence must not silently become different footage under unchanged feedback. Recommend pinning the cited media revision and source window, with an explicit coach action to update a citation. This is additional citation work, not something fixing a tap alone accomplishes. |
| Join removes a cited point | Current finding links reference point rows with cascading deletion. Before changing this workflow, preserve citations independently of the deleted row: retain an immutable citation ID, media revision/window and original point label; a live point reference may become absent. Never silently reattach a finding to an arbitrary surviving/child point. |
| Old re-cut file cleanup | A pinned citation is a live reference. Cleanup must retain that file, with storage accounting, until no live citation needs it. No new snapshot policy may be deployed without this retention change. |
| Historical findings without a snapshot | Snapshot only what is currently available and identify that baseline honestly. Do not claim to recover the footage the coach originally saw if intervening edits already replaced it. |
| Scope of coach access | Active match access can resolve cut/original sources under existing permissions. A completed-review-only viewer retains cited bounded media only. Test revoked access and unrelated point IDs explicitly. |
| Coach order lifecycle | Fees, deadlines, messages, delivery status, saved words, drawings and audio remain unchanged. A corrected score may update the current match view; it must not rewrite the coach's historical conclusion. |
| Score and statistics vs detector analysis | Winner/boundary corrections can change game scores, pressure points, serve/receive summaries and which placement hypothesis is displayed. They do not change measured ball coordinates. Timing/structure edits invalidate affected detector receipts; recalculate only relevant evidence, not unrelated matches. |
| Loss reasons after a winner correction | Preserve the user's stored annotations. Present/aggregate them only when applicable to the current outcome; do not count a now-won point as a current loss because old loss reasons remain stored. |

| Citation implementation choice requiring review | Decision |
| --- | --- |
| Durable cited revisions | Recommended complete solution for structural edits; modest new citation metadata plus retention and signing changes, separate from score correction work. |
| Warning alone / automatic reassignment | Insufficient: neither preserves the evidence behind a delivered finding. If durable citation support is deferred, explicitly hold structural edits affecting cited points rather than claiming end-to-end preservation. This guard requires Adil's approval. |

## 7. Artifact freshness and existing matches

| Input change | Must refresh / invalidate | Must not happen |
| --- | --- | --- |
| Winner only | Score walk, outcome-dependent statistics, score-overlay exports and scopes whose membership depends on the winner | Recut the point or shorten it using the correction playhead |
| Trusted end / manual end / end-policy version | Watch spans, playback durations, affected normal and automatic manifests and relevant device shares | Change the score or silently publish a pre-change render as current |
| Point inserted / removed / skipped / joined / split | Ordered score/serve walk; relevant selection membership; source mappings; affected structure evidence; citation safeguards | Renumber stored point identities or transfer analysis to unrelated footage |
| Clip replacement | Live URL/source caches; manifests that consume that revision | Reset manual authority, auto-play a second player or delete a cited live file |
| Local seek / pause / speed | Session cursor only | Rebuild reels, revise evidence or mutate scores |

| Freshness implementation | Requirement |
| --- | --- |
| Versioned manifest | Include policy version, resolved media identity/bounds, timing/end authority and the inputs actually used for selection and score overlay. Signed URL expiry is not content freshness. |
| All candidate membership | Check relevant candidate-set revision, not only the points already selected in a stored automatic reel. Adding a newly eligible point or clearing an answer can change the result. |
| Compare before publish | A render finishing against an obsolete revision cannot become the ready artifact for a newer request. Keep retries bounded and consolidate repeated changes. |
| Distinct highlight policy | Current automatic code has different buffers and does not take `t1`/padded-end bounds in its TS freshness helper. Add boundary/source clamping and provenance consistently to both worker and API; do not silently replace its quality thresholds with normal Watch logic. |
| Existing downloaded files | Cannot be changed on a user's device. New requests must identify/build the current revision; do not claim historical downloads were repaired. |
| Existing legacy tap values | First ship prevention and exact Undo. Audit history read-only; no bulk deletion, blanket trust upgrade or speculative backfill. A repair run requires a reviewed target list, backup and separate approval. |
| Existing manual edits | Recover authority only from reliable edit history/RPC evidence. `edited=false` does not prove the point was never hand-edited. Ambiguous rows need review, not invented provenance. |

## 8. Acceptance and rollout gates

| Acceptance suite | Required evidence |
| --- | --- |
| Shared ending fixtures | Same source windows and authority choices in TypeScript, Swift and Python, including legacy taps, missing detector values, manual ends, short serves, invalid numbers and each flag combination. Compare consumer-specific buffers deliberately. |
| Source fixtures | Kept gap, removed gap, trimmed upload, split-born tight edge, original card with dynamic padding, adjacent inserts, extended end and legacy source unavailable. Compare actual first/last frames, not just duration or timestamp equality. |
| Mutation integration | Use a disposable database with the proposed migrations. Test concurrent saves, retry IDs, failed writes, transactional boundary move and revision-checked Undo. Never use real user scores as test fixtures for writes. |
| Playback interaction | Desktop web, 393×660 mobile web, native iOS separately; slow callbacks, source changes, background/foreground, fast scoring, manual seeks and repeated replay. Record the expected point ID, source, position, score and pause state. |
| Coach lifecycle | Active review, delivered review and completed/cited-only access; existing note/audio/drawing retained; edited/deleted cited point; no broader media access; current scores distinct from historical citation evidence. |
| Export parity | Normal full/starred, single point, automatic highlights, cross-match tag reel, landscape/vertical and device/server rendering. Confirm source frames, score-before/after convention, membership, transitions and cache freshness. |
| Breakdown invariants | Source/cache/inspection/pause fixes leave count, winner, game, server, tags and notes unchanged. Real score/structure changes update applicable derived values once from the same committed revision. |
| Build / visual gate | Real `npm run build`, in an isolated worktree with its own `.next` if a dev server is active. Full native build plus simulator/device checks. Existing theme and copy; new error/confirmation states reviewed at desktop, 393×660 web and native sizes. |
| Worker gate | Same policy and fixtures for Mac and remote execution; do not deploy a second independent implementation. If any new processing state/job is introduced, update the existing admin processing display and test its reporting. No new lane is needed for this spec by default. |

| Delivery group | Contents / exit gate |
| --- | --- |
| 1. Stop creating bad endings | #1 + #3, compatibility-aware database enforcement, all scoring entry points and exact rollback tests. Can ship before the broader source work if legacy readers remain compatible. |
| 2. Restore complete game edits | #4 with shared score/serve consumers and transactional integration tests. Independent of the #5 UI decision. |
| 3. Establish correct footage and durable end authority | #2 + #6 + #7, contract B/C, all affected point/coach/export readers, clip receipts and guarded completion. Citation protection is a separately approved dependency for structural edits that touch cited points. |
| 4. Session behavior and parity | #8 + #9 + #10, all narrow readers and actual interaction tests. Additive field/projection plumbing may land earlier, but feature activation must wait for compatible readers. |
| Held separately | #5 access/density decision. None of groups 1–4 changes its inline threshold or adds buttons. |

| Release / rollback | Requirement |
| --- | --- |
| Expand first | Add backwards-compatible fields/RPC responses and read adapters before switching writes. Preserve legacy readers during rollout. Old-client direct winner writes must not overwrite protected ending state. |
| Mixed versions | Test old and new clients against the migrated database. Never rely on a new client alone to protect stored facts. Version-gate semantics that an older reader cannot safely interpret. |
| Controlled activation | Inspect actual deployed functions and public config before release. Start with fixtures/test accounts, then an explicitly approved small set; no automatic production backfill or mass rerender. |
| Rollback | Disable the new consumer policy and return to the last compatible read behavior while retaining new provenance and revisions. Do not drop columns, restore old corrupted values, erase manual intent or remove a cited file. |
| Completion language | Mark a group fixed only after its affected consumers and acceptance paths are verified. A helper test passing does not establish mobile, native, coach or export correctness. |

| Existing test entry point | Future regression coverage to extend |
| --- | --- |
| `npm run test:match-structure` / `npm run test:scorecard` | Ending, insert geometry, game/serve walks and scorecard semantics; add actual mutation/caller tests so a correct helper cannot hide an incorrect caller. |
| `node --test --experimental-strip-types src/app/api/highlights/endPolicy.test.ts` | Shared authority, invalid evidence, source-range clamping and policy-version freshness; keep intentional buffer differences. |
| `worker/tests/test_reclip_sources.py`, `test_highlights.py`, `test_highlight_evidence.py`, `test_auto_highlight_render.py` | Source coverage, media receipts, evidence invalidation and rendered first/last-frame parity. |
| `bash ios/Tests/run.sh` plus full native build | Cross-language fixtures, decoded query projections, end/pause state and held insert-policy expectations. A headless core pass does not compile or exercise every screen. |
| New isolated database and UI suites | Reproduce the named mutation, authorization, concurrency, cited-point and export cases above without writing to production accounts. |

## 9. Investigation record

| Check performed for this draft | Result / limitation |
| --- | --- |
| Repeated isolated callback/helper audit | Reproduced correction timestamp overwrite, incomplete web Undo/rollback, absent-clip fallback, named-winner loss/partial boundary save, cadence-sensitive pause, seek-tail skip, missing native projection and stale web clip caching. I/O and React state were stubbed; not a browser integration run. |
| Negative controls | Review correction preserved the old tap; Adjust-cleared observations did not revive after reclip; an inserted point with both clip and URL ready selected its own clip. |
| `npm run test:match-structure` | 131 passed on this checkout. Some tests encode today's held #5 behavior; passing does not resolve the product tradeoff. |
| `npm run test:scorecard` | 15 passed. |
| Highlight end-policy and review migration/money/copy tests | 27 passed. The three end-policy tests exercise current in-flight policy, not the proposed fixes. |
| Native audit from preceding pass | Headless core run: 662 passed, 3 insertion-geometry assertions failed. Not rerun for this documentation change; those three failures remain attributed to the held behavior mismatch, not silently “fixed.” |
| Read-only trace added here | Active/delivered coach paths, review-media authorization, clip-source fallback, normal and automatic render manifests, device sharing, public share projections, score/serve/stat derivations and citation deletion/retention implications. |
| Not performed | New implementation, migrations, production state repair, full web/native build, live UI sequence verification, real video export comparison, production-switch inspection or deployment. |

## 10. Source map

| Ref | Verified entry points in this checkout |
| --- | --- |
| E1 | [Web tap capture](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/Player.tsx:3899), [ending authority](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/playhead.ts:131), [native tap capture](/Users/adil/Desktop/Projects/PongLens/ios/PongLens/PongLens/Screens/PlayerTakeover.swift:2782) |
| E2 | [Web clip eligibility/cache](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/Player.tsx:1764), [native eligibility/source items](/Users/adil/Desktop/Projects/PongLens/ios/PongLens/PongLens/Screens/PlayerTakeover.swift:3676), [coverage mapping](/Users/adil/Desktop/Projects/PongLens/worker/worker.py:5754) |
| E3 | [Point-detail cut fallback](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/PointDetail.tsx:263), [native point detail](/Users/adil/Desktop/Projects/PongLens/ios/PongLens/PongLens/Screens/PointDetailScreen.swift:978) |
| E4 | [Coach query and skip spans](/Users/adil/Desktop/Projects/PongLens/src/app/coaching/orders/[id]/page.tsx:111), [coach point jumps and Watch skipping](/Users/adil/Desktop/Projects/PongLens/src/app/coaching/orders/[id]/FindingEditor.tsx:204) |
| E5 | [Native workspace model/adapter](/Users/adil/Desktop/Projects/PongLens/ios/PongLens/PongLens/Core/CoachModels.swift:289), [native coach skip spans](/Users/adil/Desktop/Projects/PongLens/ios/PongLens/PongLens/Screens/CoachFindingsView.swift:647) |
| E6 | [Delivered clip reader](/Users/adil/Desktop/Projects/PongLens/src/components/reviews/PointReel.tsx:68), [cited media authorization](/Users/adil/Desktop/Projects/PongLens/src/app/api/review-media/route.ts:140), [citation foreign key](/Users/adil/Desktop/Projects/PongLens/supabase/migrations/073_coach_reviews.sql:359) |
| E7 | [Normal export ranges/scores](/Users/adil/Desktop/Projects/PongLens/src/app/api/reel/route.ts:393), [landscape source choice](/Users/adil/Desktop/Projects/PongLens/worker/worker.py:6797), [vertical source choice](/Users/adil/Desktop/Projects/PongLens/worker/worker.py:7021), [device share ranges](/Users/adil/Desktop/Projects/PongLens/ios/PongLens/PongLens/Screens/SharePointSheet.swift:374) |
| E8 | [Automatic selection/end policy](/Users/adil/Desktop/Projects/PongLens/worker/highlights.py:45), [API end-policy mirror](/Users/adil/Desktop/Projects/PongLens/src/app/api/highlights/endPolicy.ts:17), [API selected-point freshness](/Users/adil/Desktop/Projects/PongLens/src/app/api/highlights/route.ts:54), [evidence invalidation](/Users/adil/Desktop/Projects/PongLens/supabase/migrations/20260906041000_quality_first_highlight_lets.sql:5) |
| E9 | [Cross-match tag manifest](/Users/adil/Desktop/Projects/PongLens/src/app/api/tag-reel/route.ts:119) |
| E10 | [Share row projection](/Users/adil/Desktop/Projects/PongLens/src/app/s/[token]/shareData.ts:60), [public skip spans](/Users/adil/Desktop/Projects/PongLens/src/app/s/[token]/page.tsx:105), [media access contract](/Users/adil/Desktop/Projects/PongLens/src/app/api/media-url/route.ts:12) |
| E11 | [Game/score walk](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/gameScore.ts:217), [serve rotation](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/serving.ts:108), [derived statistics](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/matchStats.ts:55), [resolved structure](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/matchStructure.ts:99) |
| E12 | [Web score save/rollback](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/MatchView.tsx:1550), [web tap Undo](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/Player.tsx:4958), [native complete restoration](/Users/adil/Desktop/Projects/PongLens/ios/PongLens/PongLens/Screens/MatchDetailScreen.swift:410) |
| E13 | [Boundary update](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/MatchView.tsx:1706), [two-write move](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/MatchView.tsx:1780) |
| E14 | [Held gap policy](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/insertGeometry.ts:233), [current policy tests](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/insertGeometry.test.ts:169); history: `8eb46d2a` and `d95be330` |
| E15 | [Adjust invalidation](/Users/adil/Desktop/Projects/PongLens/supabase/migrations/20260906174620_insert_point_tight_edges.sql:112), [Split retaining parent observations](/Users/adil/Desktop/Projects/PongLens/supabase/migrations/023_split_child_cut_t0.sql:65), [Join survivor](/Users/adil/Desktop/Projects/PongLens/supabase/migrations/027_merge_points.sql:70), [device reclip claim](/Users/adil/Desktop/Projects/PongLens/supabase/migrations/20260906174708_device_reclip.sql:97) |
| E16 | [Web already-cached guard](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/Player.tsx:1777), [native revision comparison](/Users/adil/Desktop/Projects/PongLens/ios/PongLens/PongLens/Screens/PlayerTakeover.swift:3687) |
| E17 | [Web cadence guard](/Users/adil/Desktop/Projects/PongLens/src/app/match/[id]/Player.tsx:2185), [native cadence guard](/Users/adil/Desktop/Projects/PongLens/ios/PongLens/PongLens/Screens/PlayerTakeover.swift:3303) |
| E18 | [Native match projection](/Users/adil/Desktop/Projects/PongLens/ios/PongLens/PongLens/Core/Models.swift:298), [detector feature default](/Users/adil/Desktop/Projects/PongLens/supabase/migrations/143_unscored_rally_end.sql:48), [body/ball end conversion](/Users/adil/Desktop/Projects/PongLens/worker/points_pipeline.py:3383) |

## 11. Decisions for Adil

| Decision | Recommendation |
| --- | --- |
| Overall design | Approve the separation of outcomes, ending authority and media source; retain normal-vs-highlight buffer differences. |
| First delivery | #1 and #3 together, then the independent transactional game-boundary fix. |
| Coach evidence | Approve durable cited revisions before promising safe structural edits to cited points; otherwise explicitly hold those affected edits. Do not widen coach access. |
| Missing-point controls | Keep #5 on hold. Evaluate the existing-tools Add entry first when this discussion resumes. |
| Historic data | Prevention first. Review a read-only candidate report before authorizing any repair or regeneration. |
