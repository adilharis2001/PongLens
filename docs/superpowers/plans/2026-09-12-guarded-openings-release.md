# Guarded openings release implementation plan

The user approved the frozen six-second opening search with a 1.2-second first-activity lead and requested production activation. Integrate it on committed combined source d11e1796, preserving that release's rally and playback contracts. Do not retune models or alter scored matches.

| Step | Files / evidence | Completion gate |
| --- | --- | --- |
| Baseline | worker/tests/test_body_card_edges.py, test_rally_preservation.py, test_rally_continuation.py, test_cut_timeline.py, test_cut_timeline_consumers.py | Run real suites with worker package preloaded to avoid existing flat-import collision |
| Regression first | worker/tests/test_guarded_openings.py and sanitized timing fixtures | Reproduce missing improvement and pin the reviewed openings, early activity veto, existing serve protection, minimum duration, disabled anchoring, unchanged endings and fields |
| Implementation | worker/body_points.py | Parameterize private legacy anchor search; compare resolved four/six-second output; copy only guarded t0. Preserve baseline continuation outcomes and all other output fields; fall back if proposals change topology |
| Research replay | docs/guarded-openings-release-evidence plus temporary local scripts/media | Exact reviewed edges on all available cached inputs; full six-match assembly identical to staged reviewed results; existing rally corpus retains decisions |
| Source review | Independent code review of isolated diff | No unresolved important findings; commit and publish release branch, never merge captured runtime wholesale into main |
| Build and package checks | worker/match_release CLI, worker/tests/smoke_match_release.py | Committed source; unchanged assets/runtime/behavior settings; imports/native/pose/table/ball/parity/side-changes twice; post-inference integrity; both lanes check-only |
| Full local export | Complete saved match through actual packaged point pipeline/export | Approved starts and identical ends; real encoded offsets/card map; offline enrichment smoke; no synthetic production job |
| Deployment | Adapt pinned coordinated activation helper to explicit old/new IDs; independently review | Verify current combined rollback, backup signed launchers, drain job-free, queue barrier stop, install, start paused, exact-ID fresh pulses and monitor before resume |
| Handoff | Release evidence and root CLAUDE note | New main/fast healthy, monitor fresh, hand unchanged; user tests fresh uploads |
