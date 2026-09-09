"""Who served, from where the ball WAS before the serve.

The rule in place reads the server off the first bounce it can see: the
ball arrives onto the table and the half it lands on is the server's own
half. When both of a serve's bounces are visible that is right. When the
server's own bounce is missed — and it often is — the first bounce the rule
can see is the RECEIVER'S, and it names the wrong player. That is the whole
of the server error on this match, and it leans one way: 10 of the 15 wrong
calls say "near" when the truth is "far".

Adil's observation, from watching the video: before a serve the ball sits
in the server's hand, inside the server's own box, for around a second, and
is then tossed — still inside that box. Nothing about that depends on
seeing a bounce.

    card 2, near served: ball inside the near player's box 23.50-24.97,
            1.47s, through the hold AND the toss. The serve's own first
            bounce IS detected at 25.13 but projects u = -0.30, thirty
            centimetres outside the left sideline, so the bounce rule
            skips it and reads the receiver's bounce at 25.53. Says FAR.
    card 3, far served:  ball inside the far player's box 38.10-39.07,
            0.97s. The first bounce is not detected at all — the track has
            a 0.70s hole through the contact — so the rule reads the
            receiver's bounce at 40.53. Says NEAR.

Two different upstream failures, one signal that survives both.

WHICH BOX IS WHICH. Not choose_players' near/far labels: on this camera the
players are separated left-to-right, both are clipped by the crop's bottom
edge, and their box heights are within 3px, so the labels swap for 1.2s in
the middle of card 3's serve. Each person's end comes from the table's own
end lines instead — closer to A-B is the near end, closer to C-D is the far
end — and the player at an end is the tallest person standing at it.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))                     # the worker directory
import points_v2 as V2                                        # noqa: E402
# The exported boxes, as a dict rather than a path: in the worker they are
# built in memory from the pose pass instead of read off disk. Set by
# serve_v3.configure(); everything below reads it exactly as the lab read
# its file.
OVERLAY = None


def _crop_origin(path=None):
    """The crop's origin in source pixels, read from the exported boxes.

    Person boxes are CROP pixels and the ball is SOURCE pixels, so one origin
    has to come off before they can be compared. It is recorded in the file
    itself rather than written here: 462,158 is THIS match's crop, and the
    other match in this folder is 222,148. A literal would be wrong there and
    would not announce itself -- the box would simply land elsewhere in the
    picture and the person test would answer "no" forever. See cropinfo.py.
    """
    d = _read(path)
    c = d.get("crop")
    if not c:
        raise RuntimeError("the exported boxes carry no crop rectangle")
    return float(c[0]), float(c[1])


def _read(path=None):
    if path is not None:
        return json.load(open(path))
    if OVERLAY is None:
        raise RuntimeError("serve_v3.configure() has not been called")
    return OVERLAY


# Both set per run by serve_v3.configure(), for the reason given in rule.py.
CROP_OX, CROP_OY = 0.0, 0.0
FPS = 30.0


class People:
    """The two players' boxes, looked up by time."""

    def __init__(self, path=None):
        d = _read(path)
        self.t = np.asarray([r[0] for r in d["frames"]], float)
        self.players = []
        for _t, ppl in d["frames"]:
            best = {}
            for box, end, height, _dn, _df in ppl:
                if end not in best or height > best[end][1]:
                    best[end] = (box, height)
            self.players.append({e: v[0] for e, v in best.items()})

    def at(self, t, tol=0.15):
        i = int(np.searchsorted(self.t, t))
        cand = [j for j in (i - 1, i) if 0 <= j < len(self.t)]
        if not cand:
            return None
        j = min(cand, key=lambda k: abs(self.t[k] - t))
        return self.players[j] if abs(self.t[j] - t) <= tol else None


def _inside(box, x, y, pad):
    if not box:
        return False
    w, h = box[2] - box[0], box[3] - box[1]
    return (box[0] - pad * w <= x <= box[2] + pad * w
            and box[1] - pad * h <= y <= box[3] + pad * h)


def owner_sequence(track, people, t, back=2.0, ahead=0.0, pad=0.0,
                   max_speed_w=None, tw=None):
    """Whose box held the ball, frame by frame, in time order.

    A frame is credited to a side only if the ball is inside THAT player's
    box and not the other's, so two boxes overlapping decides nothing.

    max_speed_w, in table widths a second, drops frames where the ball is
    plainly in flight. A held or tossed ball is slow. Card 66 of 89b35ee0:
    seven frames sat inside the near player's box in the PICTURE while the
    ball was over the far half behind him, travelling at 2.0-2.7 widths a
    second -- the far player's serve, seen through the near player. The
    hold reading believed it and overruled a correct bounce. Gated at 2.0
    the reading says far; 1.0, 1.5 and 2.0 all give the same result.
    """
    out = []
    frames = sorted(track)
    prev = None
    for fr in frames:
        tt = fr / FPS
        if not (t - back <= tt <= t + ahead):
            prev = fr
            continue
        if max_speed_w is not None and tw and prev is not None and fr - prev <= 2:
            dx = track[fr][0] - track[prev][0]
            dy = track[fr][1] - track[prev][1]
            if (dx * dx + dy * dy) ** 0.5 / (fr - prev) / tw * FPS > max_speed_w:
                out.append(None)
                prev = fr
                continue
        prev = fr
        pl = people.at(tt)
        if not pl:
            continue
        x, y = track[fr]
        cx, cy = x - CROP_OX, y - CROP_OY
        inn = _inside(pl.get("near"), cx, cy, pad)
        inf = _inside(pl.get("far"), cx, cy, pad)
        out.append("near" if (inn and not inf)
                   else ("far" if (inf and not inn) else None))
    return out


def longest_runs(seq):
    """The longest UNBROKEN spell each side held the ball.

    Unbroken, not a total, because a total counts a ball flying past a
    player the same as a ball resting in their hand. Measured over the
    match: the run version is right on 97% of the serves it answers,
    the total on 95%, and the run breaks fewer of the ones the bounce
    rule already had right.
    """
    best = {"near": 0, "far": 0}
    cur, n = None, 0
    for s in seq:
        if s is not None and s == cur:
            n += 1
        elif s is not None:
            cur, n = s, 1
        else:
            cur, n = None, 0
        if cur:
            best[cur] = max(best[cur], n)
    return best


def serving_end(track, people, contact_s, back=2.0, pad=0.0,
                min_run_s=0.2, min_ratio=3.0, max_speed_w=None, tw=None):
    """The serving END, or None to leave the bounce rule's answer alone.

    min_run_s is a fifth of a second — long enough that the ball was held
    rather than passing through. It was 6 frames, which is a fifth of a
    second at 30fps and a tenth at 60, and PongLens takes 60fps uploads. min_ratio stops a near-tie
    deciding anything. Both abstain rather than guess: the bounce rule is
    right 82% of the time and is not worth overwriting on a coin toss.

    Measured on 84 scored cards of 89b35ee0: it answers on 32 and is right
    on 31. Five of those the bounce rule had wrong, one it had right. The
    one it breaks (card 18) has a serve mark 4.6s before the point starts,
    so the window is over the wrong moment — a bad mark, not a bad rule.
    """
    r = longest_runs(owner_sequence(track, people, contact_s, back, 0.0, pad,
                                    max_speed_w, tw))
    hi, lo = max(r.values()), min(r.values())
    side = "near" if r["near"] > r["far"] else "far"
    if hi < int(round(min_run_s * FPS)) or not (lo == 0 or hi >= min_ratio * lo):
        return None, r
    return side, r


def holder(track, people, t, back=2.0, ahead=0.0, pad=0.0):
    """(side, near_frames, far_frames) over [t - back, t + ahead].

    A frame counts for a side only if the ball is inside THAT player's box
    and not the other's, so the two boxes overlapping decides nothing.
    """
    n = f = 0
    for fr in track:
        tt = fr / FPS
        if not (t - back <= tt <= t + ahead):
            continue
        pl = people.at(tt)
        if not pl:
            continue
        x, y = track[fr]
        cx, cy = x - CROP_OX, y - CROP_OY
        inn = _inside(pl.get("near"), cx, cy, pad)
        inf = _inside(pl.get("far"), cx, cy, pad)
        if inn and not inf:
            n += 1
        elif inf and not inn:
            f += 1
    if n == f:
        return None, n, f
    return ("near" if n > f else "far"), n, f


def server_of(track, people, contact_s, back=2.0, ahead=0.0, pad=0.0,
              min_frames=6, min_ratio=2.0):
    """The serving END, or None to leave the bounce rule's answer alone.

    min_frames stops a two-frame graze deciding a serve; min_ratio stops a
    near-tie deciding one. Both abstain rather than guess — the bounce rule
    is right 83% of the time and is not worth overwriting on a coin toss.
    """
    side, n, f = holder(track, people, contact_s, back, ahead, pad)
    if side is None:
        return None, n, f
    hi, lo = (n, f) if side == "near" else (f, n)
    if hi < min_frames or hi < min_ratio * max(lo, 1) and lo > 0:
        return None, n, f
    return side, n, f
