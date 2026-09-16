# The cloud twin: the sealed match worker on Modal

The Mac Studio runs match processing from a sealed release
(`worker/match_release`). The cloud twin runs **the same sealed release** on
a rented NVIDIA T4, started only when the switch on `/admin/processing` says
so. Nothing about the pipeline is different: same worker source, same models,
same settings, same queue, same storage. What differs is the machine.

| Piece | Where | What it does |
| --- | --- | --- |
| `cloud_build.py` | image build | Writes the Linux twin of a sealed Mac release: same payload files, Linux environments anchored by hash, one shared `pipeline_id`. |
| `modal_app.py` | Modal | The image, the one-minute dispatcher, the T4 worker container, the probe, the register step, the shadow replay. |
| `supervisor.py` | inside the container | Starts the sealed worker's main and fast lanes exactly as launchd does on the Mac, keeps the cloud's claim on a running job alive, and stops when the policy says so. |
| `shadow.py` | inside the container or on the Mac | Replays one processed upload through the pipeline without publishing, for parity checks. |
| `requirements-*-linux.txt` | image build | The four Python environments, at the versions the Mac release records. |
| `public.cloud_worker_decision()` | database | The one question: should a cloud worker be running right now, and why. |

## One release, two identities

- `release_id` is what `match_release` verifies: the sha256 of a manifest
  that includes the runtime anchors. It is different on the Mac and on Linux
  by construction.
- `pipeline_id` is the sha256 over what decides what a match becomes: every
  payload file except the three media launchers in `bin/` and the BlurBall
  wrapper, plus the sealed behavior settings and the body model. It is the
  same on both machines for one release. `cloud_build.pipeline_id(manifest)`
  computes it for either manifest.
- The Linux manifest also records `mac_release_id`, the Mac release it was
  built from. The dispatcher compares that with the Mac's own pulse
  (`worker_pulse.code_version`) and refuses to start on a mismatch.

The one reviewed per-platform adapter is the BlurBall wrapper's device line:
on Linux it picks CUDA when it is there; on the Mac the same lines still pick
MPS. `cloud_build.BLURBALL_DEVICE_ADAPTER` must match the wrapper exactly once
or the build refuses, so a change to the wrapper is noticed here.

## Packaging a new release for the cloud (for whoever packages the Mac release)

The cloud is built **from the staged Mac release directory**, after the Mac
package has been built, verified and staged, and before or after it is
activated on the Mac. Nothing here rebuilds the payload.

1. Build, verify and stage the Mac release as usual with
   `python3 -m worker.match_release build|verify|stage`. Note the 64-character
   release ID; call it `RID`.
2. From a checkout that contains this directory (`worker/cloud_release`), deploy
   the cloud twin from that staged directory:

   ```sh
   cd worker/cloud_release
   export MODAL_PROFILE=adilharis2001
   export PONGLENS_CLOUD_SOURCE_RELEASE="/Users/adil/Library/Application Support/PongLens/match-releases/$RID"
   "/Users/adil/Library/Application Support/PongLens/tools/modal-cli/bin/modal" run modal_app.py
   ```

   `modal run` builds the image (four environments, then the Linux twin) and
   runs `probe`, which must report the release verified, CUDA visible, the
   media tools from the 8.1 branch, and BlurBall finishing on the GPU. The
   first build takes about ten minutes; later builds reuse the environments
   unless a requirements file changed.
3. Replay two or three recently processed uploads and compare them with what
   the Mac produced (see *Parity* below). Do not deploy a twin whose replays
   disagree with the Mac beyond the tolerances recorded there.
4. Deploy and register:

   ```sh
   "/Users/adil/Library/Application Support/PongLens/tools/modal-cli/bin/modal" deploy modal_app.py
   "/Users/adil/Library/Application Support/PongLens/tools/modal-cli/bin/modal" run modal_app.py --command register
   ```

   `register` writes the cloud's `release_id`, `pipeline_id` and
   `mac_release_id` to `processing_control`. From that moment the dispatcher
   will only start a cloud worker while the Mac's pulse reports release `RID`.
5. Activate `RID` on the Mac (the usual launcher switch). Until the Mac reports
   the new release, the cloud reports `release_mismatch` and stays off, which
   is the intended order: the cloud must never run a release the Mac has not
   accepted.

A rollback on the Mac to an earlier release needs the matching cloud deploy
too, or the cloud simply stays off with `release_mismatch`. Nothing breaks;
the backup is just unavailable until both agree.

### What must never change silently

- The four `requirements-*-linux.txt` lists mirror the package identities in
  the Mac manifest (`manifest.json` → `runtime.<name>.identity.packages`). When
  the Mac's environments change, change these to the same versions.
- The Linux FFmpeg comes from the publisher's rolling 8.1-branch asset. The
  binary that arrives is sealed by hash in the Linux manifest, so a rebuild
  that fetches a newer build produces a new `release_id`; that is expected,
  and `pipeline_id` is unaffected.
- Secrets live in the Modal secret `ponglens-match-worker-runtime` (database
  URL, Supabase URL and service role, R2 keys, OpenAI key, Resend key), created
  from the Keychain on the Mac. Rotate with `modal secret create --force`.

## The switch and the policy

`/admin/processing` → Cloud → Off / Standby / Run once, backed by
`set_cloud_worker_mode()` and `processing_control.cloud_mode`:

- **Off** (`disabled`): nothing starts in the cloud.
- **Standby** (`automatic`): the dispatcher starts one container when the
  Mac's main and fast lanes have been silent for `mac_stale_s` (15 minutes)
  and something has waited `oldest_wait_s` (30 minutes), or when a job the
  Mac was running has stood still with nothing pulsing behind it. The
  container stops after its current job once the Mac reports again, after ten
  idle minutes, or at the five-and-a-half-hour session limit.
- **Run once** (`manual`): start one container now whatever the Mac is doing;
  the switch returns to Off when that session ends.

`cloud_worker_decision()` writes its answer into `processing_control` every
minute (`cloud_decision`, `latest_dispatch_reason`), and the page reads it
back in words.

## Inside the container

`supervisor.run()` calls the sealed `prepare_run` and starts each lane as
launchd does, with three things set from outside the sealed source, all
module globals the worker reads at call time: the pulse identity
(`modal:main`, `modal:fast`, host `modal`), the code version shown on the page
(`release <mac id> cloud <linux id>`), and the housekeeping switched off
(retention sweep, digests, cost monitor stay on the Mac). A `security` shim on
`PATH` exits non-zero so any Keychain lookup the worker attempts resolves to
"not found", as it does when an environment variable is set.

While a cloud lane reports a job, the supervisor pushes that job's queue
message visibility out by thirty minutes every minute, so a returning Mac
cannot pick up a job the cloud is still on. (The Mac worker does not yet do
the same for its own jobs; the next sealed release should, so that the
backlog rule can be switched on. See "For the next release" below.)

## Parity

`shadow_run` replays one processed upload through the pipeline inside the
container and writes `match.json`, `calibration.json`, `ball_crop.json`,
`blurball.jsonl`, `players.json` and a `summary.json` with stage timings to
`r2://ponglens-media/parity/<job id>/<label>/`. It reads the job row and the
settings the way `process_job` does, calls the same functions in the same
order, and writes nothing to the job, the match or the points.

```sh
"/Users/adil/Library/Application Support/PongLens/tools/modal-cli/bin/modal" run modal_app.py --command shadow --job-id <uuid>
```

`compare_parity.py` (on the Mac) downloads the Mac's published `match.json`
and the cloud replay and reports point count, point boundaries, cut segments,
calibration source and corners, placement status and the detector note.
Encoded video bytes are never compared; decisions and timings are.

## For the next release (small worker changes, not yet shipped)

Three lines the sealed worker should grow so the launcher patches above
become plain configuration; none changes behavior on the Mac:

1. `WORKER_HOST = os.environ.get("PONGLENS_WORKER_HOST", "mac")` and
   `WORKER_ID = f"{WORKER_HOST}:{LANE}"`.
2. `housekeeping = LANE == "main" and os.environ.get("PONGLENS_HOUSEKEEPING", "1") != "0"`.
3. In the pulse thread, when a job is held: extend its queue message's
   visibility (`pgmq.set_vt`) so a second worker can never see it while this
   one is alive. This is what lets Standby's backlog rule and an always-on
   parallel mode run safely.

## Two things the image filesystem does that the Mac never does

Both cost a build on 2026-09-16 and both are handled in code; this is why.

- **Permissions and bytecode.** Modal's upload keeps every byte of the
  sealed release and drops its permission bits, and importing the sealed
  packaging module during the build writes a bytecode cache beside it. The
  strict payload check refuses both, correctly. `cloud_build` restores the
  modes the manifest records and scrubs `__pycache__` before comparing, so
  a changed byte still fails and a changed mode does not.
- **Unstable file identity.** The sealed verifier compares each file's
  device and inode numbers between checks; the image filesystem does not
  keep those stable, and a freshly written file reports its size and
  timestamp lazily for a moment. Left alone this stops the worker from ever
  claiming a job ("Release changed during verification"). `stable_release`
  narrows the metadata prefilter to size and mtime, `shim/sitecustomize.py`
  applies it first on `PYTHONPATH` in every process the release starts, and
  the build waits for two consecutive walks to agree before verifying. The
  content hashes, the inventory, the runtime anchors and the identity check
  are untouched.
