# Task 2 report — Namespace the existing player pipeline

## Result

The tracked player chapter scripts, browser flows, and measured voice files now live under `player/` course directories. Capture, TTS, rendering, probing, and guard recovery validate course inputs against the full web Learn catalog before reading credentials or chapter files. All chapter-owned paths are derived from the shared path contract; probe validates the selected course because it operates on a route rather than a chapter asset.

Guard snapshots now use `raw/<course>/<slug>-guard.json`, capture footage and cue tracks use `raw/<course>/`, TTS output uses course directories, and the renderer writes `out/<course>/<slug>.mp4`. The snapshot/restore implementation and narration-driven capture clock were preserved.

## TDD checkpoints

- RED 1: `npm run test:tutorial` failed because the driver parser exports did not exist.
- GREEN 1: pure parsers reject missing or invalid courses, unknown catalog slugs, unknown flags/steps, and extra positional arguments; the initial tutorial suite passed 10/10.
- RED 2: a real import test for all moved player flows failed with `ERR_MODULE_NOT_FOUND` for `flows/player/account.mjs`.
- GREEN 2: every player flow now imports the shared `flows/account.mjs` from its new directory; the tutorial suite passes 11/11.

## Verification

- `npm run test:tutorial` — 11 passed, 0 failed.
- `env -u SERVICE_KEY node --experimental-strip-types scripts/demos/tutorial/capture.mjs invalid home` — exited 1 with the usage error and `Invalid tutorial course: invalid`; output contained no SERVICE_KEY credential request, proving invalid input stopped before credential/file access.
- `npm run test:learn` — 36 passed, 0 failed.
- `node --check` passed for capture, TTS, render, probe, and guard drivers.
- `git diff --check` — clean.

No capture, TTS request, render, or demo-data mutation was run in this task.
