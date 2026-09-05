# Lesson video worker releases

This is a separate service for imported lesson videos. It never installs,
restarts or imports the match worker. Packaging and installation do not start
processing. The current pilot has no verified Modal login or deployment; do
not describe Mac/Modal parity as complete. Obtain the pending Mac-only pilot
exception before enabling Mac alone, or deploy and verify the pair first.

## Package and verify

Use Python 3.12 from the pilot worktree. Run the existing worker tests before
sealing. The final worker source must be settled before building the release.

```sh
/opt/homebrew/bin/python3.12 -m unittest worker.tests.test_lesson_video worker.tests.test_lesson_release
/opt/homebrew/bin/python3.12 worker/lesson_release/package.py build \
  --source worker --output /tmp/ponglens-lesson-releases
```

Build prints an absolute `<bundle-sha>/payload` path. It copies only lesson
source, cost metering, the shared font and its license, launcher/tooling,
Modal wrapper, and exact dependencies. No secrets, match models or research
checkout paths are included. Missing assets, modified source, undeclared files
and symlinks fail verification. Payload files are made read-only.

There are two identities:
- Full bundle SHA: hashes every payload file, including the launchers and
  dependency lock; it is the release directory name.
- Worker release ID: compatible with the worker's claim RPC. In the sealed
  payload, lesson-video-requirements.txt contains the **full dependency lock**,
  so this ID covers source, meter, font and transitive dependency versions.

Use the **sealed** manifest/launcher worker ID when setting
lesson_video_release.release_id. The mutable checkout's --release-id can be
different because its short requirements file does not contain transitive
pins. Both locations must use the same full bundle SHA, not just agree on the
short worker ID.

```sh
/opt/homebrew/bin/python3.12 worker/lesson_release/package.py verify \
  /absolute/path/to/BUNDLE_SHA/payload
```

To deliberately update dependencies: create a disposable Python 3.12 venv,
install worker/lesson-video-requirements.txt, write pip freeze to
worker/lesson_release/requirements.lock, rerun tests, then build a NEW bundle.
Never pip-install into a released runtime. Versions are pinned across Mac and
Linux; the runtime install records file hashes and checks them on each launch.
Platform wheels differ by design. FFmpeg encodes still require parity fixtures.

## Stage the Mac service without starting it

```sh
/opt/homebrew/bin/python3.12 worker/lesson_release/package.py install \
  /absolute/path/to/BUNDLE_SHA/payload \
  --python /opt/homebrew/bin/python3.12 \
  --ffmpeg /opt/homebrew/bin/ffmpeg --ffprobe /opt/homebrew/bin/ffprobe
```

Default root is `~/Library/Application Support/PongLensLessonVideoWorker`.
An independent venv is built inside releases/BUNDLE_SHA/venv; dependencies
install with --no-deps from the full lock and pass pip check. The installer
pins actual Python, FFmpeg and FFprobe binary hashes, creates runtime/work,
and emits a runtime-config path plus a **disabled plist stored under this
lesson root**. It does not copy into ~/Library/LaunchAgents, bootstrap, change
release database flags, or touch the running match app. A second install into
the same release refuses overwrite. A failed install is left for inspection;
use a fresh staging root or remove that known failed directory explicitly.

An optional `--root` can be used for test staging. Do not point it at another
service's root. The known PongLensWorker match root is refused.

The config is mode 0600 and contains paths/checksums, never credentials.
Runtime logs and work files remain outside the immutable payload. Homebrew
binary upgrades invalidate their recorded hashes; build/install a new runtime
and verify it, rather than changing checksums in place to silence the guard.

Verify without contacting providers, polling or processing:

```sh
/opt/homebrew/bin/python3.12 worker/lesson_release/package.py verify-runtime \
  /absolute/path/to/BUNDLE_SHA.runtime.json
/absolute/path/to/releases/BUNDLE_SHA/venv/bin/python -I -B \
  /absolute/path/to/releases/BUNDLE_SHA/payload/runner.py \
  --config /absolute/path/to/BUNDLE_SHA.runtime.json --check
```

The launcher puts only verified FFmpeg/FFprobe links ahead of system commands
on PATH, uses the sealed font, disables bytecode writes and imports processing
code only after verifying the payload and installed runtime. --check prints
the worker ID and exits before constructing Runtime or making any API call.

## Optional credentials outside the release

The worker already supports environment variables and Mac Keychain fallback.
For launchd without Keychain access, supply `--secrets-file /absolute/private.json`
at install time. Create it privately with mode 0600; it must be owned by the
current user, a regular non-symlink file, and outside the release directory.
Allowed string-valued JSON keys are SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
OPENAI_API_KEY, DEEPGRAM_API_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
R2_SECRET_ACCESS_KEY, and optional LESSON_VIDEO_WORKER_ID. Values are loaded
into the child environment and never printed. PATH/PYTHONPATH or arbitrary
code-loading environment keys are rejected. Do not commit the file or put
secret values in a shell command or transcript.

## Explicit activation, only after authorization

Stage/check first. Then set the lesson release control row to the verified
sealed worker ID and intended enabled/cloud_enabled flags through the reviewed
operational path. The packaging tool does not write that row. Leave
cloud_enabled=false until the identical bundle and parity fixtures are verified
on Modal.

```sh
/opt/homebrew/bin/python3.12 worker/lesson_release/package.py enable \
  /absolute/path/to/BUNDLE_SHA.runtime.json \
  --confirm-release-id lesson-video-EXACT_ID_FROM_CHECK
```

This is the only command that writes
~/Library/LaunchAgents/com.adil.ponglens-lesson-video-worker.plist and enables/
bootstraps it. It refuses if that lesson label is already registered. Do not
run it during packaging validation. Status output must be filtered: full
launchctl print can contain inherited credentials.

To stop only this lesson service, after waiting for a live job to finish:

```sh
launchctl bootout gui/501/com.adil.ponglens-lesson-video-worker
launchctl disable gui/501/com.adil.ponglens-lesson-video-worker
```

Replace 501 only if the actual user ID differs. Updating/rolling back means
stop the lesson service, verify a separately installed known bundle, then run
its explicit enable command. Do not mutate or replace an active payload.
Do not run com.adil.ponglens-worker commands for this feature.

## Modal counterpart, not deployed by this tooling

The optional sealed modal_app.py defines only app `ponglens-lesson-video`,
secret `ponglens-lesson-video-runtime`, no volumes and no match functions.
It uses the same full lock, payload and font, with system FFmpeg on Debian.
A single CPU container has a 40GiB ephemeral disk and polls one claimed lesson
per scheduled invocation. Database cloud_enabled still gates all claims.

After connecting the correct Modal workspace and setting appropriate spending
limits, create the separate runtime secret using the keys listed above. Then,
only with deployment authorization:

```sh
modal deploy --env main /absolute/path/to/BUNDLE_SHA/payload/modal_app.py
modal run --env main /absolute/path/to/BUNDLE_SHA/payload/modal_app.py::verify_release
```

The verify function has no secret and no job claim; it reports both IDs.
No Modal provider command was executed for this implementation. The adapter
has not been remotely built or smoke-tested. Compare the same fixture's
transcription, chapter decisions, source/summary times and both video outputs
on Mac and Modal before enabling cloud claiming. The CPU render is deliberate;
there are no BlurBall or table-checkpoint licensing/model dependencies.
