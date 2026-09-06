# PongLens clip backend: worker + database read (2026-09-06)

Read-only study of the Mac Studio worker (`worker/worker.py`, `worker/points_pipeline.py`) and the Supabase schema as recorded in `supabase/migrations/`. No files were edited and the live database was not queried; every statement about RLS/grants is from the migration files.

Line numbers refer to the checkout at `/home/user/PongLens`.

---

## 0. Orientation: what exists

| Thing | Where | Notes |
|---|---|---|
| Queue | pgmq queue `jobs` (`001_init.sql:111`) | one queue for every kind |
| Enqueue | trigger `jobs_enqueue` AFTER INSERT on `public.jobs` (`001_init.sql:133-135`), function `enqueue_job` last redefined in `024_youtube_grace_window.sql:10-31` | sends `{job_id,user_id,kind,input_path,options}`; delay 60 s for `deadspace_cut` and `youtube_import`, 0 for everything else |
| Worker | `worker/worker.py` `main()` (`8106-8243`), launched by `com.adil.ponglens-worker.plist` | one process, one Postgres connection, one message at a time |
| Reclip | `process_reclip` (`worker.py:5228-5350`) | cuts from the RAW, never the cut video |
| Original clips | `points_pipeline.py cmd_points` (`3039-3081`) | cut from the raw (or the trimmed working copy) |
| Cut video | `points_pipeline.py cmd_cut` (`952-1029`) | per-segment re-encode, concat, faststart |
| Clip storage | `r2://ponglens-media/points/<user>/<match>/` | never swept |
| Ledger | `public.storage_ledger` (`010_quotas.sql:76-84`) | `kind in ('clip','cut','voice','reel','entry_image','other')` after `017` and `056` |

Constants (`worker/worker.py`):

- `POLL_SLEEP_S = 2` (`301`; the comment at `288-300` explains it was 15 s and that a share spent 14 of its 18 s in this sleep)
- `VISIBILITY_S = 1800` (`302`) pgmq visibility timeout per read
- `MAX_READ_CT = 2` (`307`) archive after the second failed attempt (the README at `worker/README.md` still says "After 3 failed attempts"; the code is 2)
- `CLEANUP_EVERY_S = 24*3600` (`308`), `COST_ALERT_CHECK_EVERY_S = 60` (`309`)
- `R2_RAW_BUCKET = "ponglens-raw"`, `R2_MEDIA_BUCKET = "ponglens-media"` (`313-314`)
- `R2_RAW_RETENTION_DAYS = 30`, `R2_RESULTS_RETENTION_DAYS = 30`, `R2_VOICE_RETENTION_DAYS = 90`, `ENTRY_ORPHAN_GRACE_DAYS = 2` (`315-318`), `LEGACY_UPLOAD_RETENTION_DAYS = 30` (`310`), `SHARE_RENDER_RETENTION_DAYS = 7` (`7863`)
- `CLIP_PADDING = {"tight": (0.5, 1.0), "normal": (1.0, 1.6), "loose": (1.6, 2.4)}` (`5220`) is the FROZEN pre-048 fallback; `TIGHT_PAD = 0.3` (`5225`)
- `points_pipeline.py`: `STRICTNESS` (`194-198`, pre/post/merge for the activity-span stage), `CLIP_PADS = {"tight": (1.2, 1.3), "normal": (1.2, 1.3), "loose": (1.8, 2.0)}` (`239-243`, what clips are cut with today), `SEGMENT_PADS` 0.15/0.15 (`275-279`), `DYN_POST_MAX_S = 2.0` / `DYN_GAP_KEEP_S = 0.2` (`291-292`), `GOP_FRAMES = 60` (`297`)

---

## 1. RECLIP END TO END

### 1.1 Client side (before the queue)

Web (`src/app/match/[id]/MatchView.tsx`):

```ts
// 2158-2174
const enqueueReclip = useCallback(async () => {
  const supabase = createClient();
  const { data: queued } = await supabase
    .from("jobs").select("id")
    .eq("kind", "reclip").eq("status", "queued")
    .contains("options", { match_id: match.id }).limit(1);
  if (queued && queued.length > 0) return;
  await supabase.from("jobs")
    .insert({ user_id: userId, kind: "reclip", options: { match_id: match.id } });
}, [match.id, userId]);

// 2176-2182
const scheduleReclip = useCallback(() => {
  if (reclipTimer.current) window.clearTimeout(reclipTimer.current);
  reclipTimer.current = window.setTimeout(() => {
    reclipTimer.current = null;
    void enqueueReclip();
  }, 4000);
}, [enqueueReclip]);
```

`scheduleReclip` is called after every Adjust (`2285`), split (`2337`, `2990`), unsplit (`2998`), merge (`2421`, `3007`) and insert (`2240`). iOS (`ios/PongLens/PongLens/Core/PointExtras.swift:380-408`) does the same check-then-insert but with no debounce, immediately after each write (`240`, `267`, `328`, `372`), and swallows any insert error with `try?`.

### 1.2 Enqueue

The insert fires `jobs_enqueue`; for `kind='reclip'` the pgmq delay is 0 (`024:26-27`). The row starts `status='queued'`, `progress=0` (`001_init.sql:14-24`).

### 1.3 Pickup

`main()` loops: `read_message(conn)` is `select msg_id, read_ct, message from pgmq.read('jobs', 1800, 1)` (`535-542`). The queue is FIFO by `msg_id` with no priority, so a reclip waits behind whatever is already in front of it, and because the worker is single-threaded, behind whatever job is currently running (a full processing job is minutes to tens of minutes). Idle latency is up to 2 s.

`process_job` (`7172`): the row is claimed with one statement so a `cancel_queued_processing` cannot race it:

```python
# 7196-7208
cur.execute("update public.jobs set status = 'processing' "
            "where id = %s and status <> 'cancelled' returning id", (job_id,))
```

then for `kind == "reclip"` (`7265-7272`):

```python
update_job(conn, job_id, status="processing", progress=5, error=None)
with COST_METER.timed_stage("point_reclip_encoding", attempt_key):
    process_reclip(conn, job_id, user_id, payload)
update_job(conn, job_id, status="done", progress=100)
archive_message(conn, msg["msg_id"])
```

### 1.4 `process_reclip` (`5228-5350`), in order

1. `options = get_job_options(conn, job_id, payload)` (`5229`; `3484-3498`): re-reads `jobs.options` from the row, falling back to the queue payload. `match_id = options["match_id"]`.
2. One query for the match's owner, source job input, source job options and stored pads (`5234-5244`):
   ```sql
   select m.user_id, j.input_path, j.options, m.clip_pads
   from public.matches m left join public.jobs j on j.id = m.job_id
   where m.id = %s
   ```
   Ownership check `str(owner_id) != str(user_id)` raises (`5248-5249`). Note the source is `jobs.input_path` of `matches.job_id`, not `matches.raw_path`.
3. Pads: `matches.clip_pads` (`{"pre","post"}`, stamped by `run_points_stage` at `4805-4812`) if present, else `CLIP_PADDING[strictness]` (`5256-5261`), where strictness comes from the source job's `options.strictness` (`5251-5253`).
4. Targets (`5264-5271`):
   ```sql
   select id, idx, t0, t1, tight_start, tight_end from public.points
   where match_id = %s and edited and not deleted
     and t0 is not null and t1 is not null order by idx
   ```
   Empty target list returns early (`5272-5274`) and the job still goes `done`.
5. `progress=10`; `tempfile.mkdtemp(prefix="ponglens-reclip-<jobid8>-")` (`5276-5277`).
6. Download the WHOLE raw (`5280-5292`): `r2().download_file(bucket, key, local_input)` (boto3 managed transfer, whole object, default TransferConfig) or `storage_download("uploads", ...)` for legacy Supabase paths. There is no cache; every reclip job downloads the entire raw again. Size implications: raw uploads are capped at 6 GB by `/api/upload-url` (`MAX_BYTES`, `upload-url/route.ts:23`) and 2 GB for YouTube imports (`YT_MAX_BYTES`, `worker.py:184`); real footage is 2 to 15 Mbps, so a 45-minute match is 0.6 to 4.8 GB. This download is the dominant cost of a reclip on anything but a tiny match. Any exception is caught and logged; `source_ok` is then False.
7. `local_input = apply_source_trim(local_input, workdir, src_options)` (`5294-5296`; function at `3558-3573`): for a library job (commerce, `options.match_id` set and `trim_end_s` present) the working copy is cut to the claimed window with a stream copy:
   ```python
   ["ffmpeg", "-y", "-ss", f"{max(0.0, start_s):.3f}", "-i", local_input,
    "-t", f"{dur:.3f}", "-c", "copy", "-avoid_negative_ts", "make_zero", out]
   ```
   (`3547-3552`). This is what processing did before the pipeline saw the file, so every t0/t1 for a trimmed library match lives in the TRIMMED timebase; the reclip must reproduce the same trim or every cut lands `trim_start` seconds late. Keyframe snapping is deterministic between the two runs (same file, same arguments).
8. If the source is gone (`5298-5310`): for each target,
   ```sql
   update public.points set clip_path = null, edited = false
   where id = %s and t0 = %s and t1 = %s
   ```
   and return. The comment says "no original->cut mapping stored" (see section 2).
9. `progress=30`; `key_prefix = f"points/{owner_id}/{match_id}"` (`5312-5313`).
10. Per target (`5315-5349`), sequentially:
    ```python
    p_pre  = min(pre, TIGHT_PAD)  if tight_start else pre
    p_post = min(post, TIGHT_PAD) if tight_end   else post
    c0   = max(0.0, float(t0) - p_pre)
    span = (float(t1) + p_post) - c0
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", f"{c0:.2f}",
         "-i", local_input, "-t", f"{span:.2f}",
         "-vf", "scale=720:-2",
         "-c:v", "libx264", "-preset", "medium", "-crf", "23",
         "-c:a", "aac", "-b:a", "96k",
         "-movflags", "+faststart", out],
        check=True, timeout=1800)
    ```
    (`5314-5327`). `-ss` before `-i` is an input seek: ffmpeg jumps to the nearest preceding keyframe and decodes forward to the exact time, so the seek is fast and the output is frame-accurate under re-encode. `scale=720:-2` makes the clip 720 px WIDE (a 1920x1080 source becomes 720x406), not 720 tall; the codebase calls these "720p preview clips" loosely. No `-g`, so the clip's GOP is libx264's default (250). Software encode only.
    Then: `key = f"{key_prefix}/{int(idx):02d}-{uuid.uuid4().hex[:8]}.mp4"` (`5331`, fresh key per cut so caches never serve the old bytes); `r2().upload_file(out, R2_MEDIA_BUCKET, key, ExtraArgs={"ContentType": "video/mp4"})` (`5332-5333`); `ledger_append(conn, owner_id, "clip", size, f"r2://ponglens-media/{key}", match_id)` (`5334-5335`); then the guarded update (`5338-5345`):
    ```sql
    update public.points set clip_path = %s, edited = false
    where id = %s and t0 = %s and t1 = %s
    ```
    with the t0/t1 values read at step 4. If the row's timing changed while the clip was being cut, the update matches nothing, `edited` stays true, and "a follow-up reclip will redo this point" (comment `5336-5337`). `progress = 30 + 60 * done / n`.
11. `finally: shutil.rmtree(workdir)` (`5351-5352`).

**Hardware encoder: confirmed not used.** The only hardware-first helper is `_run_ffmpeg_encoded` (`5820-5837`, tries `h264_videotoolbox` then `libx264`). Its callers are `render_auto_highlights` (`5909`, `5945`), `render_reel` (`6183`, `6229`, `6265`) and `render_story` (`6426`, `6468`). `process_reclip` calls `subprocess.run(["ffmpeg", ... "-c:v", "libx264", "-preset", "medium", "-crf", "23" ...])` directly at `5321-5328`, as does the original clip cut in `points_pipeline.py:3074-3081` and the cut video in `cmd_cut` (`991-1010`).

### 1.5 Where the time goes (reclip)

| Step | Cost |
|---|---|
| Web debounce | fixed 4 s (`2181`); iOS 0 |
| pgmq delay | 0 for reclip |
| Pickup | up to 2 s idle, or the remainder of whatever job is running (no preemption, no priority) |
| Raw download | whole object, 0.6 to 6 GB; the biggest single cost; repeated on every reclip job |
| `apply_source_trim` | stream copy of the claimed window, I/O bound, writes a second copy to disk (library matches only) |
| Per clip | input seek + decode + scale + libx264 medium of a 5 to 25 s clip, sequential; a few seconds each on Apple Silicon CPU |
| Upload | a few MB per clip |
| DB | one ledger insert + one guarded update + one `update_job` per clip |
| Client notices | web and iOS poll `points` every 8 s while any visible point has `edited=true` (`MatchView.tsx:2432-2453`; `MatchDetailScreen.swift:57,61-75`) |

Durations are not written to the log for reclips (the log line at `5349-5350` has no timing). `timed_stage("point_reclip_encoding")` records elapsed compute seconds into the platform cost tables via `record_cost_usage` (`worker/cost_meter.py:268-287`), so per-attempt timings exist in Postgres, not in `worker.log`. Reels do log `rendered in %.0fs` (`6788-6789`).

---

## 2. WHY RAW AND NOT CUT

### 2.1 What the timebases are

- `points.t0`, `points.t1`: seconds in the ORIGINAL video (`003_match_experience.sql:61-62`), which for a trimmed library job means the trimmed working copy (see 1.4 step 7).
- `points.cut_t0`: seconds in the CUT video where the point's PADDED clip starts, i.e. the cut position of `c0 = max(0, t0 - clip_pre)` (`011_cut_t0.sql:5-9`; `points_pipeline.py:3042-3051`).
- `points.clip_path`: the preview clip, cut from the raw over `[t0 - pre_eff, t1 + post_eff]`.

### 2.2 Does the cut preserve source durations inside a segment?

Yes, by construction. `cmd_cut` re-encodes each kept segment `(s0, s1)` with `-ss s0 -i raw -t (s1 - s0)` (`991-1010`) and concatenates the parts with the concat demuxer and `-c copy` (`1020-1022`). Inside one segment, `cut_t = offset + (t - s0)` (`segment_cut_offsets`, `400-406`; `cut_position`, `409-418`). The client already depends on this: `playhead.ts:9-35` ("The worker keeps source durations intact in the cut"), `ModifyClip.tsx:184-198` (`cutOf(src) = rallyStart + (src - t0)`), `SharePointSheet.swift:375-388`, and `api/reel/route.ts:398-425`.

Caveat: the offsets are arithmetic, not measured. Each part's real duration can differ from `s1 - s0` by up to a frame, and AAC parts carry encoder priming; across a hundred segments that can accumulate into a visible drift between `cut_t0` and the file. Nothing in the repo measures it.

### 2.3 Is there a stored original-to-cut mapping?

Partly, and the comment at `worker.py:5297` ("no original->cut mapping stored") understates it:

- For every match processed in `plays` cut mode (dead-space round 4 onwards), `match.json` in R2 (`points/<uid>/<mid>/match.json`) carries `cut_mode: "plays"` and `cut_segments: [[s0, s1], ...]` in source seconds (`points_pipeline.py:3159-3165`), plus per point `clip_t0`, `clip_t1`, `cut_t0` (`3083-3087`). `segment_cut_offsets(cut_segments)` reconstructs the whole map exactly.
- For older spans-mode matches, `match.json` has no segment list; only the per-point `cut_t0` anchors exist.
- In Postgres, each point has `cut_t0` (anchor of the original padded start) and the match has `clip_pads`; the linear map for a point is `cut_t = cut_t0 + (t_source - (t0_orig - pre_eff))`, valid while `t_source` stays inside that point's kept segment.

The catch: `t0_orig` is not kept once t0 is edited. `cut_t0` is never rewritten by an Adjust (the client has no UPDATE grant on it; grants are `t0, t1, deleted` (`007:24`), `tight_start, tight_end` (`020:25`) and the scoring columns) and `process_reclip` does not touch it either (`5338-5345`). So after a t0 move of delta, every consumer that computes `rallyStart = cut_t0 + eff.pre` (`playhead.ts:43-49`, `ModifyClip.tsx:63-66`, `reel/route.ts:415-420`, `SharePointSheet.swift:380-388`) is off by delta in cut seconds. `insert_point` says this out loud: "cut_t0 anchors the span in the CUT video, which is not regenerated" (`101:113-116`). Split children and inserted cards get a client-computed `cut_t0` (`023`, `101:96-108`) that is only right if the seam is continuous.

### 2.4 Could the reclip cut from the cut video?

For an edit whose new window `[t0' - pre, t1' + post]` lies inside the union of kept footage: yes. The new clip is `cut_t0_orig + (t0' - pre) - (t0_orig - pre_orig)` for `span` seconds of the cut, and the cut is already at full resolution with a 2 s GOP, faststart and audio. `render_story` and `render_reel` already do exactly this kind of extraction from the cut (`6414-6416`, `6205-6207`). The information needed is `t0_orig`/`clip_t0` from `match.json` (or a new stored column) and `cut_segments` to test containment. The spec at `docs/superpowers/specs/2026-08-30-missing-rally-insert-and-serve-rotation-design.md:66-80` measured that 55% of seams are continuous (under 0.25 s removed), so a large share of inserts and most Adjusts (which nudge by a second or two inside footage that was kept as pad) would be servable from the cut.

What breaks when the edit reaches outside a kept segment: the footage does not exist in the cut at all (it was dead space). A clip cut from the cut would either be short or would splice in the next segment's footage with a jump; the spec chose to say so in the UI ("Not in this video" band, `2026-08-30 spec:180-186`) rather than hide it. That case needs the raw, or a null clip when the raw is gone. So a cut-based reclip is a fast path for edits that stay inside `cut_segments`, and the raw path remains for the rest.

Why it was not done: the worker comment says the mapping was not stored (true for spans-mode matches, and `cut_segments` came later), and the raw path was simpler and always exact. Nothing else technical prevents it.

---

## 3. CAN FFMPEG READ R2 BY URL

Yes, and it already does in production for one path. `_cut_video_url` (`6518-6537`) signs a GET with `r2().generate_presigned_url("get_object", Params={"Bucket","Key"}, ExpiresIn=3600)`, and `process_reel` hands that URL to `render_story` for vertical shares (`6736-6743`: "hand ffmpeg a signed URL and let it range-seek"). `render_story` accepts `cut_local.startswith("http")` (`6301-6311`), runs `ffprobe` over the URL and then `ffmpeg -ss <s0> -t <dur> -i <url>` (`6414-6416`). ffmpeg's https demuxer uses HTTP Range requests for seeks, R2 honours them, and the SigV4 query-string signature travels with every request.

Nothing blocks it: auth is in the query string (`boto3` on the worker; `aws4fetch` with `signQuery: true` in `src/lib/r2.ts:63-73` on the web), there is no special boto configuration, and CORS is a browser concept that does not apply to ffmpeg. The only limits are the URL expiry (3600 s on the worker; 3600 or 21600 s on the web routes) and no `-reconnect` flags, so a dropped connection mid-render fails the command. `render_reel` (`6094`) and `render_auto_highlights` (`5848`) still require a local file (`os.path.exists` / `os.path.isfile`); named exports walk the whole video so they download once (`_fetch_cut_video`, `6540-6575`).

The iOS device renderer does the same thing with AVFoundation: `StoryRenderer.render(cutURL:)` builds an `AVURLAsset` on the signed cut URL and range-reads it (`StoryRenderer.swift:51-67`).

---

## 4. QUEUE

- One pgmq queue, `jobs` (`001:111`). One worker process: the launchd plist has a single `Label` with `KeepAlive` (`com.adil.ponglens-worker.plist`), and `main()` reads with `qty => 1` (`537-540`). One Postgres connection with `autocommit = True` (`528-532`), shared by the cost meter.
- Visibility: 1800 s per read. A crash mid-job makes the message reappear after 30 min with `read_ct + 1`.
- Poison handling (`8135-8224`): any exception marks the row `failed` with `error=str(e)[:500]` and `user_message` only for `UserFacingError` (`8149-8156`); `UserFacingError` or `read_ct >= 2` archives the message (`8215-8221`), and the archive step sits OUTSIDE the bookkeeping try-block so a failure there cannot leave a message retrying forever (`8189-8214`). Library-job refunds happen at `8160-8171`. Placement kinds get a terminal status written on poison (`8174-8207`). `send_failure_emails` runs for every failure (`8223-8224`); the bell trigger `jobs_notify_failed` ignores reclip/reel/placement (`066:56-60`).
- No priority. `pgmq.read` returns the oldest visible message. Uploads and imports are delayed 60 s at enqueue (`022`, `024`), which is the only ordering lever.
- Kinds on this queue (`process_job` dispatch): `placement_generate` (`7210-7250`, inserted by `055`), `placement_retry` (`7252-7263`, inserted by `049`), `reclip` (`7265-7272`, client insert), `reel` (`7274-7281`; covers match exports, tag reels via `options.tag_id`, vertical shares `v:point:*`/`v:starred`, and automatic `highlights`; inserted by `enqueue_reel` and friends `017/028/036/042/135/137/20260906040000`), `content_check` (`7283-7376`, inserted by `register_upload` `131:114-119`), `deadspace_cut` and `youtube_import` (`7378` onward; `claim_processing` in `096:739-751`, `/api/import-url`). Anything else raises "unknown job kind" (`7378-7379`), which after two attempts archives. Lesson videos are NOT on this queue: `worker/lesson_video.py` is an independent worker leasing rows from `lesson_videos` with `for update skip locked` (`173_lesson_video.sql:50`).
- Durations: not logged for reclip; recorded as compute seconds in the cost tables (`timed_stage`). Reels log their render time. Migration `136` notes a server story render at "~5s end to end since the poll came down to 2s".
- Adding a second process or queue:
  - Claim semantics are safe: `pgmq.read` with a visibility timeout hands each message to one reader, and the row claim (`7196-7208`) is a single statement. Workdirs are `mkdtemp` per job. The R2 client and cost meter are per-process globals.
  - What assumes a single worker: (a) the retention sweep runs in every process's main loop at boot and daily (`8117-8122`), so two processes double-run it (mostly idempotent thanks to `_ledger_negate_keys`, but `share_render_sweep` deletes rows and the digests use `app_config` markers set non-atomically, so a second process can double-send a digest); (b) `start_cost_alert_monitor` thread per process (`8065-8075`) means duplicate alerts; (c) both processes append to the same `worker.log` (`321-322`); (d) `_r2_client` and `COST_METER.connection` are module globals, fine per process but not shareable; (e) blurball/RTMPose contend for the same GPU/CPU; (f) the launchd label is unique, so a second instance needs its own plist; (g) two reclip jobs for the same match can run concurrently; both will succeed, the loser's clip object is orphaned (already the pattern, see 10.5).
  - A second queue for short jobs (reclip, reel, story) needs: `pgmq.create('jobs_fast')`, `enqueue_job` routing by `new.kind`, `read_message`/`archive_message` parameterised by queue name (both hard-code `'jobs'`, `538` and `547`), and a worker flag or second process reading only that queue, with the sweep/digest/alert side loops disabled in the secondary.

---

## 5. JOB ROW LIFECYCLE (reclip)

- Insert: the browser or phone inserts directly into `public.jobs` with `{user_id, kind: 'reclip', options: {match_id}}` (`MatchView.tsx:2172-2173`; `PointExtras.swift:398-407`). No API route is involved.
- RLS on `jobs` (from the migrations): select own rows (`001:52-55`); insert with `user_id = auth.uid()` and nothing else (`001:57-60`); update restricted to the `options` column on own rows (`012_job_meta_edit.sql`); no delete. `kind` has NO check constraint (`001:19`; `007` header line 14 says so explicitly). `status` is constrained to `queued|processing|done|failed|cancelled` (`112:38-40`), `user_message` to 300 chars (`066:20-22`). So an authenticated client can insert any `kind`, any `input_path`, any `options`. See 10.9 for what that implies.
- Transitions: `queued` (default) -> `processing` (claim `7196-7208`, then `7267` with `progress=5`, `error=null`) -> `progress` 10 (`5276`) -> 30 (`5310`) -> `30 + 60*k/n` per clip (`5347-5348`) -> `done`, `progress=100` (`7269`). On exception: `failed` with `error` (`8154-8156`), `user_message` null (reclip never raises `UserFacingError`); the message is retried once after 30 min (status goes back to `processing`), then archived on the second failure.
- What the client polls: not the job row. Web polls `points` (`id, t0, t1, clip_path, edited, deleted, tight_start, tight_end`) every 8 s while any visible point is `edited` (`MatchView.tsx:2432-2453`); iOS does the same at 8 s (`MatchDetailScreen.swift:61-75`). The UI shows "Updating clip" while `edited` (`PointDetail.tsx:504-525`) and locks Adjust (`PointDetail.tsx:264-269`; `ModifySheet.swift:218`). Reclip jobs are excluded from the dashboard's active list (`HomeOverview.tsx:340`) and from `my_storage_state.active_jobs` (`010:187-190`), so they never trip the 4-job queue rule in `src/lib/quota.ts:24`.

---

## 6. THE `edited` FLAG CONTRACT

Definition: `points.edited boolean not null default false` (`007:20`), "the point's t0/t1 changed (or it was born from a split) and its clip is stale" (`007:7-9`; `src/lib/types.ts:412-414`).

Who sets it:

- Trigger `points_mark_edited`, BEFORE UPDATE OF t0, t1, `when (old.t0 is distinct from new.t0 or old.t1 is distinct from new.t1)` (`007:28-43`):
  ```sql
  create or replace function public.mark_point_edited() returns trigger ... as $$
  begin new.edited = true; return new; end; $$;
  ```
  This is the only way a client edit sets it: `authenticated` has no UPDATE grant on `edited` (the grant lists never include it; the iOS comment at `PointExtras.swift:344-349` records that sending it made every Adjust a silent 403).
- `split_point` sets the parent `edited = true, tight_end = true` and inserts the child with `edited = true, tight_start = true` (`023:66-79`, superseding `007:81-90` and `020:56-69`).
- `insert_point` inserts the new card with `edited = true` and trims each overlapped neighbour with `edited = true` (`101:92-104`, `122-130`).
- `merge_points` sets the survivor `t1 = last_t1, tight_end = false, edited = true` (`027:70-74`).
- `unsplit_point` sets `edited = parent_edited` (`026:78-81`) but the t1 change re-fires the trigger, so it comes out true (the migration comment at `026:19-23` acknowledges this).
- Client optimistic mirrors set it locally only (`MatchView.tsx:2275`, `2226-2229`; `PointExtras.swift:263,313,318,352`).

Who clears it: only `process_reclip`, in two places, both guarded by `t0 = %s and t1 = %s`: the source-gone path (`5301-5308`, with `clip_path = null`) and the success path (`5338-5345`). Nothing else in the repo writes `edited = false` (fresh matches insert rows with the default).

Who reads it:

- Worker: `process_reclip` target query (`5267`); `highlights.qualifies` refuses edited points (`worker/highlights.py:57`) and `points_revision` hashes it (`131`); `process_reel` automatic scope selects it (`6697-6706`).
- Database: trigger `points_invalidate_highlight_evidence` nulls `highlight_evidence` when `edited` flips (`20260906040000:18-40`, widened in `20260906041000`); `resolve_share_points` returns it to the share page (`139:30,41`); admin RPCs return it (`069`, `134`, `144`).
- Web: `hasPendingClips` poll (`MatchView.tsx:2432`); `clipLocked` (`PointDetail.tsx:269`); "Updating clip" states (`PointDetail.tsx:504-525`); `effectiveEnd` skips tap/rally-end trimming for edited points (`playhead.ts:126-141`); the reel route does NOT filter on it (`api/reel/route.ts` has no `edited` reference), so an export can be built from a stale `clip_path` or stale `seg_start/seg_end` mid-reclip.
- iOS: `hasPendingClips` (`MatchDetailScreen.swift:57`); `adjustLocked` (`ModifySheet.swift:218`); `PointDetailScreen.swift:133`; `StarredScreen.swift:329,426,545,563`; `PlayerTakeover.swift:2498-2526`; `Playhead.swift:126`.
- Placement: no reader. Placement backfills update `placement` by `(match_id, idx)` only (`worker.py:2418-2436`) and raise if a row is missing, so a merged-away idx fails the whole backfill; edited timings are not re-read from Postgres (the backfill works from `match.json`).

---

## 7. STORAGE + LEDGER FOR CLIPS

- Bucket `ponglens-media`. Originals: `points/<user_id>/<match_id>/NN.mp4` (`run_points_stage`, `4713-4717`), plus `match.json`, `calib_debug.jpg`, `thumb-<job_id>.webp`, card diagnosis. Reclips: `points/<owner_id>/<match_id>/<idx:02d>-<8 hex>.mp4` (`5331`).
- Ledger rows (`storage_ledger`, `010:76-84`; `kind` check extended by `017:59-62` and `056:8-11`): originals are booked as ONE aggregate row `kind='clip'`, `bytes = sum of all clips`, `r2_key = 'r2://ponglens-media/points/<uid>/<mid>/'` (the prefix), `match_id` set (`4783-4784`); `match.json`/thumb/etc as one `kind='other'` row on the same prefix (`4785-4786`); the cut as `kind='cut'` keyed by its own path, no `match_id` (`7600-7601`); each reclip as its own `kind='clip'` row keyed by the object and carrying `match_id` (`5334-5335`).
- Quota: `my_storage_state.used_bytes = sum(bytes)` over the user's ledger (`010:172-203`), against `storage_limit_bytes` (2 GB default, entitlements in commerce mode). Reclips therefore add to the user's usage every time (see 10.5).
- Deletion: `/api/delete-match` removes everything under the prefix, the cut and voice audio, then deletes the row (`delete-match/route.ts:11-24`); the BEFORE DELETE trigger `ledger_on_match_delete` negates every row with `match_id` (covers originals and reclips) and negates the cut and voice keys (`010:297-329`).

### If a phone uploaded a re-cut clip itself

To keep accounting and the points row consistent, the phone-produced clip needs, in one place:

1. A key inside the owner's match folder: `r2://ponglens-media/points/<auth.uid()>/<match_id>/<idx:02d>-<random>.mp4` (fresh name, same reason as `5330`).
2. A way to write it. Today the only client-facing writers are `/api/upload-url` (presigned multipart PUT, but hard-coded to `ponglens-raw/<uid>/<uuid>.<ext>`, `upload-url/route.ts:78-80`) and the small-file routes that accept a multipart form and `putObject` server-side (`/api/note-image` `note-image/route.ts:67-82`, `/api/transcribe` `transcribe/route.ts:184-210`, `/api/entry-image`). A per-point clip is 1 to 10 MB, so either pattern works; a presigned PUT (`presignPut`, `src/lib/r2.ts:78-86`, currently unused by any route) is the lighter one.
3. A SECURITY DEFINER RPC that records it, because the client has no UPDATE grant on `clip_path` or `edited` and no INSERT grant on `storage_ledger` (`010:96`). It should: check `auth.uid()` owns the match; check the key prefix matches `'r2://ponglens-media/points/' || auth.uid() || '/' || match_id || '/%'` and that `bytes` is positive and bounded (the pattern of `ledger_append_voice`/`_sketch`/`_entry_image`, `010:232-254`, `040:13-35`, `056:13-67`); then
   ```sql
   update public.points set clip_path = p_key, edited = false
    where id = p_point_id and match_id = p_match_id
      and t0 = p_t0 and t1 = p_t1;           -- the same guard the worker uses
   if found then
     insert into public.storage_ledger (user_id, match_id, kind, bytes, r2_key)
     values (auth.uid(), p_match_id, 'clip', p_bytes, p_key);
   end if;
   ```
   returning whether it applied, so the phone can delete its object (or leave it for a sweep) when the guard fails. `points_invalidate_highlight_evidence` will null the evidence on the `clip_path`/`edited` change, matching what the worker path does.
4. Optionally negate the previous clip's ledger row by key when the old `clip_path` was a per-key reclip row (`_ledger_negate_keys` is service-only, `010:284`, so the RPC would inline the same insert). Originals cannot be negated individually because they were booked under the prefix.

The closest existing precedent for "client-produced media, server records it in one function" is `register_upload` (`131:34-119`): the browser completes a presigned multipart PUT into the raw bucket, then one SECURITY DEFINER RPC validates the key prefix and byte count, creates the `matches` row, books the ledger row and enqueues the `content_check` job atomically, granted to `authenticated` and `service_role` only. The device story render (`StoryRenderer.swift`, chosen by `app_config.instagram_render = 'device'`, `136_instagram_render_path.sql`) is the precedent for a phone producing an mp4 from the signed cut URL, but it records nothing server-side: the file goes to the pasteboard and Instagram.

---

## 8. CUT VIDEO AND CLIP PROPERTIES

Cut video (`points_pipeline.py cmd_cut`, `991-1022`):

```
ffmpeg -y -v error -ss <t0> -i <raw> -t <t1-t0>
  -c:v libx264 -preset medium -crf 18
  -g 60 -keyint_min 60 -sc_threshold 0
  -c:a aac -b:a 128k part_NNN.mp4
ffmpeg -y -v error -f concat -safe 0 -i list.txt -c copy -movflags +faststart <out>
```

- Resolution and frame rate: the source's (no scale filter). Pixel format inherited from the decode (no `-pix_fmt`), profile libx264 default (High for 8-bit 4:2:0).
- GOP: fixed 60 frames with no scene-cut keyframes (`GOP_FRAMES`, `297`; the comment at `995-1006` records that the default 250 put keyframes 8.34 s apart and made every seek stutter). At 30 fps that is 2 s, at 60 fps 1 s. Stream-copy cuts on the device can only start on those keyframes (up to 2 s early); frame-accurate cuts need a re-encode, which is what `AVAssetExportSession` does anyway.
- Audio: AAC 128 kbps if the source has audio (no `-an`; a silent source produces a video-only file).
- Bitrate: CRF 18, so quality-driven; a shipped cut is noted at 635 MB (`1012-1014`).
- faststart: yes, at the concat remux (`1020-1022`).

Per-point clips (originals `3074-3081`, reclips `5321-5328`, identical arguments):

```
ffmpeg -y -v error -ss <c0> -i <raw> -t <c1-c0>
  -vf scale=720:-2
  -c:v libx264 -preset medium -crf 23
  -c:a aac -b:a 96k
  -movflags +faststart <clip>
```

- 720 px wide, height to keep aspect (even). Default GOP (250) and default scene-cut behaviour. AAC 96 kbps. faststart.
- Original pads: `c0 = max(0, t0 - clip_pre)`, `c1 = min(dur, t1 + dyn_posts.get(b, clip_post))` (`3039-3040`), where the dynamic post can stretch to 2.0 s when the next play is far enough away (`2835-2839`). Reclip pads: `clip_pads.pre/post` exactly, with `min(pad, 0.3)` on tight edges (`5316-5319`); no dynamic tail. So a reclipped clip can end up to 0.7 s earlier than the original for the same t1.

Reels/stories for comparison: `h264_videotoolbox` at a computed bitrate (about 9 Mbps at 1080p30, `6149-6150`; 10 or 6 Mbps for stories, `6351-6353`) with `libx264 crf 19/21` fallback, `yuv420p`, AAC 128k 48 kHz stereo, faststart. Automatic highlights add a 1 s GOP and forced keyframes every second (`5870-5878`).

---

## 9. RETENTION

`retention_sweep` (`7914-7945`) runs at worker start and every 24 h (`8117-8122`), each tier independently and best-effort:

- Raw (`r2_raw_sweep`, `7675-7746`): every object in `ponglens-raw` whose reference time is older than 30 days is deleted, where the reference time is the earliest `jobs.created_at` with that `input_path`, else the upload ledger row's `created_at`, else `LastModified`. Objects referenced by `matches.raw_path` (library rows, commerce) are skipped regardless of age (`7710-7717`). Freed bytes are negated by key.
- Cut videos (`r2_sweep_prefix(..., "results/", 30, protect_keys=_live_cut_paths(conn))`, `7929-7931`; `7749-7775`): anything under `results/` with `LastModified` older than 30 days, except keys in `_live_cut_paths` (`7847-7860`), which is the set of `matches.cut_path` values ONLY when `app_config.commerce_enabled = 'true'` (`commerce_enabled`, `3524-3529`). With commerce off the protection set is empty and every cut ages out at 30 days; with it on, cuts of live matches persist and only cuts of deleted matches expire.
- Clips and `match.json` under `points/`: never swept ("kept while the account is active", `7922-7925`); removed only by `/api/delete-match`.
- Voice 90 days (`7932-7933`), orphan sketches and entry images 2 days (`7934-7935`), vertical share renders 7 days (`7866-7911`), legacy Supabase uploads 30 days (`7640-7657`), placement retry windows expire first (`7660-7672`).

When the raw is gone, `process_reclip` catches the download error, logs "raw source unavailable" (`5291-5292`), and for every target runs `update points set clip_path = null, edited = false where id = %s and t0 = %s and t1 = %s` (`5301-5308`). The UI then shows "Clip unavailable — the original video has expired, but your timing edits are saved." (`PointDetail.tsx:508-512`).

What breaks for a user editing a 31-day-old match:

- A legacy (non-library) match: the raw is gone. Any Adjust, split, unsplit, merge or insert marks points edited and the next reclip nulls their clips, including the untouched half of a split parent. There is no way back: the guard clears `edited`, and no later job will look at those rows. If `commerce_enabled` is off the cut is also gone at 30 days, so the Modify modal (which plays the cut, `PointDetail.tsx:271-289`) has nothing to play and the ScoreKeeper has no video; `/api/media-url` returns "Video not ready" (`media-url/route.ts:369-379`).
- A library match (commerce): the raw persists while the row exists (`7710-7717`), so reclips keep working past 30 days and the cut is protected; `apply_source_trim` re-applies the claimed window (`5294-5296`).
- Placement retry is separately expired at `placement_retry_expires_at` (`7660-7672`).

---

## 10. WEAKNESSES

1. **Duplicate suppression only while `queued`** (`MatchView.tsx:2158-2168`; `PointExtras.swift:381-392`). The moment the worker flips a job to `processing`, the next edit inserts another job. N edits over a long reclip produce N back-to-back jobs, each re-downloading the whole raw (`5280-5292`). The check-then-insert is also not atomic, so two tabs or a phone and a browser can both insert.

2. **Mid-flight snapshot**. Targets are read once (`5264-5271`); an edit that lands after the read fails the guard (`5338-5345`) and the row stays `edited=true` with the old `clip_path`. That is by design, but it only recovers if the client enqueues again. Combined with (3) or (4) it can sit there indefinitely.

3. **The 4 s web debounce is lost on navigation** (`MatchView.tsx:2176-2182`): a plain `window.setTimeout` with no `beforeunload` flush and no effect cleanup that fires it. Edit, close the tab within 4 s, and no job is ever inserted; the point shows "Updating clip" until another edit on that match. iOS has no debounce but its insert is `try?` (`PointExtras.swift:400-407`), so a failed insert is invisible.

4. **A failed reclip leaves `edited=true` forever**. If ffmpeg or the upload fails on clip k (`check=True`, `5321-5328`), the job fails, retries once after 30 min, then archives; points from k onward keep `edited=true`, the `jobs_notify_failed` bell ignores reclip (`066:56-60`), and the 8 s poll never sees a change. Nothing re-enqueues without a new edit.

5. **Storage leak per reclip**. The previous clip object is never deleted and its bytes never negated (`5331-5345`); each reclip adds a full clip to the user's usage until the match is deleted. Originals cannot be negated individually because they were booked as one prefix row (`4783-4784`).

6. **`cut_t0` drifts after every Adjust**. `cut_t0` anchors the ORIGINAL padded start and is never rewritten (no grant for the client; the worker does not touch it at `5338-5345`), while `t0` moves. Every cut-clock consumer computes `rallyStart = cut_t0 + eff.pre` from the CURRENT `t0` (`playhead.ts:43-49`, `ModifyClip.tsx:63-66,192-198`, `reel/route.ts:415-420`, `SharePointSheet.swift:380-388`), so after a t0 move of delta the ScoreKeeper chip, deleted-span skip, reel segment and share render for that point are off by delta. Split and insert re-anchor via RPC (`023`, `101`); Adjust does not (`modifyOps.ts:166-177`).

7. **Reclip tail differs from the original**. Originals use the dynamic post pad (`3040`, up to 2.0 s); reclips use `clip_pads.post` (`5316`, 1.3 s at normal). The same `t1` yields a clip up to 0.7 s shorter after any edit, and `paddedEnd` on the client assumes the stored pad for both.

8. **No priority and one process**: a two-second share render or a one-clip reclip waits behind a 45-minute processing job (`read_message`, `537-540`; `main`, `8130-8133`).

9. **`jobs` insert policy is `user_id = auth.uid()` and nothing else** (`001:57-60`), `kind` is unconstrained (`001:19`), `input_path` and `options` are free text. From the migrations alone: an authenticated user can insert `kind='deadspace_cut'` with any `input_path` (the worker downloads whatever `r2://` key it is given, `7457-7466`, and creates a match under the caller), `kind='youtube_import'` with `options.url` (bypassing `/api/import-url` limits and, in commerce mode, `claim_processing`), or `kind='reclip'`/`content_check` with another user's `match_id` (reclip fails on the owner check at `5248-5249`; `content_check` reads the target match's owner and can mark it checked or reject it). Not queried live; if a later policy tightened this it is not in `supabase/migrations/`.

10. **Guard equality on `numeric`**: `psycopg2` returns `Decimal` for `t0/t1` and sends them back verbatim, so the guard is exact; but a client that rounds to 2 dp on one surface and not the other (the web rounds, `ModifyClip.tsx:418-424`) would produce a distinct value and fail the guard for an edit the user did not notice making. Low risk, worth knowing.

11. **`edited` rows that are deleted stay `edited=true`** (`5267` excludes `deleted`); harmless today because every reader also filters `deleted`, but an undelete would resurface a stale clip with no job to fix it.

12. **README drift**: `worker/README.md` says the poison guard is 3 attempts; `MAX_READ_CT = 2` (`307`).

---

## Appendix: the RPC bodies referenced

`split_point` (current, `023_split_child_cut_t0.sql:38-95`):

```sql
create or replace function public.split_point(p_id uuid, at_t numeric, child_cut_t0 numeric default null)
returns public.points language plpgsql security definer set search_path = public as $$
declare orig public.points; new_row public.points;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select p.* into orig from public.points p join public.matches m on m.id = p.match_id
   where p.id = p_id and m.user_id = auth.uid() for update of p;
  if orig.id is null then raise exception 'point not found'; end if;
  if orig.deleted then raise exception 'point is deleted'; end if;
  if orig.t0 is null or orig.t1 is null or at_t < orig.t0 + 0.2 or at_t > orig.t1 - 0.2 then
    raise exception 'split time outside the point window'; end if;
  if orig.cut_t0 is null then child_cut_t0 := null;
  elsif child_cut_t0 is not null then child_cut_t0 := greatest(child_cut_t0, 0); end if;
  update public.points set t1 = at_t, edited = true, tight_end = true where id = orig.id;
  insert into public.points (match_id, idx, t0, t1, server, edited, tight_start, tight_end, cut_t0)
  values (orig.match_id, (select max(idx) + 1 from public.points where match_id = orig.match_id),
          at_t, orig.t1, orig.server, true, true, orig.tight_end, child_cut_t0)
  returning * into new_row;
  return new_row;
end; $$;
```

`merge_points` (`027:30-88`): locks the rows, checks one match owned by the caller, then
```sql
select max(t1) into last_t1 from public.points where id = any(p_ids);
update public.points set t1 = last_t1, tight_end = false, edited = true where id = p_ids[1] returning * into survivor;
delete from public.points where id = any(p_ids) and id <> survivor.id;
```

`insert_point` (`101:23-140`): validates the window, locks the neighbours, inserts `(match_id, idx, t0, t1, cut_t0, edited, tight_start, tight_end) = (..., greatest(coalesce(p_cut_t0,0),0), true, prev.id is not null, nxt.id is not null)`, then
```sql
update public.points set t1 = p_t0, edited = true where id = prev.id;   -- if prev.t1 > p_t0
update public.points set t0 = p_t1, edited = true where id = nxt.id;    -- if nxt.t0 < p_t1
update public.points p set server_override = null where p.match_id = v_match and p.id <> v_new.id
   and not p.deleted and p.server_override is not null and (coalesce(p.t0, 9999999), p.idx) > (p_t0, v_new.idx);
```

`unsplit_point` (`026:34-92`): `update points set t1 = parent_t1, tight_end = parent_tight_end, edited = parent_edited where id = par.id; delete from points where id = chi.id;` (trigger forces `edited=true` when t1 changes).

`enqueue_job` (`024:10-31`):
```sql
perform pgmq.send('jobs',
  jsonb_build_object('job_id', new.id, 'user_id', new.user_id, 'kind', new.kind,
                     'input_path', new.input_path, 'options', new.options),
  case when new.kind in ('deadspace_cut', 'youtube_import') then 60 else 0 end);
```

`mark_point_edited` trigger (`007:28-43`): quoted in section 6.

`ledger_on_match_delete` (`010:297-329`): negates all ledger rows carrying `old.id` grouped by `(user_id, kind, r2_key)`, then `_ledger_negate_keys(cut_path + note audio paths)`.
