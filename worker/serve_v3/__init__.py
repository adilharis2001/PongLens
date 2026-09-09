"""The V3 serve detector, as production runs it.

The lab built this over two months against Adil's own scoring, and the whole
of it is in `docs/research/2026-09-06-endon-routing.md`,
`2026-09-08-body-crop-and-coverage/` and the memories they point at. What is
here is the same code, with the lab's per-match plumbing replaced by
arguments and its experiment knobs frozen into `gates.py`.

The public surface is one call:

    detect(corners_px, track, cross, players, fps, duration, width)
        -> {"serves": [(contact_s, arrival_s, side)], "dead": [(t0, t1)], ...}

`contact_s` is the moment the server's bat met the ball, which is what a
card's `serve_s` has always meant. `dead` is the ball dribbling to a stop,
the pink strip on the research pages, which the body assembler uses to end a
card.

WHY THE CODE WAS COPIED RATHER THAN REWRITTEN. Forty measured settings and
five interacting filters do not survive a re-expression; the parity fixture
in `worker/tests/` holds the lab's own answers for thirteen matches, and it
exists because a port that "looks equivalent" is not.
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import points_v2 as V2                                          # noqa: E402
from points_v2 import homography_from_corners, project          # noqa: E402

from . import adapters, deadsplit, gates, handover, holepatch    # noqa: E402
from . import rule, servedwell, tossfilter                       # noqa: E402

CORNER_KEYS = adapters.CORNER_KEYS


class ServeDetectionUnavailable(Exception):
    """The serve rule cannot run on this match; the caller carries on."""


def _configure(fps, overlay):
    """The per-match state the lab kept in one module per match.

    Assigning module globals is deliberate. It keeps every ported line the
    line the lab measured, and the worker gives each match its own process,
    so there is nothing to race with. `points_pipeline` calls this once.
    """
    fps = float(fps)
    if not fps or fps <= 0:
        raise ServeDetectionUnavailable(f"no frame rate to run against ({fps})")
    rule.FPS = fps
    tossfilter.FPS = fps
    handover.FPS = fps
    servedwell.FPS = fps
    servedwell.OVERLAY = overlay
    servedwell.CROP_OX, servedwell.CROP_OY = (float(overlay["crop"][0]),
                                              float(overlay["crop"][1]))


def _on_table_bounces(track, H, quad, tw):
    """Bounces that landed on our own table, by frame, with the half each
    landed on. `handover.prefer_paired` reads both."""
    on = {}
    pad_px = gates.GATES["bounce_pad_w"] * tw
    for f, x, y in V2.bounces(track, 1.0):
        p = project(H, x, y)
        if p is None:
            continue
        inside = (-rule.PAD <= p[0] <= V2.W_M + rule.PAD
                  and -rule.PAD <= p[1] <= V2.L_M + rule.PAD)
        widened = (-rule.PAD <= p[0] <= V2.W_M + rule.PAD
                   and rule._quad_gap(quad, x, y) <= pad_px)
        if inside or widened:
            on[f] = p
    return on


def detect(corners_px, track, cross, players, fps, duration, width=1920.0,
           people_fps=None):
    """Every serve this match's ball and players agree on.

    Fails by raising `ServeDetectionUnavailable`; it never returns a partial
    answer, because a half-built serve list would move card starts for
    reasons nobody could reconstruct later.
    """
    if not track:
        raise ServeDetectionUnavailable("no ball track")
    missing = [k for k in CORNER_KEYS if k not in (corners_px or {})]
    if missing:
        raise ServeDetectionUnavailable(f"the table is missing {', '.join(missing)}")
    people, overlay, complete = adapters.people_inputs(players, corners_px, fps,
                                                       people_fps=people_fps)
    if not overlay["frames"]:
        raise ServeDetectionUnavailable("no player boxes")
    _configure(fps, overlay)

    quad = [tuple(corners_px[k]) for k in CORNER_KEYS]
    tw = rule._table_w(quad)
    H = homography_from_corners(corners_px)
    calib = {"corners": {k: list(corners_px[k]) for k in CORNER_KEYS}}

    class _Ev:                       # what serves() reads: the crossings only
        pass
    ev = _Ev()
    ev.cross = np.asarray([float(t) for t in cross], float)

    # THE BOUNCE FINDER, WIDENED, AND PUT BACK AFTERWARDS.
    #
    # `holepatch` replaces points_v2.bounces for everything in the process,
    # which is what the lab wants and is the most dangerous line in this
    # port: the ball pipeline's own reading must not change underneath it.
    # So it is installed here, around this computation, and restored in the
    # `finally` whatever happens.
    holepatch.install(gates.BOUNCE_HOLE_S, fps, pxscale=tw / rule.TABLE_W_REF)
    try:
        people_at = servedwell.People()
        raw = rule.serves(calib, None, ev, H, track, people,
                          player_at=people_at.at, fps=fps, **gates.GATES)
        bt = tossfilter.table_bounce_times(H, track)
        tossed = handover.tag(raw, track, people_at, bt, **gates.HANDOVER)

        # A RALLY OUTRANKS THE PASS FILTER, and the paired preference is then
        # computed on the survivors rather than beside them (the lab's
        # V3_SEQ=2: a real serve otherwise loses the comparison to a pass the
        # filter is about to remove anyway).
        need, win = gates.RALLY_OVERRIDE
        crs = [float(t) for t in ev.cross]
        tossed = {a for a in tossed
                  if sum(1 for t in crs if a < t <= a + win) < need}
        on = _on_table_bounces(track, H, quad, tw)
        keys = sorted(on)
        half_of = (lambda g: "near" if on[g][1] < V2.L_M / 2 else "far")
        unpaired = handover.prefer_paired(handover.drop(raw, tossed), keys,
                                          half_of, win=gates.PAIR_WIN_S)
        kept = handover.drop(raw, tossed | unpaired)
        dead = deadsplit.dead_runs(H, track, gates.DEAD_BALL["apex_w"],
                                   gates.DEAD_BALL["run"], tw, fps=fps)
    finally:
        holepatch.restore()

    serves = sorted(((float(c), float(a), s) for c, a, s in kept),
                    key=lambda r: r[0])
    return {"serves": serves,
            "dead": [(float(a), float(b)) for a, b in dead],
            "raw": len(raw), "dropped_pass": len(tossed),
            "dropped_unpaired": len(unpaired),
            "boxes_complete": complete,
            "samples": len(overlay["frames"]),
            "duration": float(duration)}
