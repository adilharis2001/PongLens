# Worker releases and body processing health

Production must execute a fixed, identifiable bundle rather than an editable checkout. Each point-processing attempt must report its requested and delivered pipeline, including fallback and refinement outcomes. Preserve current cards, scoring behavior and the existing usable ball fallback.

## Scope and delivery

| Area | Requirement |
| --- | --- |
| Source baseline | Capture the live checkout's worker source and body assets on a dedicated branch; do not merge that baseline wholesale over newer application work. Record source hashes and distinguish captured baseline from new changes. |
| Release | Build from committed source. Content-addressed, verified worker code, models, external detector source and exact runtimes. Resolve one fixed path for the daemon and all children. Keep mutable cache/work/log data outside the payload. |
| Configuration | Snapshot effective per-job choices and their provenance; retain authorized per-job pipeline overrides and the V2 kill switch. Pin body model choice to the release. Missing config is observable. |
| Launch | Verify before claiming work. Stage without changing production. Drain existing work before switching main and fast launchers, retain a verified rollback. Never activate the old September 5 V2 candidate or enable Modal incidentally. |
| Outcomes | Additive, admin-only attempt record, plus match.json provenance. Include release/model IDs, requested/delivered assembler, body and V3 edge status, reason codes and times. Write attempt start before work and final outcome after the actual final output is chosen. |
| Refusals | Missing table/evidence/coverage are expected refusals; programming, dependency and timeout failures are operational degradation. No change to card decisions. |
| Monitoring | Durable deduplicated incidents; success of media delivery is independent of body health. Unknown reporting is never success. Monitor independently of the processing loop, with a local retryable spool if outcome publication fails. |
| Admin | Extend the existing /admin/processing screen using its shipped rows and table. Desktop and 393x660 mobile screenshots require Adil approval before UI publication. No iOS or Scorekeeper changes. |
| Verification | Real source/bundle tamper tests, frozen body parity, subprocess fallback integration, database permissions/idempotency/health tests, actual packaged pose smoke, representative packaged point assembly, full web build and rendered admin states. |
| Documentation | CLAUDE.md entry point, worker release/health runbook, baseline and rollout evidence. State staged versus active explicitly. |

## Non-interference

ScoreKeeper UI Improvements owns `.worktrees/scorekeeper-playback-integrity`; do not edit it, scoring helpers, points timing fields, or its migrations. Preserve other chats' root modifications. The worker's root checkout remains live until the verified switch; implementation happens only in `.worktrees/worker-release-health`. Observe current launcher/process/job state again immediately before activation.

## Existing foundations

Reuse the integrity and fixed-release runner approach in `.worktrees/modal-backup-worker/worker/release/` and the isolated lesson runner where suitable. Their full historical cloud queue/publication rewrite is not needed for this containment; match Modal stays disabled until a current compatible release passes parity. Reuse the existing admin-only operational data and alert delivery pattern without inheriting assumptions that only cloud attempts exist.
