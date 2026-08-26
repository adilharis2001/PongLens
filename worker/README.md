# PongLens worker — Mac Studio setup

The worker is a pull-based daemon: it reads jobs from the `pgmq` queue in
Supabase over a direct Postgres connection, downloads the uploaded video,
runs the TTVid dead-space pipeline, and uploads the trimmed result. Nothing
connects *into* the Mac — it only pulls.

## 1. Install dependencies

```bash
pip3 install psycopg2-binary requests
```

The video pipeline itself uses the existing TTVid vendor setup — nothing
new to install as long as these exist:

- `/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python`
  (numpy + opencv + torch; runs blurball inference AND
  `worker/points_pipeline.py` — the cut/points logic itself is ported
  into PongLens, only the interpreter+libs come from TTVid)
- `/Users/adil/Desktop/Projects/TTVid/vendor/blurball_infer.py`
  (ball detector; writes blurball.jsonl used by both the cut and the
  points pipeline)
- `ffmpeg` / `ffprobe` on PATH

The former AGPL ultralytics/YOLO pose stage was removed (2026-07-22).
The isolated Apache-licensed RTMPose replacement remains available for
experiments, but production generation and all app consumers were disabled
on 2026-07-30. Keep Score asks the user who served first, game boundaries
use confirmed score plus explicit user corrections, and `points.server`
remains null.

`cut_deadspace.py` is no longer called from TTVid: the span/cut logic
lives in `worker/points_pipeline.py cut` with the SPEC.md strictness
presets (tight 0.5/1.0/1.5, normal 1.0/1.6/2.2, loose 1.6/2.4/3.5 for
pre-pad/post-pad/merge-gap seconds).

## YouTube import (jobs.kind = 'youtube_import')

Users can paste a public/unlisted YouTube link instead of uploading a
file. `/api/import-url` queues a `youtube_import` job with the URL in
`options.url`; the worker fetches it with **yt-dlp**, enforces the same
limits as uploads (<= 45 min, <= 2 GB), lands the file at
`r2://ponglens-raw/<uid>/<uuid>.mp4`, and runs the normal pipeline.

```bash
brew install yt-dlp     # 2026.07.04 at setup time
```

yt-dlp needs periodic updates because YouTube changes their player. If
imports start failing with extractor errors:

```bash
brew upgrade yt-dlp
launchctl kickstart -k gui/$(id -u)/com.adil.ponglens-worker
```

Format is pinned to mp4/h264 <= 1080p
(`bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]`) so the pipeline
never needs a re-encode. Download errors surface to the user as plain
messages ("That video is private or unavailable.") via `UserFacingError`,
which also archives the queue message immediately — no pointless retries.
Note: this worker runs on a residential IP, which matters — YouTube
bot-checks datacenter IPs aggressively; do not move the download step to
Vercel/cloud.

## Upfront content check (SPEC.md §6)

Right after the input video is downloaded (uploads and YouTube imports
alike) the worker samples 12 frames evenly across the video (skipping the
first/last 3%), downscales them to 512 px JPEGs, and sends them in ONE
OpenAI vision request (`gpt-5-nano`, key from Keychain `openai-api-key`
under account `openclaw`, or `OPENAI_API_KEY` env). The model answers
yes/no per frame; fewer than 3 of 12 "yes" = confident negative → the job
fails with "This doesn't look like a table tennis video. Upload a match
and try again.", the raw object is deleted from R2 immediately (plus a
negative `storage_ledger` row), and the queue message is archived (no
retries). Any API failure/timeout **fails open**: a warning is logged and
processing continues — availability beats gating. Cost is ~2.7k prompt +
~100 completion tokens ≈ $0.0002 per check.

Env knobs (mostly for debugging):

- `WORKER_SKIP_CONTENT_CHECK=1` — skip the gate entirely (local testing)
- `WORKER_CONTENT_CHECK_MODEL` — override the model (default `gpt-5-nano`)
- `WORKER_PLACEMENT_VISION_MODEL` — vision-capable OpenAI model used when
  the keypoint detector declines, both in the points pipeline's calibration
  ladder and for an owner-requested placement retry (default `gpt-5.6-sol`)
- `WORKER_PLACEMENT_VISION_ESCALATION_MODEL` — the cheaper second opinion
  the points ladder falls back to if the model above refuses (default
  `gpt-5.6-luna`). The name says escalation for backward compatibility;
  since 2026-08-26 it is a fallback, not an escalation.
- `WORKER_OPENAI_BASE_URL` — override the API base (used to test the
  fail-open path)

## Points pipeline (SPEC.md §6)

When a job has `options.points = true` the worker, after uploading the
cut, runs `points_pipeline.py points` on the ORIGINAL video:

1. activity spans + play splitting (ported analyze_plays logic)
2. auto table calibration: pink-rim frequency mask over sampled frames,
   components selected by ball-bounce evidence, quad -> homography.
   The debug overlay is uploaded as `calib_debug.jpg` next to the clips
   — eyeball it when accuracy questions come up. If calibration fails,
   placement + winner/how suggestions are skipped (noted in match.json).
3. per-point clips (720px, audio, x264 crf 23)
4. winner/how SUGGESTIONS via the umpire_v3 walker port (no strokes3d
   uplift stage here, so the serve anchor falls back to the first fitted
   segment and the forced-error km/h refinement is skipped). The
   classifier's serve-side seed is the ball-track estimate (first fitted
   detection's table half).
5. placement v3 reconstruction stores both physical-server hypotheses.
   The app-confirmed first-server rotation selects the matching hypothesis;
   the worker still writes `points.server = null`. Each hypothesis carries
   `ready`, `review`, or `unavailable` confidence and explicit shot
   landing/terminal events so a partial track is not drawn as a confident
   trajectory. Audio impact timestamps are optional evidence; production
   currently passes an empty list until the audio detector is connected.
6. when `PONGLENS_RTMPOSE_STRUCTURE_ENABLED=true`, the isolated RTMPose
   command samples three frames per point, analyzes the first three points
   for serve consensus, and stores summarized player-end evidence on the
   match. Missing calibration/model/runtime or ambiguous evidence fails open:
   the normal match still becomes ready.

`points.server` remains null. High-confidence RTMPose evidence may seed
`matches.first_server`; after that the app's ITTF rotation remains the source
of truth. The worker never overwrites `first_server_source = 'user'`.

Production RTMPose environment variables:

```text
PONGLENS_RTMPOSE_STRUCTURE_ENABLED=true
PONGLENS_RTMPOSE_PY=/Users/adil/Library/Caches/PongLens/rtmpose-production/venv/bin/python
PONGLENS_RTMPOSE_MODEL=/Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx
PONGLENS_RTMPOSE_BACKEND=onnxruntime
PONGLENS_RTMPOSE_DEVICE=mps
```

Bootstrap the isolated runtime and verified model with:

```bash
/path/to/python3.12 \
  worker/bootstrap_rtmpose.py \
  --root /Users/adil/Library/Caches/PongLens/rtmpose-production
```

Python 3.11 or newer is required for the pinned NumPy/ONNX wheels. The
bootstrap command checks this before creating an environment and upgrades
pip inside the new isolated venv before installing dependencies. Verify the
active checkpoint:

```bash
shasum -a 256 \
  /Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx
```

Expected SHA-256:
`5c0a4bf67953e6d2ac43ce15e77dc9d5d354ae18430a47d2c5963a7bc5683e3c`.
See `docs/operations/rtmpose-match-structure.md` for rollout and rollback.

Outputs land in `r2://ponglens-media/points/<userId>/<matchId>/`
(`NN.mp4`, `match.json`, `calib_debug.jpg`) plus a `matches` row and
`points` rows. Side mapping is currently ASSUMED: user = near player
(closer to the camera); match.json carries `side_mapping.assumed: true`.
Player identification is a later phase.

A points-stage failure never fails the job (the cut already shipped):
the match row is marked `failed` and the admin gets an email.

## 2. Store secrets in the macOS Keychain

Items live under account `openclaw`. Supabase (required):

```bash
# Direct Postgres connection string. Use the SESSION POOLER string from
# Supabase Dashboard -> Connect -> Session pooler (IPv4-friendly), e.g.
# postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
security add-generic-password -a "openclaw" -s "ponglens-db-url" -w "postgresql://..."

# Service-role key (Dashboard -> Project Settings -> API)
security add-generic-password -a "openclaw" -s "ponglens-service-role" -w "eyJ..."

# Project URL
security add-generic-password -a "openclaw" -s "ponglens-supabase-url" -w "https://<ref>.supabase.co"
```

(Env vars `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`
override the Keychain if set — handy for testing.)

Cloudflare R2 (required for all new jobs — binary storage lives in R2,
see SPEC.md §7):

```bash
security add-generic-password -a "openclaw" -s "ponglens-r2-account" -w "<cloudflare account id>"
security add-generic-password -a "openclaw" -s "ponglens-r2-key-id" -w "<r2 access key id>"
security add-generic-password -a "openclaw" -s "ponglens-r2-secret" -w "<r2 secret access key>"
```

(Env var overrides: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`.)

## Cost metering

The worker writes anonymous, platform-wide usage events through
`public.record_cost_usage` using its existing direct Postgres connection.
No additional provider management credential is required for normal
metering.

Currently metered:

- OpenAI content validation and YouTube opponent parsing tokens;
- BlurBall, pure-cut, point-clip, placement-retry, reclip, and reel runtime;
- successful R2 uploads, downloads, listings, and signed read estimates; and
- successful Resend recipients.

Metering is deliberately fail-open. A cost-event insertion failure is logged
but cannot fail or delay the underlying job. Usage metadata contains only
billing dimensions such as compute stage and storage class; it never contains
user IDs, match IDs, filenames, object keys, prompts, transcripts, or email
addresses.

The daily retention sweep also records current aggregate R2 bytes. Optional
read-only provider credentials add a separate daily reconciliation snapshot;
they do not replace or double-count the internal estimate. Setup instructions
are in `docs/platform-cost-credentials.md`.

## 3. Test in the foreground first

```bash
python3 /Users/adil/Desktop/Projects/PongLens/worker/worker.py
```

Upload a short video through the web dashboard; you should see the worker
pick it up within ~15 seconds. Logs go to `worker/worker.log` and stdout.
Ctrl-C to stop.

## 4. Build the AppleScript wrapper app (TCC workaround)

launchd-spawned bash cannot read `~/Desktop` on macOS. Wrap the worker in an
app and give that app Full Disk Access:

```bash
osacompile -e 'do shell script "export HOME=/Users/adil; export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin; /usr/bin/python3 /Users/adil/Desktop/Projects/PongLens/worker/worker.py >>/Users/adil/Desktop/Projects/PongLens/worker/stdout.log 2>>/Users/adil/Desktop/Projects/PongLens/worker/stderr.log"' -o ~/Applications/PongLensWorkerRunner.app
```

Then: **System Settings -> Privacy & Security -> Full Disk Access** -> add
`~/Applications/PongLensWorkerRunner.app` and toggle it ON.

Note: if `python3` with psycopg2 lives elsewhere (e.g. Homebrew's
`/opt/homebrew/bin/python3`), use that path in the osacompile command.

## 5. Install the launchd job

```bash
cp /Users/adil/Desktop/Projects/PongLens/worker/com.adil.ponglens-worker.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.adil.ponglens-worker.plist
```

Because the plist has `KeepAlive`, the worker starts immediately, restarts
if it crashes, and comes back after reboots (once you log in).

Useful commands:

```bash
launchctl print gui/$(id -u)/com.adil.ponglens-worker   # status / pid / exit code
launchctl kickstart -k gui/$(id -u)/com.adil.ponglens-worker  # force restart
launchctl bootout gui/$(id -u)/com.adil.ponglens-worker # stop + unregister
tail -f /Users/adil/Desktop/Projects/PongLens/worker/worker.log
```

Keep the Mac awake (or schedule wakes) — a sleeping Mac processes nothing:

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00
```

For a box that should process around the clock, consider
`sudo pmset -a sleep 0` instead.

## Placement v3 maintenance backfill

`backfill_placement_v3.py` regenerates placement only for existing matches. It
does not create job rows, queue messages, matches, points, clips, or backup
objects. Always dry-run an explicit canary before the real rollout:

```bash
CANARY_MATCH_ID="the-match-uuid"

/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  worker/backfill_placement_v3.py \
  --canary-match-id "$CANARY_MATCH_ID" --all-after-canary --dry-run

/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  worker/backfill_placement_v3.py \
  --canary-match-id "$CANARY_MATCH_ID" --all-after-canary
```

The canary must finish with every non-placement match and point field
unchanged before the runner starts another match. Later match failures are
reported individually and do not create partial database updates.

## Owner-requested placement retry

When initial match processing cannot produce any reliable placement maps,
the match still finishes successfully with
`placement_status = 'retry_available'`. Its owner can queue exactly one
`placement_retry` job during the raw video's 30-day retention window.
The retry regenerates only placement calibration and reconstruction; it
does not regenerate clips, points, scores, notes, or other match metadata.

The worker tries the deterministic recovery cascade first. Only if that
fails does it send representative frames to the vision model configured by
`WORKER_PLACEMENT_VISION_MODEL`. Model output is a temporary table-corner
proposal, never persisted as authoritative geometry. The worker snaps it to
locally detected table rims and applies local geometry, bounce-evidence, and
homography validation before accepting it.

A usable result sets `placement_status = 'ready'` and records
`placement_mapped_points`. Expected inability to recover placement is a
successful terminal queue outcome with `placement_status = 'final_failed'`;
it is not retried as a poison message. Support-facing failure codes include:

- `calibration_failed` — the initial deterministic calibration failed;
- `no_mappable_points` — calibration completed but no point was drawable;
- `vision_calibration_rejected` — the stronger proposal did not pass local
  validation;
- `source_expired` — the original recording passed its retention window; and
- `retry_processing_failed` — the retry exhausted the queue's transient
  failure attempts.

For support diagnosis, inspect these match fields together:

```sql
select id, placement_status, placement_retry_count,
       placement_mapped_points, placement_failure_code,
       placement_retry_expires_at, placement_retry_job_id
from public.matches
where id = '<match uuid>';
```

`placement_retry_job_id` must identify the exact `placement_retry` job the
worker is processing. A retry terminates as either `ready` or `final_failed`,
and each terminal outcome sends its own friendly email once.

## How failure handling works

- Each queue message becomes invisible for 30 minutes when read
  (`vt=1800`). If the worker crashes mid-job, the message reappears and is
  retried.
- After 3 failed attempts the message is archived (poison guard) and the
  job row stays `failed` with the error message, visible to the user.

## Storage + retention (SPEC.md §7)

Binary storage is Cloudflare R2; Supabase keeps auth/Postgres/queue only.

- New jobs: `input_path = r2://ponglens-raw/<userId>/<uuid>.mp4`,
  `result_path = r2://ponglens-media/results/<userId>/<jobId>.mp4`.
- Legacy rows (bare paths) still resolve against Supabase Storage
  (`uploads` / `results` buckets) — do not delete that code until the last
  legacy rows have aged out.

A daily sweep in the worker enforces retention:

| Tier | Location | Retention |
| --- | --- | --- |
| Raw uploads | `ponglens-raw` | 30 days |
| Cut videos | `ponglens-media/results/` | 30 days |
| Point clips + match.json | `ponglens-media/points/` | while account active (not swept) |
| Voice audio | `ponglens-media` (future phase) | 90 days |
| Legacy Supabase `uploads` | Supabase Storage | 30 days |

The future tiers are documented here so the sweep in `retention_sweep()`
gets extended (not replaced) when point clips and voice notes ship.
