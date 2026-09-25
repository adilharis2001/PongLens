# Cutting a hand-marked match on the iPhone: the server contract

**Date:** 2026-09-25. **Status:** the interface the iOS half is built
against. Server side implemented on `codex/hc-device-server`; not applied,
not deployed.

| Piece | Where |
| --- | --- |
| Database | `supabase/migrations/20260925160000_device_hand_cut.sql`; behaviour checked on a throwaway Postgres by `supabase/tests/device_hand_cut.sql` |
| Route | `src/app/api/hand-cut/device/route.ts`, pure rules in `src/lib/deviceHandCut.ts` |
| The plan and the Mac's check | `worker/hand_cut_device.py` (`plan_hand_cut` line 129, `check_manifest` line 284, `check_cut_probe` line 436) |
| The hand lane | `worker/worker.py`: `process_hand_cut` line 7488 branches to `_publish_device_hand_cut` (7377) and `_verify_device_hand_cut` (7310); both paths publish through `_publish_hand_cut` (7186); the sweep is `release_stale_device_hand_cuts` (7469) |
| Parity fixture | `ios/Tests/fixtures/cut-plan-parity.json`: 21 cases (the 8 live hand cuts and 13 edge cases), 451 points |

**Design:** `2026-09-24-ios-hand-cut-design.md`, sections 7 ("Cutting on
the iPhone") and 8. This file is the wire format: every call, every key,
every number the phone must produce and how the Mac checks it.

---

## 1. The flow

```text
 phone has the video?  ── no ──► claim_hand_cut (unchanged, the Mac cuts)
        │ yes, and device_hand_cut_enabled
        ▼
 claim_device_hand_cut ──► job: kind hand_cut, status processing,
        │                  options.cutter 'device', options.phase 'device'
        │                  (NOT queued; no worker sees it)
        ▼
 plan (section 5) ─► encode cut + clips ─► upload (route) ─► PUT manifest
        │   report_device_hand_cut every stage change and every <= 60 s
        ▼
 POST /api/hand-cut/device {action: submit}
        │   route HEADs every object, then submit_device_hand_cut:
        │   phase 'device' -> 'verify', status 'queued', sent to jobs_hand
        ▼
 hand lane (Mac): checks the manifest against the frozen marks, re-derives
 every position, probes the cut; thumbnail; publishes with the ordinary
 hand-cut publish path; ready email.
        │
        └─ any mismatch: note it, switch to cutter 'mac', cut on the Mac
           from the same marks. The player never sees a phone failure.

 Give up at any point before submit:
   release {toMac: true}  -> the Mac cuts it from the same marks
   release {toMac: false} -> marks handed back, draft editable again
 Phone never comes back:
   72 h with no report    -> released, "Cut failed" bell (section 8)
   24 h with no report    -> the web raw page offers "Cut on the Mac instead"
```

The draft is the same `hand_cut_drafts` row as today, frozen by the claim
exactly as `claim_hand_cut` freezes it.

---

## 2. Who can do it

| Thing | Value |
| --- | --- |
| Switch | `app_config.device_hand_cut`: `'off'` \| `'admins'` \| `'on'`, seeded `'admins'`. On the public read list, so the app can read it signed in |
| `'off'` | Nobody. The app offers only the Mac cut |
| `'admins'` | `is_admin()` accounts only (today these are also the only `hand_cut_enabled` accounts, because `hand_cut` is `'off'`) |
| `'on'` | Every account that passes `hand_cut_enabled` |
| The authoritative answer | `rpc device_hand_cut_enabled(p_user uuid) -> boolean`, same shape as `hand_cut_enabled`. Pass `auth.uid()`. An unreadable answer means no |

`claim_device_hand_cut` checks the switch itself; the app's reading is only
for deciding what to offer.

---

## 3. Database calls

All four are `security definer`, granted to `authenticated`, owner-only.
Errors are raised as Postgres exceptions whose **message is the code** (the
same convention as `claim_hand_cut`; PostgREST returns it as `message`).

### 3.1 `claim_device_hand_cut(p_match_id uuid, p_marks jsonb) -> jsonb`

`p_marks` is exactly what the app already sends `claim_hand_cut`
(`HandCut.submittable`): an array of `{t0, t1, w, let, star, tap, rate}`,
closed marks only, sorted by `t0`.

Every check `claim_hand_cut` makes, from the same shared validator
(`_hand_cut_claim_checks`), plus the switch. Errors:

| Message | SQLSTATE | Meaning |
| --- | --- | --- |
| `not_authenticated` | 42501 | No session |
| `not_enabled` | 42501 | `device_hand_cut_enabled` is false, or hand cutting itself is off for this account |
| `not_found` | P0002 | No such match owned by the caller |
| `bad_state` | P0001 | Match not `uploaded`/`failed`, or already has a cut |
| `no_source` | P0001 | No original in the caller's raw folder |
| `duration_unknown` | P0001 | `matches.duration_s` missing |
| `check_pending` | P0001 | The content check has not run |
| `already_cut` | P0001 | The match has points |
| `already_processing` | P0001 | A job for this match is queued or processing (a phone cut counts) |
| `queue_full` | P0001 | Four active jobs already |
| `invalid_marks` | 23514 | 1 to 400 marks, each 0.7 s to 180 s, no overlap, none ending more than 1 s past `duration_s`, `w` in `user`/`opponent`/null, a let has no `w` |

Once the match row is locked, and before the state checks, it releases a
stale phone cut on the same match (section 8), so a player who comes back
after 72 hours is not blocked by `already_processing`. `claim_hand_cut`
does the same.

Returns:

```json
{
  "job_id": "5d1c…",
  "points": 20,
  "bucket": "ponglens-media",
  "keys": {
    "cut": "results/<uid>/<job>.mp4",
    "manifest": "results/<uid>/<job>.manifest.json",
    "clips": ["points/<uid>/<match>/01.mp4", "…", "points/<uid>/<match>/20.mp4"]
  },
  "clip_pads": {"pre": 1.2, "post": 1.3}
}
```

`points` is the number of marks sent. `clips` has one key per mark in
`t0` order; if the plan drops a mark (a mark starting at or after the end
of the video, section 5), the phone uses the first `N` keys for its `N`
points. Clip names follow the Mac exactly: `f"{n:02d}.mp4"`, so point 100
is `100.mp4`.

What the claim writes: the draft frozen (`submitted_at`), a `jobs` row
(`kind 'hand_cut'`, `status 'processing'`, `progress 0`, options below),
and on the match `cut_source 'manual'`, `clip_pads {pre 1.2, post 1.3}`,
`job_id`. The job is **not** sent to any queue.

```json
{
  "match_id": "…", "source": "manual",
  "processing_version_id": "…", "originating_match_job_id": "<job>",
  "cutter": "device", "phase": "device", "device_points": 20
}
```

### 3.2 `report_device_hand_cut(p_job uuid, p_stage text, p_progress integer) -> jsonb`

Progress from the phone. Writes `jobs.progress`, `jobs.updated_at` and
`options.device_stage` / `options.device_reported_at`.

| `p_stage` | Admin page says | Player sees |
| --- | --- | --- |
| `device_cut` | Cutting on the iPhone | Cutting on your iPhone |
| `device_clips` | Cutting the clips on the iPhone | Cutting on your iPhone |
| `device_upload` | Uploading from the iPhone | Uploading from your iPhone |
| `device_paused` | Paused on the iPhone | Paused on your iPhone |

`p_progress` is 0 to 100 for the phone's whole part. Suggested split: cut
0 to 60, clips 60 to 80, upload 80 to 100. Report on every stage change
and at most every 10 s otherwise; while working, at least every 60 s when
the app can. Use `device_paused` for heat (`serious`), Low Power Mode, no
network, or a backgrounded app waiting to resume.

Returns `{"accepted": true, "phase": "device"}`, or
`{"accepted": false, "phase": "<phase>", "status": "<status>"}` when the
job is no longer the phone's to report (submitted, switched to the Mac,
released). **On `accepted: false` the phone stops work on that job.**

Errors: `not_authenticated` (42501), `not_found` (P0002),
`invalid_stage` (22023), `invalid_progress` (22023, not 0 to 100).

### 3.3 `submit_device_hand_cut(p_job uuid, p_manifest jsonb) -> jsonb`

**Called by the route, not by the app** (the route checks the objects
first; calling it directly is harmless but skips the check). Moves
`phase 'device'` to `phase 'verify'`, `status` to `queued`, stores
`p_manifest` (the route's receipt, under 16 KB) as `options.device_upload`,
and sends the job to `jobs_hand`. Idempotent: a second submit of a job
already in `verify` returns `{"job_id", "phase": "verify", "already": true}`.

Errors: `not_authenticated`, `not_found`, `bad_state` (P0001: not a phone
cut, or not in `device` or `verify`), `invalid_manifest` (22023: not an
object, too large, or its `key` is not this job's manifest key).

### 3.4 `release_device_hand_cut(p_job uuid, p_to_mac boolean) -> jsonb`

Allowed only while `phase = 'device'`.

| `p_to_mac` | Effect | Returns |
| --- | --- | --- |
| `true` | `options.cutter 'mac'`, `options.phase 'mac'`, `status 'queued'`, `progress 0`, sent to `jobs_hand`. Draft stays frozen, match stays linked. An ordinary Mac hand cut of the same marks follows | `{"job_id", "phase": "mac"}` |
| `false` | Marks handed back exactly as a terminal hand-cut failure hands them back (`_hand_cut_rollback` with `release=True`): job `cancelled`, match back to `uploaded` with `cut_source 'auto'` and no `job_id`, draft unfrozen. **No bell, no email** | `{"job_id", "phase": "released"}` |

Repeating the same release is idempotent (returns the same answer).
Errors: `not_authenticated`, `not_found`, `invalid_request` (22023,
`p_to_mac` null), `bad_state` (the job is past `device`: submitted, or
already released the other way).

---

## 4. The route: `POST /api/hand-cut/device`

Auth: `Authorization: Bearer <access token>` from the app (cookies on the
web), like every iOS route. Body is JSON with an `action`. Every action
except `release` refuses unless the job is the caller's, `kind hand_cut`,
`options.cutter 'device'`, `options.phase 'device'`, `status processing`.

| Action | Request | Response |
| --- | --- | --- |
| `create` | `{jobId, fileSize}` | `{bucket, key, uploadId}` — a multipart upload for the cut, at the claim's cut key only |
| `sign-part` | `{jobId, uploadId, partNumber}` | `{url}` — presigned PUT for one part, 6 h |
| `list-parts` | `{jobId, uploadId}` | `{parts: [{PartNumber, Size, ETag}]}` or `{parts: [], gone: true}` |
| `complete` | `{jobId, uploadId, parts: [{PartNumber, ETag}]}` | `{ok: true, bytes}` |
| `abort` | `{jobId, uploadId}` | `{ok: true}` |
| `sign` | `{jobId, keys: ["points/…/01.mp4", "results/…manifest.json", …]}` (at most 100 per call) | `{urls: {"<key>": "<presigned PUT url>"}}`, valid 10 minutes, so sign each batch just before sending it. Only the claim's clip keys (`01.mp4` … `NN.mp4`, `NN` at most the number of frozen marks) and the manifest key; anything else is `403 {error, refused: [keys]}` |
| `submit` | `{jobId}` | `{ok: true, phase: "verify"}`. Reads the manifest, HEADs the cut, the manifest and every clip it names; all must exist and be non-empty, then calls `submit_device_hand_cut` |
| `release` | `{jobId, toMac: boolean}` | the RPC's answer. With `toMac: false` the route also deletes the job's own cut and manifest objects (best effort) |

Status codes: `400` bad body, `401` not signed in, `403` a key that is not
this job's, `404` no such job, `409` job not in phase `device`
(`{error, phase}`) or objects missing on submit (`{error, missing: [keys]}`),
`413` too large (cut over 12 GB, clip over 60 MB, manifest over 2 MB),
`500` anything else.

Upload the manifest **last**, after the cut and every clip, then submit.
PUT with `Content-Type: video/mp4` for clips and `application/json` for
the manifest.

The route derives every key from the job, the match linked to it
(`matches.job_id`) and the frozen draft; nothing the request sends names a
key it can write. It does not check the storage allowance: a hand cut's
files are derived from an original the player already stores, the Mac's
own hand cut writes the same files without asking, and the Mac books them
in the storage ledger when it publishes.

---

## 5. The arithmetic the phone must reproduce

The rules are the Mac's own, in `worker/points_pipeline.py` (line numbers
at `ae070c50`):

| Name | Where | Value |
| --- | --- | --- |
| `SEGMENT_PADS["normal"]` | points_pipeline.py:364 | head 0.15, tail 0.15 |
| `SEGMENT_MERGE_S` | points_pipeline.py:369 | 0.5 |
| `play_cut_segments(windows, dur, head, tail, merge_gap)` | points_pipeline.py:468 | pad, clamp to [0, dur], sort, merge gaps under 0.5 |
| `hand_cut_length_tolerance(n)` | points_pipeline.py:489 | `max(2.0, 0.05 * n)` |
| `segment_cut_offsets(segments)` | points_pipeline.py:494 | running total of lengths |
| `cut_position(segments, offsets, t)` | points_pipeline.py:503 | offset + distance into the segment; a gap clamps to the edge |
| clip pads | `worker/hand_cut_device.py` `plan_hand_cut` | pre 1.2, post 1.3 |

The one statement of the whole plan is `plan_hand_cut(marks, duration)` in
`worker/hand_cut_device.py`, which the Mac's own hand cut, the phone-cut
check and the parity fixture all call.

Given the frozen marks (sorted by `t0`) and `D` = the phone's reading of
the source duration (`AVURLAsset` with precise timing, `.duration`):

1. Drop marks with `t0 >= D`. Clamp each remaining `t1` to `min(t1, D)`.
2. `window_i = (max(0, t0_i - 1.2), min(D, t1_i + 1.3))`.
3. `exact = play_cut_segments(windows, D, 0.15, 0.15, 0.5)`.
4. `cut_segments = [[r2(a), r2(b)] for a, b in exact]`. **These are what the
   phone encodes**, what the manifest reports and what `match.json` keeps.
5. `offsets = segment_cut_offsets(cut_segments)` (planned).
6. Per point `idx = 1..N` in `t0` order:
   `t0 = r2(t0_i)`, `t1 = r2(t1_i)`, `clip_t0 = r2(max(0, t0_i - 1.2))`,
   `clip_t1 = r2(min(D, t1_i + 1.3))`,
   `cut_t0 = r2(cut_position(cut_segments, offsets, clip_t0))`,
   `clip = f"{idx:02d}.mp4"`.

`r2(x)` is Python's `round(x, 2)`: the exact binary value rounded
half-to-even. In Swift, `Double(String(format: "%.2f", x))!` matches it;
`(x * 100).rounded() / 100` does not always (the fixture has the cases).

Encoding facts that make the measured clock equal the plan: two-decimal
segment edges are whole ticks at any timescale that is a multiple of 100
(600, 30000, 90000), so build the composition at such a timescale and
insert segment `i` at `offsets[i]` rather than at a running cursor. The
measured offsets then equal the planned ones.

**Parity fixture:** `ios/Tests/fixtures/cut-plan-parity.json`, generated by
`worker/hand_cut_device.py --write-fixture` from the real functions over
the marks of the eight live hand cuts plus synthetic edge cases (section
9). The Swift planner must reproduce every `expected` value exactly after
`r2`.

---

## 6. The manifest

`results/<uid>/<job>.manifest.json`, UTF-8 JSON, at most 2 MB, written
last.

```json
{
  "schema": 1,
  "pipeline": "hand-v1",
  "cutter": "device",
  "job_id": "<job uuid>",
  "match_id": "<match uuid>",
  "source": {
    "duration": 236.3233,
    "fps": 29.97,
    "width": 1920,
    "height": 1080,
    "rotation": 90
  },
  "clip_pads": {"pre": 1.2, "post": 1.3},
  "cut_segments": [[13.48, 22.12], [25.31, 40.02]],
  "cut_segment_offsets": [0.0, 8.64],
  "cut_first_frame_s": [0.0, 8.64],
  "cut": {"bytes": 104857600, "duration": 23.35, "width": 1920, "height": 1080},
  "points": [
    {"idx": 1, "t0": 14.83, "t1": 20.67, "clip_t0": 13.63, "clip_t1": 21.97,
     "cut_t0": 0.15, "clip": "01.mp4", "clip_bytes": 2400000}
  ],
  "encoder": {
    "cut": {"codec": "h264", "profile": "high", "keyframe_frames": 60,
            "video_bitrate": 6220800, "audio": "aac", "audio_bitrate": 128000,
            "faststart": true},
    "clips": {"codec": "h264", "width": 720, "keyframe_frames": 60,
              "video_bitrate": 2500000, "audio": "aac", "audio_bitrate": 96000},
    "device": "iPhone13,2", "os": "26.0", "app_build": "240"
  },
  "timing": {"cut_wall_s": 312.5, "clips_wall_s": 80.1, "upload_wall_s": 120.0}
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `schema` | yes | `1` |
| `pipeline` | yes | `"hand-v1"` |
| `cutter` | yes | `"device"` |
| `job_id`, `match_id` | yes | the claim's |
| `source.duration` | yes | `D`, the value the plan used, unrounded |
| `source.fps` | yes | `AVAssetTrack.nominalFrameRate` rounded to 3 decimals (the Mac writes ffprobe's `avg_frame_rate` the same way) |
| `source.width`, `source.height` | yes | `naturalSize`: the **stored** frame, before rotation, which is what ffprobe reports |
| `source.rotation` | no | degrees, diagnostic |
| `clip_pads` | yes | `{"pre": 1.2, "post": 1.3}` |
| `cut_segments` | yes | step 4, two decimals |
| `cut_segment_offsets` | yes | **measured**: where each segment's first source second landed on the cut's clock (the composition's target start for that segment). Within 0.05 s of the planned offsets |
| `cut_first_frame_s` | no | PTS of each segment's first written video frame, diagnostic; if present each is within 0.1 s of its offset |
| `cut.bytes`, `cut.duration`, `cut.width`, `cut.height` | no | diagnostic; the Mac measures for itself |
| `points[]` | yes | one per planned point, step 6; `clip` is `null` for a clip the phone could not encode (the Mac then re-cuts that one clip) |
| `points[].clip_bytes` | no | diagnostic |
| `encoder`, `timing` | no | diagnostic, kept in the job for the record |

Encoding, matching the Mac (`points_pipeline.cmd_cut`, `worker._encode_clip`):
cut H.264 at source resolution, keyframe every 60 frames, AAC 128 kbps,
index at the front; clips H.264 720 wide (height to the displayed aspect,
even), AAC 96 kbps, index at the front, each clip the source span
`[clip_t0, clip_t1]`.

---

## 7. What the Mac checks (hand lane, phase `verify`)

In order; the first failure is a **mismatch**. A mismatch is written to the
job (`options.device_note`, and a line in the Mac cut's `match.json`
notes), the job switches to `cutter 'mac'`, `phase 'mac'`, and the Mac cuts
from the same marks in the same run. A network error (not a missing object)
is retried by the queue like any other job.

| # | Check | Tolerance |
| --- | --- | --- |
| 1 | Manifest exists, is JSON, at most 2 MB, `schema 1`, `pipeline hand-v1`, `cutter device`, job and match ids are this job's, `clip_pads` 1.2 and 1.3, every number finite | exact |
| 2 | `source.duration` against the Mac's own probe of the original (ranged read). If that probe fails, against `matches.duration_s` | 0.5 s (1.5 s against `duration_s`) |
| 3 | `plan_hand_cut(frozen marks, source.duration)` against the manifest: no mark dropped, same number of segments and points, every segment edge, `t0`, `t1`, `clip_t0`, `clip_t1`, clip names | 0.011 s |
| 4 | Every point against its mark, the publish rule (`normalize_manual_cut_observations`) | 0.06 s |
| 5 | `cut_segment_offsets`: one per segment, increasing, first at most 0.1, each against the planned offset | 0.05 s |
| 6 | Every point's position through `_CutMap` (the re-cut lookup) with the manifest's segments and measured offsets, against the manifest's `cut_t0` | 0.05 s |
| 7 | The cut exists and is non-empty (HEAD); ffprobe over a presigned URL (header only): a video stream, codec `h264`; duration against the sum of the segments. A file ffprobe cannot read is a mismatch | `hand_cut_length_tolerance(segments)` |
| 8 | Every named clip exists and is non-empty (HEAD) | exact |

Then: thumbnail from the first clip, `match.json` written with
`pipeline hand-v1`, `source` from the manifest (`duration`, `fps`,
`width`, `height`; if the Mac's own probe of the original disagrees on
size or rate, the Mac's reading wins and the notes say so),
`cut_segments`, the measured `cut_segment_offsets`, and each point's
`cut_t0` as the Mac re-derived it in check 6. Storage ledger rows from the
HEAD sizes. Publication is the ordinary hand-cut path, unchanged:
`create_match(hand_cut=True)`, points, winners, lets and stars from the
marks, `publish_hand_cut_v2`, ready, the ready email.

Admin stage while this runs: `device_verify`, "Checking the iPhone's cut".
The player sees "Waiting to check the cut" while it is queued and "Checking
the cut" while it runs, then the hand cut's own stages ("Building the
points", "Saving the match").

On `/admin/processing` a job the phone holds is its own row, "iPhone":
working in the phone's words while it reports ("Uploading from the iPhone ·
Hand cut on iPhone · Adil · 19m", with its progress), and grey "Waiting for
the iPhone" once it has been quiet for five minutes. It is never amber and
never counted as a Mac worker being alive or stalled.

---

## 8. A phone that never comes back

A job in `phase 'device'` whose last report (`options.device_reported_at`,
or its creation if it never reported) is more than 72 hours old is
released by `release_stale_device_hand_cuts()`:

- job `failed`, `user_message` "The cut on your iPhone didn't finish. Your
  marks are saved.", which rings the existing "Cut failed" bell linking the
  match (`jobs_notify_failed`);
- marks handed back exactly as in `release_device_hand_cut(…, false)`;
- no email.

It runs from the hand lane's own loop every 10 minutes, and lazily inside
both claims for the match being claimed. No main or fast lane release is
involved.

After 24 hours without a report the web raw page offers "Cut on the Mac
instead" (`release {toMac: true}`, through the route), under "No update from
your iPhone for over a day." Until then it shows the phone's stage and
progress ("Cutting on your iPhone").

---

## 9. The parity fixture

`ios/Tests/fixtures/cut-plan-parity.json`:

```json
{
  "generated_by": "worker/hand_cut_device.py --write-fixture",
  "rules": {"clip_pre": 1.2, "clip_post": 1.3, "segment_head": 0.15,
            "segment_tail": 0.15, "merge_gap": 0.5, "decimals": 2},
  "rounding": [{"x": 2.675, "r2": 2.67}, …],
  "cases": [
    {
      "name": "live 04f1b393",
      "duration": 236.0,
      "marks": [[14.83, 20.67], …],
      "expected": {
        "segments_exact": [[13.48, 22.12], …],
        "cut_segments": [[13.48, 22.12], …],
        "offsets": [0.0, …],
        "kept_s": 123.45,
        "points": [{"idx": 1, "t0": 14.83, "t1": 20.67, "clip_t0": 13.63,
                    "clip_t1": 21.97, "cut_t0": 0.15, "clip": "01.mp4"}, …]
      }
    }
  ]
}
```

`marks` are `[t0, t1]` source seconds as stored in the frozen draft (the
short form `{t0, t1, w, …}` and the long form `{t0, t1, winner, …}`
normalise to the same pair). Live cases use `matches.duration_s` as `D`,
and carry `published_cut_t0`, what the Mac published, for reference only
(it used ffprobe's duration). Synthetic cases cover: windows merging under
0.5 s and not merging at exactly 0.5 s, overlapping windows, a clamp at 0,
a clamp at the duration, abutting points, a single point, a mark ending in
the final second, an end past the video, a mark starting after the end
(dropped), three-digit clip names, and marks with more than two decimals.
`rounding` pins `r2` on the values where `(x * 100).rounded() / 100`
differs from Python (2.675, 0.125, 1.115, 0.015).

Regenerate after any change to the rules, and commit both files:

```bash
worker/venv/bin/python -B worker/hand_cut_device.py --write-fixture \
  ios/Tests/fixtures/cut-plan-parity.json \
  --live worker/tests/fixtures/hand_cut_live_marks.json
```

`worker/tests/test_hand_cut_device.py` fails if the committed fixture and
the rules disagree.
