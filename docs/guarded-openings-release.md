# Guarded body-card openings

This release adds the owner-reviewed opening trim to the combined rally and upload-feedback worker. It preserves baseline endings, card membership, serve/end metadata and continuation decisions, and retains the original cut when a proposal would violate those contracts. Activation is authorized; the gates below distinguish completed checks from pending work.

| Item | Evidence |
| --- | --- |
| Source | 6aebfd66, branch codex/guarded-openings-release, based on deployed combined source d11e1796 |
| Package | caeb69ce8163d27952c6b9ba744ba85712d4991d9e31204e3994a7de89387d92 |
| Current rollback | 7bc22c834fd237f866cc957fc17967524c43aa469d31e3e812854b0c59697576; retain whole signed launcher backups |
| Change | Search six seconds instead of four for a possible later start; preserve existing serve preparation, veto removed crossing/table-bounce evidence, and retain at least 1.2 seconds before first recorded activity using the existing 0.3-second tight-start padding |
| Integration fallback | Keep baseline if proposal changes card count, continuation acceptance, an ending, minimum length or valid ending evidence; copy only t0 to baseline final cards |
| Exact saved opening outputs | 96 cases / 1,890 cards match reviewed output; includes 77 contextual samples, six full input sets and 13 development recordings |
| Full combined-source assembly | Six recordings / 477 final cards match the reviewed staged candidate openings; every other card field and all baseline continuation decisions retained. The earlier pre-rally audit had 483 cards; this release preserves the combined worker's 477 |
| Source tests | 231 passed plus 14 subtests; fake service credentials, no production test jobs. Existing flat-module/package test imports require separate invocations |
| Independent code review | No unresolved critical/important findings after sparse end-evidence fallback; 62 tests and five subtests independently checked |
| Full web build | npm run build passed in this isolated checkout with its own dependencies and .next; existing lint warnings. Initial sandbox build could not reach Google Fonts; normal network build passed |
| Package scope | Exactly worker/body_points.py and its new test/fixture files differ in payload; models, runtime inventory and behavior environment identical to current combined release |
| Packaged replay | Passed: 96 cases / 1,890 reviewed edge outputs, six full matches / 477 cards; 14-recording rally corpus / 1,103 cards preserves baseline endings, metadata and all continuation decisions |
| Full local export and measured playback mapping | Passed: full 763.65-second Prabhas source, 66 point clips and 53 full-resolution cut segments; 159 identical frame payloads verify measured clock to 0.000003 seconds; all point/end seeks checked; maximum clip duration difference 0.0412 seconds. Cached full-duration ball/pose evidence; no new detector-speed or production-publication claim |
| Offline native/model checks | All eight passed: imports, native, pose, table, ball, 16-case frozen parity, side changes twice; integrity after inference. Same installed package and rollback verified; both permanent-location lane paths checked |
| Activation | Complete. Both old workers drained job-free; queue-locked stop preserved messages; new signed launchers started paused and passed exact-ID/fresh-monitor gates. Main PID 21074 and fast PID 21076 resumed; live check 2026-09-13 03:58:52 UTC showed main processing a queued camera check, fast idle, fresh monitor, and unchanged hand PID 55060. No TCC change or rollback was needed |
| User checkpoint | Owner will upload several matches after activation; no synthetic production match or scored-match reprocessing |
| Other surfaces | No web or iOS UI change, native iOS not tested. Hand, lesson and disabled cloud launchers unchanged |

| Source publication | Status |
| --- | --- |
| Local source | Committed and built from 6aebfd66; release branch/worktree retained |
| Public GitHub | Adil explicitly approved public GitHub publication on 2026-09-13. Publish codex/guarded-openings-release to the verified adilharis2001/PongLens repository; keep this captured worker release branch separate from main. Production already runs the verified package independently of GitHub publication |
