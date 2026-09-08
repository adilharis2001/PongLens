
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

The data model, the worker job and the cut-clock arithmetic are unchanged.
