# First upload — what is left

Working notes from the audit of 16 Aug 2026 and the two rounds of fixes that
followed. Everything not listed here shipped and was verified on production.

Shareable version of this, with the evidence attached:
https://claude.ai/code/artifact/806502e9-0171-4109-af9c-721a67643cbd

---

## Shipped

**Round one** — commit `83278100`, migration 112, worker restarted on the same
commit. Sixteen findings: the metadata form outliving the upload, the processing
toggle and its price moving above the drop zone, undo-while-queued, the 10-vs-11
GB disagreement, duplicate library cards, match titles, editable details on both
match views, error buttons that match the error, the daily cap, the 45-minute
limit, mobile upload safety, progress in bytes, the side picker's decode
timeout, the resume card, and the four separate causes of the side question that
would not stop asking.

**Round two** — `4e646520`, `dcdccc9b`, `8613cb35`, migration 113. Seven: the
undo joining the action row, the unprocessed video getting a real player, Home
contradicting itself, the watch-or-score chooser, autoplay on first open, titles
from the file's real capture time, and the floating button covering content.

**Round three** — `a8dce9b1`, `569889fd`, migration 115. The camera guide as a
permanent row on the upload card and the empty dashboard, the mobile nav no
longer claiming /upload is Matches, onboarding cut to two screens with a new
player-level field, the screen-reader label and announcement, the two long
dashes, and the watch-or-score sheet redesigned as a real bottom sheet.

**Round five** — nothing spends minutes without a press. The upload landing
used to be the consent, which is a race nobody can win: mid-drag in the
trimmer meant a charge, a job and the untrimmed video, and the card tore the
trimmer down in the same instant. The toggle now decides what the button
promises (**Process video** / **Save video in library**) and pressing it is
what makes the promise, given at 2% and walked away from or held back until
the trim is right. The settings lock on the press, with "Not yet" as the way
back. Every alternative kept the automatic start and needed a timer, and a
timer is only a longer race.

**Round four** — the trimmer, which round three specced and then did not build.
"Trim it first" is now the third row of the processing block in the upload card,
collapsed by default, opening onto the picked file with two handles against it;
the minute quote above it moves as they move, and the window rides into
`claim_processing` as `trim_start_s` / `trim_end_s`. On the match page the same
control moved out from under the details form to sit directly below the player,
because stamping a start means watching for the moment to stamp.

---

## Needs you

### 1. Double-tap ±10s, on a real phone

The only thing from round two I could not prove. Open any unprocessed upload and
double-tap the right half of the picture: it should jump ten seconds forward and
flash `+10s`. Left half goes back.

Everything else about that player is confirmed on production — it renders,
starts paused, has the zoom, speed and mute controls, shows no native chrome.
The gesture itself resisted testing: synthetic pointer events never reached the
handler, and the browser pane refused trusted double-clicks for the whole
session.

Single-tap play/pause is unchanged by construction — a lone tap always falls to
the same `toggle()` it always did, because the timestamp starts at 0 and resets
to 0 after every double-tap. So the risk is confined to the new gesture.

If it does nothing, say so and I will drive it from a real device harness.

### 2. Nothing. The deferred six are done or dropped

Shipped 16 Aug in `a8dce9b1` and `569889fd`, verified on production:

- **UP-15** — "Where to put the camera" is a labelled row with an icon at the
  bottom of the upload card and on the empty dashboard. Permanent, not
  dismissible.
- **UP-16** — the mobile bar no longer lights Matches on /upload, and the page
  has a back control.
- **UP-17** — onboarding is two screens and four questions. Handedness, grip and
  the new **level** field stay in the flow; rubbers and playing style moved to
  Account. The duplicate Done / Skip pair is one button that reads "Skip for
  now" until something is chosen.
- **UP-19** — the file picker is named and a live region announces the upload's
  outcome.
- **UP-20** — both long dashes rewritten.
- **UP-18** — dropped at your call. The small tap targets stay.

Also shipped: the watch-or-score sheet redesign, and the floating Upload button
now stands down on the empty dashboard where the hero already carries one.

**One label still open.** The level options are Beginner / Intermediate /
Advanced / **Advanced pro** / National. "Advanced pro" is your phrase — say if
you would rather it read "Semi-pro" and it is a one-line change.


## Verification gaps

Not defects. Limits on what was actually proven, recorded so nobody later
assumes otherwise.

**The 45-minute rejection is verified locally, not on production.** It needs a
video over 45 minutes reachable from the page's own origin and no such file
exists on ponglens.com. Locally a real 46-minute file was refused before a byte
moved, with the right message. The duration probe around it demonstrably works
in production — it quoted 3 minutes and 1 minute correctly on real uploads — so
the risk is low. Uploading one long clip by hand from a phone closes it.

**The undo has a sub-second losing window.** If Undo is pressed in the instant
between the worker's claim committing and the RPC taking its lock, the RPC
refuses and the user sees "Too late to undo. This one has started processing."
That is the correct outcome — the compute has genuinely started — but it is
reachable, and that sentence is what they get.

---

## Housekeeping

**Seven test accounts hold demo uploads in production.** Roughly 51 MB between
them, nothing in flight. Clear whenever you like:

- `firsttime-audit@example.com`
- `firsttime-audit2@example.com`
- `prod-e2e-check@example.com`
- `round2-check@example.com`
- `round3-check@example.com`
- `round3-prod@example.com`
- `round3-prod2@example.com`

**Another session's work is uncommitted in your tree.** `Player.tsx` carries
comment rewording from the concurrent Claude session — theirs, untouched,
exactly as they left it. Their committed work is all in `research/recall` plus
the D and M keyboard shortcuts.

That session also ran a `git reset` mid-change and discarded every uncommitted
round-two edit I had made. Nothing was lost permanently, but it cost a pass. The
note in CLAUDE.md about the shared index is the rule this was written for:
commit early with an explicit pathspec when two sessions are live.

**The migration table lags the migration files.** `schema_migrations` stops at
110; 111 and 114 (another session's), plus 112, 113 and 115, were all applied as
raw SQL, so the numbered files are the record. 112, 113 and 115 are written to
be re-runnable.

**Migration 113 carries a trap worth remembering.** Adding a defaulted argument
*overloads* a function rather than replacing it — and with the tenth optional,
both candidates matched a nine-argument call, so PostgREST answers "function is
not unique" and every upload fails at completion. The old signature is dropped
in the same file and the grants reapplied by hand, because a freshly created
function is `EXECUTE`-to-`PUBLIC` and would otherwise have handed `anon` a
`SECURITY DEFINER` writer.

**The browser pane is signed into a test account,** not yours. Local only.

---

## Settled, not to reopen

- **Undo rather than a countdown or a forced submit.** The pre-commit toggle
  above the drop zone is the consent; the undo is the escape hatch. A countdown
  makes the calm case anxious and still spends the minutes if the tab closes; a
  forced submit strands the phone user who put the device down during a
  ten-minute upload.
- **The undo button keeps its long label,** "Undo, don't process yet".
- **The watch-or-score sheet remembers nothing** and has no "don't ask again".
  It only appears while something is unscored, so it retires itself.
- **Autoplay is suppressed on first open only.** Clicking a point still plays
  it; killing autoplay entirely would make clicking through 59 points a
  two-tap-per-point job.
- **The daily upload cap is gone in commerce mode.** Minutes and storage meter
  what it was guarding, and it only ever walled off the player who filmed a
  tournament.
- **The limit is 45 minutes, with 6 GB as a backstop** for files whose duration
  will not parse. Footage in this library runs 2 to 15.3 Mbps, so no single byte
  cap can express the rule.
- **The row is the truth, not the pgmq message.** Anything that cancels a job
  must be enforced at worker pickup, in one atomic statement. Found the hard way:
  the first real undo refunded the minutes and processed the video anyway.
