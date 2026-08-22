# Can the serve be read from where we tell people to stand?

2026-08-21. Adil asked whether the placement ghost's accepted positions
all give us a chance of detecting the serve, suspecting that at the most
zoomed-out end the player might be blocking it. The answer is no on the
blocking, and worse than suspected on the angle.

## The one-paragraph conclusion

Nobody blocks the serve — modelled across every accepted position, the
sight line to the bat clears the server's body everywhere. What breaks
serve detection is foreshortening, and the ghost's corridor walked
straight into it: holding a fixed 2.74 m to the side while stepping back
took the drawn pose from 1.00 foreshortening at the near end to 0.45 at
the far end, and the live check's green light extended to 0.22 — more
end-on than any match in production, including the three Adil has called
unusable. Foreshortening is governed by one number, the angle round from
the end of the table, and holding that angle constant along the corridor
fixes the ghost without taking anything away from the user.

## What the serve detector needs, measured

From `2026-08-19-endon-camera-handover.md`, seven matches with known
detector behaviour. Foreshortening is `points_v2.foreshortening`: the
projected length-to-width ratio, normalised so 1.0 is honest.

| match | foreshortening | serve detector |
| --- | --- | --- |
| chris_rc | 1.39 | ~90% |
| chris_b | 1.00 | ~90% |
| kumar | 0.81 | ~90% |
| ishan_rc | 0.73 | ~90% |
| koko | 0.32 | 6-15% |
| tripp_rc | 0.28 | 6-15% |
| terry | 0.25 | 6-15% |

End-on, the ball travels toward and away from the camera rather than
across it, so it barely moves on screen and the serve motif is
unrecognisable. **The band between 0.32 and 0.73 has never been
measured.** Every threshold below is chosen with that gap in mind.

## Blocking: ruled out

Server 0.6 m behind the end line, contact 0.25 m behind it and 0.25 m
above the surface, body a 0.5 m cylinder. Across the whole accepted
envelope the sight line to the contact point passes 0.13 m to 1.04 m
clear of the body — closest at the far, shallow corner, but never
occluded. The hypothesis was reasonable and it is wrong.

## What we were actually offering

A projection model of the ghost camera, **validated against all 61
hand-marked matches** in `table_calibration_review` (predicted vs
measured foreshortening: median error +0.013, mean absolute error 0.080).

The ghost's corridor, at its old fixed 2.74 m lateral:

| behind | 1.49 | 2.00 | 2.50 | 2.82 | 3.20 | 3.60 | 4.09 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| foreshortening | 1.00 | 0.79 | 0.66 | 0.60 | 0.55 | 0.50 | 0.45 |

The golden pose itself — the mined median of 61 proven-good cameras —
sits at 0.60, below the proven-good floor of 0.73.

The live check's accepted envelope is worse, because it allows lateral
down to 1.2 m independently of distance. Worst accepted pose: **0.22 at
behind 4.09, lateral 1.2.** The gate would have said "That's the angle.
Tap record."

## The governing number is an angle, not a distance

Degrees off the table's long axis, measured at the table's centre:
`atan2(|lateral|, behind + 1.370)`. Against the 61 matches it tracks
foreshortening at **r = 0.893**.

| angle | n | median foreshortening |
| --- | --- | --- |
| 0-25° | 8 | 0.40 |
| 25-32° | 18 | 0.48 |
| 32-38° | 14 | 0.67 |
| 38-45° | 9 | 0.83 |
| 45°+ | 12 | 1.39 |

The 0.73 line is a constant 37.5° at every distance. That is why a
corridor along one axis fails: stepping back at fixed lateral reduces the
angle monotonically.

Corpus distribution: median 0.64, and only **19 of 61 matches reach
0.73**. By venue — PingPod 1.39, Pingpod 0.83, PingPod Dobro 0.65,
(none) 0.64, LYTTC 0.63, Westchester 0.55, Matchpoint 0.54. Westchester's
worst is 0.34 and LYTTC's is 0.32: both venues routinely film at the edge
of the unreadable band.

## What shipped

**The ghost's corridor is an arc at a constant 38°.** `GhostPose.lateral(behind:)`
returns `tan(38°) × (behind + 1.37)`, so foreshortening holds at 0.75
along the whole travel instead of sliding to 0.45. The far end is capped
at 3.20 m back (3.57 m across) rather than 4.09 m, because holding the
angle at 4.09 needs 4.19 m of side room that halls do not reliably have.

**The live check gained an angle cue**, `TableFinderCore.axisDegrees`,
fired below 33°: "Move further round the side of the table". It is
ordered BEFORE the distance cues deliberately — told to step back from a
shallow angle, a user walks further round the end of the table and makes
the angle worse, so the two cues fight and the one that decides whether
the serve can be read has to win.

The old "Move toward the corner" cue is gone. It measured metres where
the thing that matters is an angle, so it passed 1.2 m out at 1.5 m back
(39°, fine) and 1.2 m out at 4 m back (12°, unusable) identically.

## Why 33° and not 37.5°

37.5° is the proven-good line, and a threshold there would have nagged
two of our four venues permanently — Westchester's median camera is 0.55
and LYTTC's is 0.63, and matches at those angles do process. 33°
(foreshortening 0.60, the corpus median) pulls the genuinely unreadable
region out of the green light without scolding matches that come out
fine. It is the conservative first step, not the final answer.

**Raise it when the 0.32-0.73 band has been measured.** That study is
cheap and has not been done: take matches spread across that band, run
the serve detector, and plot hit rate against foreshortening. Four
matches define the good end today and three define the bad end.

## The caution this corpus insists on

Foreshortening does **not** predict placement outcomes here: ready rates
are 8/18 below 0.50, 9/24 between 0.50 and 0.73, 10/19 above 0.73. The
harm being guarded against is specific to the serve detector at the
end-on extreme, and it is documented rather than inferred. Nothing here
justifies blocking a recording, and nothing does — the cue is advice, the
shutter is untouched.

## Reproducing

`worker/mine_record_poses.py` fetches the corrected corners and solves
each camera. Foreshortening from corners is
`(|mean(far) − mean(near)| / |near_left − near_right|) / (2.740/1.525)`,
matching `points_v2.foreshortening`. The projection model is the same
pinhole the ghost draws with, looking at `GhostPose.target`.
