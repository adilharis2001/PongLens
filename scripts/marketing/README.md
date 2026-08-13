# Coach outreach worker

Runs every morning at 7am on the Mac Studio. Finds table tennis coaches on
Instagram, works out where they are and whether they can be paid, and stops.

It does not write messages and it does not send anything. Adil decides who
is worth writing to and presses the button on `/marketing/coach-outreach`
himself.

## What runs

| Script | Does |
| --- | --- |
| `discover.mjs` | Instagram user search through Apify, qualifies coaches, follows bio links for email, WhatsApp and Telegram |
| `enrich.mjs` | Country and coach-or-club, flag emoji first then one model call |
| `outreach-morning.sh` | Runs the two in order, rotates the search terms, writes state |

`voice.ts` lives in `src/lib/marketing/` rather than here, because the page
imports it too and the message templates should exist once. The worker does
not use it.

## Why the terms rotate

Instagram returns roughly the same thirty accounts for a given phrase, so
running "table tennis coach" every morning finds the same people every
morning. Six sets rotate day to day, weighted towards US cities and the
English speaking world since that is where a coach can be paid today. The
index lives in `outreach-state.json` and advances on every real run.

## Installing it

The wrapper app is the only awkward part, and it exists for one reason: a
`/bin/bash` spawned by launchd cannot read `~/Desktop` under macOS TCC, so
the job fails with "Operation not permitted" before it starts. Wrapping it
in an AppleScript app makes the app the responsible process, and everything
it spawns inherits its Full Disk Access.

1. Build the wrapper. Environment has to be set inline; plist variables do
   not survive `do shell script`.

```bash
osacompile -e 'do shell script "export HOME=/Users/adil; export PATH=/Users/adil/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin; export LANG=en_US.UTF-8; /bin/bash /Users/adil/Desktop/Projects/PongLens/scripts/marketing/outreach-morning.sh"' -o ~/Applications/CoachOutreachRunner.app
```

2. Grant it Full Disk Access: System Settings, Privacy & Security, Full
   Disk Access, add `CoachOutreachRunner.app`, toggle on.

3. Install and load the job.

```bash
cp /Users/adil/Desktop/Projects/PongLens/scripts/marketing/com.adil.coach-outreach.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.adil.coach-outreach.plist
```

4. Make sure the Mac is awake for it. launchd will not fire on a sleeping
   machine, and `runs = 0` in `launchctl print` is what that looks like.

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 06:55:00
```

## Checking on it

```bash
launchctl print gui/$(id -u)/com.adil.coach-outreach
```

Look at `runs`, `last exit code` and `state`. Then the log for the day:

```bash
tail -50 /Users/adil/Desktop/Projects/PongLens/scripts/marketing/logs/$(date +%Y-%m-%d).log
```

Every run also writes a row to `outreach_runs` in the database, which is
what the footer of the outreach page reads. A run that died halfway leaves
its row on `running`; the next successful run does not clean that up, so a
stuck row means go and look at the log.

To fire it by hand without waiting for the morning:

```bash
launchctl kickstart gui/$(id -u)/com.adil.coach-outreach
```

## Costs

Apify charges per profile, roughly $0.0026, so a morning of thirty profiles
across five or six terms costs about 30 cents. The free plan gives $5 of
usage a month, which covers a daily run with little room to spare. Widening
the term sets is what pushes it onto a paid plan.

Enrichment adds one model call per new coach, which is cents.

**`--dry-run` costs the same as a real run.** It skips the writes, not the
searches: Apify still has to fetch the profiles for there to be anything to
skip writing. A measured dry run came to $0.3078 and wrote nothing, which
is 6% of the monthly free allowance spent on a test. Use it to check the
plumbing once, not as a habit.

A dry run also leaves enrichment with nothing to do, because the coaches it
would have enriched were never written. So a clean dry run proves discovery
and the wiring, not the enrichment path.

## Things that will bite

- `launchctl load` is legacy but works. If unload fails with "Input/output
  error", use `launchctl bootout gui/$(id -u)/com.adil.coach-outreach`.
- The Serper key is shared with WDIMT, so it runs dry from the other
  project's usage. Discovery does not use it, but enrichment's fallbacks
  might later.
- Two dev servers or a build sharing this checkout's `.next` corrupt each
  other. The worker does not build anything, so it is safe alongside, but do
  not add a build step here without a worktree.
