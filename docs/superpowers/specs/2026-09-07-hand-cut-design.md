
---

## 14. As built, after using it

The design above was written before anyone had marked a real match. Adil
used the first build and three things changed. They are recorded here
because the reasoning above is now wrong in these places.

**Three taps per rally, not two.** The spec argued that the answer tap
should also end the point, on the grounds that two taps beat three. In use
it did not: ending a rally meant crossing the pad to the winner tiles, and
the two actions never became one rhythm. Begin Point and End Point are now
their own pair, side by side and the largest controls on the pad, and the
three answers sit on one row below. The separate "End" control is gone,
since End Point already closes a point without calling it.

**The answer row asks.** When End Point closes a rally the three answers
light up and pulse until one is chosen. The reducer carries an `awaitingId`
for exactly this: after a point ends, who won it is the only thing the pad
wants.

**The session opens on a question.** "Cut only, or cut and score?", in the
scorekeeper's own sheet dress. Cut only drops the answer row, the score and
the server line, because a scoreboard nobody is filling in is furniture.
Then one "Begin Cutting" button starts playback, because a browser only
lets a video play from a real user gesture and the button that says begin
should be the one that does it.

**Two smaller corrections from the same session.** Reopening a draft seeks
to the end of the last rally that was cut, so a refresh does not cost the
place in a forty minute video. And the pad carries the app's own speed
control: the picture gestures work, but the floating card covers part of
the frame, and whichever half it sits on loses its hold gesture.

**The picture stops for the answer.** In scoring mode End Point pauses the
video and it stays paused until the point is called. Watching the next
rally begin while still deciding who won the last one is what made a pass
feel rushed. Only a pause this screen caused is one it undoes, so a player
who paused by hand to look at something does not have the video yanked
back into motion by an answer. Cut-only mode never stops, because it has
nothing to ask.

That change needed one more: pressing Begin Point while the picture is held
cannot start a rally, because the video has not moved since the last one
ended and the new start would fall before that end and be refused. It
carries on instead, leaving the point uncalled and saying so. Without it the
session strands with the picture frozen and no way forward.

**A marked point can be watched back and fixed.** Tapping a chip seeks to
that point's clip start, padded exactly as the worker will cut it, plays,
and stops where the clip stops. A number on a strip tells nobody whether
the cut is any good, and that is the one thing worth checking before
committing eighty of them.

While a marked point is selected the pair changes meaning: Begin and End
say nothing about a rally whose edges are already set, so they become
Adjust and Resume, in the same two boxes so nothing moves under a thumb.
The three answers stay live, because changing a winner is the commonest
correction. Adjust opens a sheet modelled on the scorekeeper's own Modify
(`ModifyClip.tsx`): the same cyan band for what the clip keeps, the same
handle as a line with a ringed knob, and the same rule that the picture
follows the handle so the frame under your finger is the one you are
judging. Its window is fixed when the sheet opens rather than derived from
the draft, or the track rescales under the finger and slides the other
handle. The sheet also carries "Mark it again", which drops the point and
puts the playhead three seconds before it began, never back inside the
previous rally.

**Speed is a rail, not a menu.** A menu costs two deliberate acts, and
during a pass the speed is something you lean on and let go of. The rail
(`SpeedRail.tsx`) is pressed anywhere to jump there and followed with the
finger to keep changing, with the app's own six rates as evenly spaced
detents and the knob carrying the value so no separate readout is needed.
It is the same gesture with a mouse, a finger or a stylus, because it is
all one pointer.

That change required a small addition to the shared player: `ClipPlayer`
owns the playback rate and re-applies its own on every load, so a host
writing `playbackRate` on the element had it silently reverted on the next
render. Its `speedRef` now exposes `set` alongside `hold` and `release`,
and the rail drives that, which also keeps the player's own speed pill in
step.

**Beginning too early has its own way out.** While a rally is open the left
button reads Reset, not Begin Point. It throws the open rally away and
rewinds to where the last finished point ended, then plays, so the run-up
to the serve comes round again. Pressing Begin a beat early happens
constantly, and until this the only way to fix it was to end a rally that
had never started. Undo brings the open rally back.

**The marking session holds the video URL it opened with.** `page.tsx`
re-signs the raw object on every server render, so any `router.refresh()`
during a session (the job poll does one, saving match details does one)
hands the player a different-looking `src` for the same file. ClipPlayer
reloads on a src change, and the video jumps back to zero mid-session.
Measured: a src re-signed every two seconds produced four reloads in seven
and pinned the picture at zero; frozen, zero reloads. A presigned link is
good for six hours, so holding the one the session opened with is both safe
and the fix. The page also stops mounting its own player while the marker
is open, rather than streaming the same file into two elements at once.

The data model, the worker job and the cut-clock arithmetic are unchanged.
