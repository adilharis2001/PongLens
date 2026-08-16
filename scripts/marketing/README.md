# Coach outreach worker

Runs Monday, Wednesday and Friday at 7:10am on the Mac Studio. Finds table
tennis coaches on Instagram, works out where they are and whether they can
be paid, and stops.

It does not write messages and it does not send anything. Adil decides who
is worth writing to and presses the button on `/marketing/coach-outreach`
himself.

## What runs

| Script | Does |
| --- | --- |
| `discover.mjs` | Instagram user search through Apify, qualifies coaches, follows bio links for email, WhatsApp and Telegram |
| `enrich.mjs` | Country and coach-or-club, flag emoji first then one model call |
| `notify.mjs` | Mails the digest: who is new, where the list stands |
| `outreach-morning.sh` | Runs the three in order, rotates the search terms, writes state |

## The digest

Every run mails `app_config.digest_recipient`, whether it succeeded or not,
so a morning with no mail means the machine was off rather than the search
breaking quietly. New coaches sort payable-first, because a dozen finds in
Egypt is a quieter morning than two in Ohio however it sorts.

New is counted by `created_at`, not by discovery's `added`. Those are
different numbers and the difference is the point: a run that sees a coach
for the second time refreshes their row without adding anyone.

The Resend key is `ponglens-resend-key` in the Keychain, **not**
`resend-api-key`. That one is WDIMT's, and its Resend account has never
verified ponglens.com, so it fails at send time with a 403 about the domain
rather than anything that looks like a wrong key.

## What discovery may overwrite

Instagram is authoritative for bio, name, follower count and avatar, so a
second sighting writes those over. It is not authoritative for country:
discovery only reads the free signal, a flag emoji or a `.de`, and that is
null for most profiles. Enrichment's answer outranks it, so discovery fills
a blank country and never replaces one.

This was a real loss, not a hypothetical. The upsert wrote every column it
was given, so the first scheduled run overwrote 48 resolved countries with
null, and because `enriched_at` survived, enrichment never came back for
them. Anything enrichment or Adil owns — `stage`, `notes`, `personal_note`,
`entity_type` — must stay out of discovery's payload for the same reason.

`voice.ts` lives in `src/lib/marketing/` rather than here, because the page
imports it too and the message templates should exist once. The worker does
not use it.

## Why the terms rotate

Instagram returns roughly the same thirty accounts for a given phrase, so
running "table tennis coach" every morning finds the same people every
morning. Six sets rotate run to run, weighted towards US cities and the
English speaking world since that is where a coach can be paid today. The
index lives in `outreach-state.json` and advances on every real run.

Three runs a week rather than seven for the same reason. A day is not long
enough for Instagram's results to change, so the seventh run mostly re-reads
people already on the list, and it costs the same as the first.

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

There is no wake step. launchd will not fire on a sleeping machine, and
`runs = 0` in `launchctl print` is what that looks like, but this Mac Studio
has `sleep 0` in `pmset -g` and holds it, which is also why the 7am WDIMT
job works. `sudo pmset repeat wakeorpoweron MTWRFSU 06:55:00` is the fix if
that ever changes.

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
usage a month. Three runs a week is around $4 and fits; seven is around $9
and does not. That is what sets the schedule. Widening the term sets is the
other thing that pushes it onto a paid plan.

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
