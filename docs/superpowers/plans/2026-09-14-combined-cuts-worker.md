# Combined cuts worker implementation plan

**Goal:** Integrate the owner-reviewed combined cuts while excluding preparation-only first fragments.
**Architecture:** Keep the frozen body/V3 baseline as fallback. Collect restart evidence through explicit optional outputs, apply the reviewed pure card policy before export, then recompute private predictions against the final attempts. All feature switches default off pending visual acceptance and release.
**Approval:** Adil approved implementation, corpus replays and integration in this task; materially changed cuts require review before production rollout.

- [x] Add real owner-labelled fixtures for Brian51, Chris59 and Prabhas61; require preserving their second points and reviewed short genuine Julian points. Observe failures first.
- [x] Implement a general preparation-fragment rule; replay all nine cached contexts and enumerate every difference from the reviewed candidate.
- [x] Port the combined policy into a worker module with explicit evidence collection, safe metadata and no research filesystem dependencies.
- [x] Connect optional worker flag; collect V3 candidate evidence and four-second seed cards without monkeypatching normal behavior. Recompute predictions for final cards; verify exports and off-mode parity.
- [x] Run actual offline pipeline replays for nine recordings and relevant worker tests. Verify final card timing, complete prediction sidecars and clip playback.
- [x] Render only materially changed comparison cases with prior owner feedback preserved. Record release readiness and remaining review gates. No live switch in this step.
