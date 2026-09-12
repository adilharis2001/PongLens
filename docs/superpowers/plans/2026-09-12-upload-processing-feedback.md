# Upload checks and processing feedback

Add a non-destructive camera-view warning only where local tests support it, preserving the original and trimming controls. Replace the blanket completion promise with observed processing stages, and record the timing evidence needed before numeric estimates can be enabled. GPT-5.6 Sol owns test execution; Astra owns production implementation, with screenshot approval required before web or TestFlight release.

| Deliverable | Implementation | Evidence / release gate |
| --- | --- | --- |
| Camera assessment | CPU comparison of already sampled stills; stable / changed / unknown; persist bounded timestamp evidence per checked window; never alter content/broadcast gates | Real fixed-camera footage, held-out synthetic movement, obstruction/setup cases; no paid requests; bounded execution |
| Timing measurements | Worker-only append-only events: claim, verified profile, stage/progress, ready, failure, worker release after post-ready work | Fail-open recording; no private URLs/exceptions; Sol Python and isolated database tests |
| Owner feedback | Owner-scoped RPC for current processing job, observed stage, and camera result; no unvalidated numerical ETA | RLS/access tests; latest content check cannot hide requested processing; terminal/stale/missing states |
| Web | Existing HomeOverview and RawMatchView processing cards; upload completed status and library rows use same feedback; warning stays beside existing trim controls | Render exact shipped references before edits; desktop and 393×660; meaningful state tests and real npm run build in isolated checkout |
| iOS | Existing HomeScreen, MatchDetailScreen and MatchCards patterns; same feedback and wording | Native simulator reference and changed states; tests, archive, screenshots |
| Integration | Web base origin/main 6a36f82c; worker base deployed source 6ec6ea19, separate branch; narrow changes only | Sol review/regressions; sealed offline worker smoke/parity/integrity; screenshot approval; migrations, controlled worker release, web production, TestFlight |
| Numeric estimates | Disabled until comparable timings and chronological holdout coverage support a useful interval | Current evidence: 4 current-release jobs; best historical range 7/8 coverage, 18–23 minute width; insufficient for player promise |

| Processing location | Camera / telemetry packaging finding | Required release action |
| --- | --- | --- |
| Mac main / fast | The fixed worker release explicitly requires committed `camera_view_check.py` and `upload_feedback.py`; the camera child uses the checked pipeline interpreter. | Build and verify from the committed worker snapshot before activation; keep the existing runtime dependencies sealed. |
| Match Modal | Match Modal is disabled and current main contains no match-worker Modal package, so there is no runnable cloud payload silently omitting these modules. | A future adapter must package both sibling modules, map the pipeline Python and FFmpeg paths for Linux, provide OpenCV with SIFT, set the shared `PONGLENS_RELEASE_ID`, and pass parity before cloud claims are enabled. Set `PONGLENS_MATCH_RELEASE` only if that payload also contains and verifies `match_release`. |
| Lesson Modal | The lesson backup uses its separate sealed payload and does not run the match pipeline. | No camera or match-telemetry module belongs in the lesson package. |

| Sequence | Status |
| --- | --- |
| Sol feasibility studies | Complete: ETA insufficient; camera 112 local cases, no label errors |
| Sol rendered visual references | Inspected existing desktop, 393×660 mobile and native cards |
| Sol failing contract tests | RED observed before implementation; core contracts now GREEN |
| Astra implementation | Implemented; Sol integration review completed |
| Sol verification and release review | Passed: clean web/native builds, lint, contracts, rendered states and sealed model/parity/integrity gates |
| Owner screenshot review | Rendered changes ready; approval pending |
