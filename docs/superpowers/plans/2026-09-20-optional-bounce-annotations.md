# Optional bounce annotations

Add skippable bounce details to the shipped Point-ending labels player. Preserve ending labels and frozen machine evidence; keep corrections in the existing revisioned, audited label JSON. Adil explicitly requested production publishing without further questions, waiving approval checkpoints for this change.

Reference: rendered production Point-ending labels and PointEndingReview.tsx. Desktop and mobile web only; no worker, scoring or native change.

- [x] Validate optional versioned bounce annotations: stable detected indices, added UUIDs with raw-video timestamps, optional side, event kind, one last-rally-bounce reference. Reject out-of-window additions, invalid detector references, contradictory last-bounce kinds and duplicate IDs.
- [x] Keep old labels valid. Preserve annotations on old-client saves; compare full normalized label on ambiguous retry. Existing optimistic revisions and history protect concurrent updates.
- [x] Extend player with collapsed Bounce details, selected event dropdown, kind and optional side, last-bounce toggle, clear/remove controls and Add missed bounce at current frame. Added events carry time, not guessed position. Keep detected numbers stable and show added-event time markers.
- [x] Tests first for invalid annotations and backward compatibility; verify queue behavior with edits. Full research suite and real build in existing isolated worktree.
- [x] Render desktop and393×660, including collapsed, edited, added and removal states. Use isolated browser QA fixture for invented annotations; never write test labels into the real corpus.
- [ ] Independent code review complete; publish via main Git trigger and confirm live page. Recurring research remains paused.
