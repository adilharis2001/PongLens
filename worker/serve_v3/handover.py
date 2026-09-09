"""Toss detection by BOX HANDOVER: the ball is passed, then held.

Adil's shape, in his words: the player passing the ball leaves his box
quickly, the ball crosses, and then it STAYS in the other player's box
until that player serves.

The existing filter (tossfilter.drop_quiet) reads the same event from a
different angle -- no table bounce between one detection and the next --
and it only catches a toss that never touched the table. His card 43 is
the case it misses. The far player passes the ball across at 574.67, it
bounces TWICE on the way (574.67 and 575.17), the near player catches it,
holds it, and serves at 579.36. Bounces in between: two. The filter keeps
the toss, the card opens at 573.5 against production's 577.8, and the card
runs 18 seconds over what is really three separate serve attempts.

WHAT SEPARATES A TOSS FROM A SERVE. Not the pass itself -- a toss and a
serve's first bounce are the same picture. What happens NEXT:

    a serve      is followed by a rally: the ball bounces on the table
                 several times, on alternating halves, and only when the
                 point is over is it picked up again.
    a toss       is followed by nothing. One trip across, and the ball is
                 in a hand.

So the rule looks for the ball coming to REST -- an unbroken spell inside
one player's box with no table bounce anywhere in it -- and asks how much
happened before that rest. A toss reaches the rest almost immediately. A
serve has a whole rally to get through first.

The last condition is what keeps the normal between-points cycle out of
it. Between two real points the ball IS retrieved and held by the next
server, which is the same picture as a catch. The difference is timing:
after a toss the holder serves within a second or two, because he was
waiting for the ball; after a point there is a pause to say the score and
walk back. So the rest must END shortly before the next detection.
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from . import servedwell                                     # noqa: E402

# Set per run by serve_v3.configure(), like the other ported modules.
FPS = 30.0


def _side_at(track, people, fr, pad=0.0):
    pl = people.at(fr / FPS)
    if not pl:
        return None
    x, y = track[fr]
    cx, cy = x - servedwell.CROP_OX, y - servedwell.CROP_OY
    inn = servedwell._inside(pl.get("near"), cx, cy, pad)
    inf = servedwell._inside(pl.get("far"), cx, cy, pad)
    return "near" if (inn and not inf) else ("far" if (inf and not inn) else None)


def rest_run(track, people, bt, t0, t1, pad=0.0):
    """The longest spell the ball sat in one box with NOTHING bouncing.

    Returns (side, frames, t_start, t_end). A run is cut by a table bounce
    as well as by the ball leaving the box, because a bounce means the ball
    is in play, not in a hand -- a ball travelling low across a player's
    own box during a rally otherwise reads exactly like a catch.
    """
    best = (None, 0, None, None)
    cur, seq = None, []

    def close():
        nonlocal best
        if cur and len(seq) > best[1]:
            best = (cur, len(seq), seq[0] / FPS, seq[-1] / FPS)

    for fr in sorted(track):
        tt = fr / FPS
        if tt < t0:
            continue
        if tt > t1:
            break
        s = _side_at(track, people, fr, pad)
        bounced = seq and bool(((bt > seq[-1] / FPS) & (bt <= tt)).any())
        if s is not None and s == cur and not bounced:
            seq.append(fr)
        else:
            close()
            cur, seq = s, ([fr] if s else [])
    close()
    return best


def tag(serves, track, people, bt, min_run_s=0.267, max_before=1, rest_gap=2.5,
        look=6.0, edge=0.05, fps=None):
    fps = fps or FPS
    """Which detections are tosses. Returns a set of arrival times.

    min_run_s   SECONDS the ball must sit still in a box to count as held.
                Was 8 frames, which halves in meaning on a 60fps upload.
    max_before  table bounces allowed between the detection and that rest;
                a rally puts many more than this in the way
    rest_gap    seconds the holder may take to serve afterwards
    look        how far ahead to look for the next detection at all
    """
    out = set()
    for i, (_c, a, _s) in enumerate(serves):
        if i + 1 >= len(serves):
            continue
        nxt = serves[i + 1][1]
        if nxt - a > look:
            continue
        side, n, ts, te = rest_run(track, people, bt, a + edge, nxt - edge)
        if side is None or n < int(round(min_run_s * fps)):
            continue
        if int(((bt > a + edge) & (bt < ts)).sum()) > max_before:
            continue
        if nxt - te > rest_gap:
            continue
        out.add(round(a, 2))
    return out


def drop(serves, tossed):
    return [(c, a, s) for c, a, s in serves if round(a, 2) not in tossed]


def prefer_paired(serves, on_bounces, half_of, win=8.0, pair_max_frames=None):
    """Adil's rule: where two detections compete, the paired one wins.

    A real serve makes TWO bounces, on opposite halves, close together.
    That is production's own serve motif, and this rule does not REQUIRE it
    -- requiring it costs seven points on 89b35ee0 their only card, because
    a server's body often hides their own bounce. It uses it to CHOOSE.

    So it is a comparison, not a filter: it can only fire where two
    detections are competing for the same stretch of time, and then it
    drops the one with no partner bounce in favour of the one that has one.

    Measured on 89b35ee0: six points move and every one of them improves.
    Two splits become single cards, one card gains the winner press it used
    to stop short of, three start closer to Adil's own, and nothing is lost
    -- no point ends up swallowed or without a card. The server reading goes
    from 90% to 92%, because the detection being dropped was often the one
    reading the wrong half.

    NOTE ON WHAT IT CANNOT DO. A ball PASSED across the table also bounces
    on both halves, so this cannot tell a pass from a serve -- at 20:17.8 on
    this match the pass is paired and arcs 39px between its two bounces,
    against 13px for the flat tomahawk serve four seconds later. It removes
    the unpaired toss, not the paired pass.
    """
    # 48 FRAMES IS PAIR_MAX_S SPELLED THE OTHER WAY -- 1.60 s at 30fps and
    # 0.80 s at 60. Every other caller of _is_paired in the lab writes
    # int(round(1.6 * fps)); this default is the one place it is a count.
    # Identical on this corpus by construction (round(1.6 * 29.97) == 48).
    if pair_max_frames is None:
        import points_v2 as _V2
        pair_max_frames = int(round(_V2.PAIR_MAX_S * FPS))
    out = set()
    for i, (_c, a, _s) in enumerate(serves):
        if i + 1 >= len(serves):
            continue
        nxt = serves[i + 1][1]
        if nxt - a > win:
            continue
        me, them = _is_paired(a, on_bounces, half_of, pair_max_frames), \
                   _is_paired(nxt, on_bounces, half_of, pair_max_frames)
        if me is False and them is True:
            out.add(round(a, 2))
    return out


def _is_paired(a, on_bounces, half_of, pair_max_frames):
    """Does the bounce at arrival `a` have a partner on the other half?"""
    if not on_bounces:
        return None
    bf = min(on_bounces, key=lambda g: abs(g / FPS - a))
    if abs(bf / FPS - a) > 0.4:
        return None
    other = "far" if half_of(bf) == "near" else "near"
    return any(bf < g <= bf + pair_max_frames and half_of(g) == other
               for g in on_bounces)
