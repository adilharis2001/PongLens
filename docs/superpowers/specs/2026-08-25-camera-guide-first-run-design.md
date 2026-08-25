# Showing "Where to place the camera" to a first-run account

Where the camera goes decides whether the pipeline finds any points at
all, and until now the sheet that explains it only ever opened when
somebody went looking for it. The record path — the one moment the advice
can still change the footage — never showed it at all.

So it now opens on its own, twice, and then never again.

## The rule

Auto-open the sheet when all three hold:

1. this account has been auto-shown it fewer than **2** times;
2. it has not already been auto-shown **in this app launch (iOS) or this
   browser session (web)**;
3. the account is not being back-filled (see *Existing accounts*).

Each clause is load-bearing:

- **Two, shared across every door.** Not two per door — record, practice
  and upload would be six. It is one sheet with one set of words, so it
  is one budget.
- **One per launch.** Without it, tapping Record and then Upload in the
  same five minutes spends the whole budget two minutes apart, and the
  second showing teaches nothing. Spacing them over two occasions is what
  makes them land. It also means a page refresh on `/upload` cannot burn
  the budget, without a single line written for that case.
- **Manual opens never count.** The "How to record" trigger stays on every
  screen it is on today, forever, and spends nothing. The two automatic
  showings are worth saving for the moment somebody is standing at a table
  about to film; a curious tap on the dashboard three weeks earlier is not
  that moment.

Dismissing the sheet — the button, the drag, the backdrop, Escape — always
continues to wherever the tap was going. A tap that opens a sheet and then
leaves you where you started reads as a broken button, which is the
easiest possible way to spoil a first run.

## Where the count lives

Two copies, and the higher one wins.

| Copy | iOS | Web | Answers |
| --- | --- | --- | --- |
| account | `user_metadata.camera_guide_seen` | same | "twice per person, not per device" |
| device | `UserDefaults` `pl-camera-guide-seen:<uid>` | `localStorage` same key | "twice even when the network is not there" |

The account copy is what stops the sheet appearing twice on the phone and
twice again on the laptop. It rides in the same drawer as
`first_steps_dismissed` and `tutorial_started`, so there is no new table
and no migration.

The device copy matters more than it looks. The likeliest place on earth
to be opening the recorder is a sports hall with bad wifi. If the write to
Supabase fails there, the account counter never moves and the sheet comes
back a third and a fourth time — precisely the annoyance being removed. A
local write cannot fail, so the cap holds on the device in your hand
whatever the network is doing.

Reading `max(local, account)` makes both true at once. Both are keyed by
user id, because one simulator and one browser get shared between
accounts.

## The doors

| Surface | Door | Auto-opens |
| --- | --- | --- |
| iOS | New match → Record a match | yes |
| iOS | New match → Record a practice session | yes |
| iOS | New match → Upload a match | yes |
| Web | `/upload`, desktop and mobile | yes |
| iOS | Home empty state, "How to record" | no, manual |
| iOS | Upload header, "How to record" | no, manual |
| Web | `/upload` header, "How to record" | no, manual |
| Web | dashboard empty-state row | no, manual |

The dashboard is not a door into recording or uploading; it is the home
screen. Raising a modal over it the moment somebody signs in is the tour
we decided not to build.

## Existing accounts

Nobody has a counter on the day this ships, so without a back-fill every
account in TestFlight gets interrupted twice, including accounts with
forty matches that plainly know where the camera goes.

An account whose counter is **absent** and which already has **at least one
match** is seeded straight to 2. Absent, not zero: a genuinely new account
that has just recorded its first match sits at 1 and must still get its
second showing, so "has a match" can only ever be read once, before the
counter exists.

Seeded on library load (iOS) and on the `/upload` server render (web), not
at the moment of decision — the library may not have finished loading when
the chooser closes, and guessing there would show the sheet to exactly the
people it is meant to skip.

## Traps

Found by reading the code, in the order they bite.

- **The recorder rotates the phone before it appears.**
  `MainTabView`'s chooser calls `pinLandscape()` and then presents. The
  sheet is a tall portrait form; opened after the rotation it is sideways.
  So the guide opens while the phone is still upright, and only when it
  closes does the rotation happen. Order: chooser → guide → rotate →
  camera.
- **A sheet cannot be raised from a sheet that is still closing.** SwiftUI
  drops the loser of that race silently — you tap Record and nothing
  happens. The chooser already hands its answer over in `onDismiss` for
  this reason; the guide joins the same chain and hands over in its own
  `onDismiss`.
- **The web page must know the count before it paints.** `/upload` is
  server-rendered, so the counter and the match count come down as props.
  Deciding client-side after mount gives a flash of page followed by a
  sheet dropping in.
- **One line of the sheet is wrong on the record path.** It says "Filming
  on this phone? Record a match and the camera screen draws the table
  where it should sit" — read one tap away from that camera screen, it is
  nonsense. The sheet takes a `context` and swaps that line. One sheet,
  one parameter; not a second sheet.

## The button

"Got it" is currently the last row of a scrolling list on both platforms.
On a phone you scroll past a diagram, four rules, a landscape note, three
reference photographs and a viewfinder note before the way out comes into
view. That is tolerable when you asked for the sheet. When it opens by
itself the exit has to be in the first frame, or it reads as a trap.

Both platforms pin it: a bottom bar on iOS (`safeAreaInset`), a sticky
footer on web, with the header pinned too so the close control never
scrolls away either. Same pill, same word.

## Testing

**The rule, twice, against one table.** `shouldAutoShow` is a pure
function in `src/lib/cameraGuideGate.ts` and in `CameraGuideGate.swift`,
checked against an identical list of cases. This project has shipped one
rule written twice and wrong the same way in both; the table is what stops
that happening again.

**iOS, a genuinely new account.** Delete the app, mint a magic link for a
throwaway address, then in one run: Record a match → guide (1st) → land in
the camera, landscape, ghost drawn. Back out, Record a practice session →
no guide, same launch. Relaunch, Upload → guide (2nd) → photo picker
opens. Relaunch, all three doors → nothing. Manual trigger → still opens.
Then the same walk with upload first, because only one of the two paths
rotates the screen.

**Offline.** Network off after the first showing, take the second,
network back, relaunch. The sheet must not return. This is the case that
will actually happen to people, and the happy path never touches it.

**Cross-device.** Two showings on iOS, then `/upload` on web with the same
account: nothing. The only check that proves the account counter is doing
its job rather than the local one covering for it.

**Web at both sizes.** 393×660 for mobile — real height, browser chrome
subtracted — and desktop. No flash before the sheet; Escape, backdrop and
Got it all behave alike; refresh does not re-show.

**The flows themselves, end to end.** The guide now stands in front of
four things that already work, so each is run to its finish: a recording
that starts and stops, an upload that completes, an upload already in
flight when the screen opens, and the practice variant. Not just the
guide moment.
