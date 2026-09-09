"""Drop the detections that are not serves, by what follows them.

Adil's rule, and it is his because the two counters behave nothing alike.

A serve is followed by a rally. A TOSS -- the near player throwing the ball
across so the far player can serve -- is followed by nothing: the ball is
caught and held. Both look identical at the moment they happen. The toss
arrives onto the table from off it and bounces on the far half, which is
exactly the shape a serve's first bounce has, so the serve rule takes it,
opens a card four seconds early, and then skips the real serve as
mid-rally. That is what happened to card 3.

WHAT TO COUNT. His first instinct was net crossings. Measured, that
separates nothing: between every consecutive pair of detections in the
0:36-0:49 stretch the crossing detector reports exactly 1, for the toss and
for the real serves alike. It goes quiet during rallies, which is the same
weakness that let a mid-rally detection through in serve_v2rule's
`quiet_bounces` note.

TABLE BOUNCES separate them cleanly:

    35.90  the toss                0 bounces before the next detection
    40.43  the real serve          5
    43.10  a between-points bounce 0
    46.23  the next real serve     1
    48.90  mid-rally               4

So: if another detection follows within `gap` seconds and the ball never
bounced on the table in between, the earlier one did not open a point.
Keep the later one -- it is the serve.

Removes 10 of 161 detections on this match. The alternative tried first --
"the ball must reach the other half within a second" -- removes 63 and
costs 8 points their card entirely. Same job, a fraction of the damage.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import points_v2 as V2                                       # noqa: E402
from points_v2 import bounces, project                       # noqa: E402

PAD = 0.15
# Set per run by serve_v3.configure(), like the other ported modules.
FPS = 30.0


def table_bounce_times(H, track):
    """Every bounce the ball made ON the table, in seconds."""
    out = []
    for f, x, y in bounces(track, 1.0):
        p = project(H, x, y)
        if p and -PAD <= p[0] <= V2.W_M + PAD and -PAD <= p[1] <= V2.L_M + PAD:
            out.append(f / FPS)
    return np.asarray(sorted(out), float)


def drop_quiet(serves, bt, gap=5.0, max_bounces=0, edge=0.05):
    """[(contact, arrival, side)] with the non-serves removed.

    `edge` keeps the qualifying bounces of the two detections themselves
    out of the count -- without it every pair scores at least 2 and the
    rule never fires.
    """
    out = []
    for i, (c, a, s) in enumerate(serves):
        nxt = serves[i + 1][1] if i + 1 < len(serves) else None
        if nxt is not None and nxt - a <= gap:
            n = int(((bt > a + edge) & (bt < nxt - edge)).sum())
            if n <= max_bounces:
                continue
        out.append((c, a, s))
    return out
