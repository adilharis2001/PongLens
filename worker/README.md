# PongLens worker — Mac Studio setup

The worker is a pull-based daemon: it reads jobs from the `pgmq` queue in
Supabase over a direct Postgres connection, downloads the uploaded video,
runs the TTVid dead-space pipeline, and uploads the trimmed result. Nothing
connects *into* the Mac — it only pulls.

## 1. Install dependencies

```bash
pip3 install psycopg2-binary requests
```

The video pipeline itself uses the existing TTVid setup — nothing new to
install as long as these exist:

- `/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python`
- `/Users/adil/Desktop/Projects/TTVid/vendor/blurball_infer.py`
- `/Users/adil/Desktop/Projects/TTVid/pipeline/cut_deadspace.py`
- `ffmpeg` / `ffprobe` on PATH (cut_deadspace shells out to them)

## 2. Store secrets in the macOS Keychain

Three items, all under account `openclaw`:

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

## How failure handling works

- Each queue message becomes invisible for 30 minutes when read
  (`vt=1800`). If the worker crashes mid-job, the message reappears and is
  retried.
- After 3 failed attempts the message is archived (poison guard) and the
  job row stays `failed` with the error message, visible to the user.
- The worker also deletes original uploads older than 30 days once a day
  (this backs the Privacy Policy's retention promise). Results are kept.
