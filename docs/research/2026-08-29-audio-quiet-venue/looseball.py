"""A ball nobody is hitting, heard rather than seen.

When a point ends, the ball is loose: it bounces on the table or the floor
until it rolls away. A ball bouncing freely loses the same FRACTION of its
energy every time, so the gaps between its bounces shrink by a constant
ratio — a geometric sequence. The ITTF specifies the ball's bounce: dropped
30 cm onto a table it must come back 24-26 cm, which puts that ratio
between 0.89 and 0.93 on the table, lower on a floor.

That is exactly what the recording shows after a winner tap:

    0.36  0.31  0.27  0.23  0.21  0.18  0.15   seconds apart
       0.86  0.87  0.85  0.91  0.86  0.83      each gap over the last

A rally cannot produce this. Two players set the tempo, so the gaps stay
flat, and if anything they lengthen when someone backs off. Nor can the
room: a voice, a shoe or a chair has no reason to arrive on a decaying
geometric schedule.

So this is a fingerprint of "the ball is out of play" that is written in
the TIMING of the sounds rather than in what they sound like — which means
it survives a noisy hall, and it does not care in the least where the
camera was standing.

Two things fall out of it. The moment a loose-ball train begins is the
moment the rally ended. The moment the last one before a serve ends is the
server catching the ball, an instant before they serve it.
"""
from __future__ import annotations

import numpy as np

MIN_RUN = 4              # bounces in a row before it counts
RATIO_LO, RATIO_HI = 0.62, 1.00
GAP_MAX = 0.90           # a free bounce never waits longer than this
GAP_MIN = 0.035
TOL = 0.22               # how far each ratio may sit from the run's own mean


def find_trains(times, min_run=MIN_RUN, ratio_lo=RATIO_LO, ratio_hi=RATIO_HI,
                gap_max=GAP_MAX, tol=TOL):
    """Every stretch of peaks whose spacing decays geometrically.

    Returns dicts with the first and last bounce of the train, how many
    bounces it held, and the decay ratio it settled on — the last being
    the thing that says "this really was a ball and not a coincidence".
    """
    times = np.asarray(times, float)
    if len(times) < min_run:
        return []
    d = np.diff(times)
    trains = []
    i = 0
    while i < len(d) - 1:
        if not (GAP_MIN <= d[i] <= gap_max):
            i += 1; continue
        ratios = []
        j = i
        while j < len(d) - 1:
            if not (GAP_MIN <= d[j + 1] <= gap_max):
                break
            r = d[j + 1] / d[j]
            if not (ratio_lo <= r <= ratio_hi):
                break
            if ratios and abs(r - float(np.mean(ratios))) > tol:
                break
            ratios.append(r)
            j += 1
        n = j - i + 2                      # peaks involved
        if n >= min_run and ratios:
            trains.append({"start": float(times[i]), "end": float(times[j + 1]),
                           "n": int(n), "ratio": float(np.mean(ratios)),
                           "spread": float(np.std(ratios)),
                           "first_gap": float(d[i]), "last_gap": float(d[j])})
            i = j + 1
        else:
            i += 1
    return trains


def rally_end_from(trains, t_lo, t_hi):
    """The first loose-ball train starting inside the window; its start is the end."""
    cand = [t for t in trains if t_lo <= t["start"] <= t_hi]
    if not cand:
        return None
    return min(cand, key=lambda t: t["start"])


def rally_start_from(trains, t_lo, t_hi):
    """The last loose-ball train to FINISH before the rally: the ball being caught."""
    cand = [t for t in trains if t_lo <= t["end"] <= t_hi]
    if not cand:
        return None
    return max(cand, key=lambda t: t["end"])
