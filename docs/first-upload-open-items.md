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

### 2. Which of the six deferred items ride next

All re-confirmed present on production. My order would be the camera guide
first, on its own, then the rest as one batch.

| | The problem, plainly | What I would do |
| --- | --- | --- |
| UP-15 | The "How to record" link is tiny grey text tucked in a corner, and it only exists on the Upload page — which you reach *after* you have already filmed. Where you put the camera is the single biggest thing that decides whether the software finds the points at all. A first-timer will never see it. | Make it a proper row inside the upload card that you cannot miss, and put it on the home screen too, so it is there *before* someone goes to the club. Show it once, automatically, to an account that has never uploaded. **The one I would do first.** |
| UP-16 | On a phone, while you are on the Upload page, the bottom bar highlights **Matches** — so the app is telling you that you are somewhere you are not. There is also no back button on that page. | Highlight nothing while uploading, and add a back button. We already have the back-button component; it just is not used here. |
| UP-17 | Signing up asks eight questions — your name, which hand, which grip, two rubber types, playing style — before you can do anything at all. None of them matter for uploading a video. And on the last screen, **Done** and **Skip** do exactly the same thing, because nothing is required. | Ask your name, then let them in. Move the rest into the "First steps" checklist as one item they can do whenever, since all those fields already live in Account. |
| UP-18 | Four things on the page are too small to tap reliably. A fingertip needs about 44 px; these are 16 to 26 px tall. It is the "How to record" link, the "Report an issue" link, the YouTube **Paste** button, and the on/off switches. | Make them bigger. The switches matter least, because their whole row already responds to a tap — the two text links are the real problem. |
| UP-19 | For someone using a screen reader — blind or low vision — the file picker button has no name read out, and when the upload finishes nothing is announced. So they press something unnamed and then have no idea whether it worked. | Give the button a name that is read aloud, and announce the result when it lands. The progress bar is already done. |
| UP-20 | Two sentences use a long dash (—), which your own writing rules say not to use. Both are on screens a brand-new account sees. | Rewrite them. `HomeOverview.tsx:398` ("add notes — for yourself or a coach") and `CameraGuide.tsx:129` ("the whole table in frame — the ball lands…"). |

---

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

**Four test accounts hold demo uploads in production.** 27 matches, roughly
51 MB between them, nothing in flight. Clear whenever you like:

- `firsttime-audit@example.com`
- `firsttime-audit2@example.com`
- `prod-e2e-check@example.com`
- `round2-check@example.com`

**Another session's work is uncommitted in your tree.** `Player.tsx` carries
comment rewording from the concurrent Claude session — theirs, untouched,
exactly as they left it. Their committed work is all in `research/recall` plus
the D and M keyboard shortcuts.

That session also ran a `git reset` mid-change and discarded every uncommitted
round-two edit I had made. Nothing was lost permanently, but it cost a pass. The
note in CLAUDE.md about the shared index is the rule this was written for:
commit early with an explicit pathspec when two sessions are live.

**The migration table lags the migration files.** `schema_migrations` stops at
110; 111 (the other session's), 112 and 113 were all applied as raw SQL, so the
numbered files are the record. 112 and 113 are both written to be re-runnable.

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
