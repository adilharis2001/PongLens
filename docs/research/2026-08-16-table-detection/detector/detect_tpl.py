"""Model-to-image fitting of a table tennis table.

The shape is known exactly, so the search is over where to put that shape,
not over which fragments of the picture to believe. Proposals say roughly
where a flat uniform surface is; every proposal is expanded into the nine
tables it could be part of; each of those is polished by a derivative-free
minimiser against a cost built from directional chamfer distance, white
line evidence, surface uniformity and the net.

This file never reads the ground truth.
"""
from __future__ import annotations

import math

import numpy as np
import cv2

import features
import proposals
import tmodel
import opt

SEARCH_SCALE = 0.5
N_ROUGH = 40    # seeds given a quick shake
N_REFINE = 12   # survivors given a real refinement
N_POLISH = 3    # finalists re-fitted at full resolution


def _dedupe(cands, tol=0.06):
    """Drop hypotheses that are the same quad twice over."""
    out = []
    for c, q in cands:
        s = math.sqrt(max(abs(_area(q)), 1.0))
        if any(np.max(np.linalg.norm(np.roll(q, k, axis=0) - o, axis=1)) < tol * s
               for o in out for k in range(4)):
            continue
        out.append(q)
        yield c, q


def _area(q):
    x, y = q[:, 0], q[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _seed_set(ev):
    quads = proposals.region_quads(ev)
    scored = []
    for q in quads:
        for h in proposals.expand(q):
            for rot in (0, 1):
                hh = np.ascontiguousarray(np.roll(h, rot, axis=0))
                c = tmodel.cost(hh, ev)
                if math.isfinite(c):
                    scored.append((c, hh))
    scored.sort(key=lambda t: t[0])
    return list(_dedupe(scored))


def _fit(ev, q, budget):
    """budget: (coarse iters, fine iters, polish rounds)."""
    f = lambda v: tmodel.cost(v.reshape(4, 2), ev)
    span = float(np.hypot(*(q.max(axis=0) - q.min(axis=0))))
    x = q.ravel().copy()
    ci, fi, pr = budget
    c = f(x)
    if ci:
        x, c = opt.nelder_mead(f, x, step=np.full(8, max(2.0, span * 0.05)), maxiter=ci)
    if fi:
        x, c = opt.nelder_mead(f, x, step=np.full(8, max(1.0, span * 0.015)), maxiter=fi)
    if pr:
        x, c = opt.coord_polish(f, x, step=np.full(8, max(0.5, span * 0.006)), rounds=pr)
    return x.reshape(4, 2), c


def detect(bgr, return_debug=False):
    """Returns the table quad in the coordinates of `bgr`, or None.

    Three passes, each cheaper to enter than the last is to finish: shake
    every seed a little, refine the ones that respond, then re-fit the
    finalists at full resolution.
    """
    ev = features.Evidence(bgr, scale=SEARCH_SCALE)
    seeds = _seed_set(ev)
    if not seeds:
        return (None, {"reason": "no seeds"}) if return_debug else None

    rough = []
    for c0, q in seeds[:N_ROUGH]:
        qq, c = _fit(ev, q, (110, 0, 0))
        if math.isfinite(c):
            rough.append((c, qq))
    if not rough:
        return (None, {"reason": "no finite refinement"}) if return_debug else None
    rough.sort(key=lambda t: t[0])

    mid = []
    for c, q in list(_dedupe(rough))[:N_REFINE]:
        qq, cc = _fit(ev, q, (0, 420, 4))
        if math.isfinite(cc):
            mid.append((cc, qq))
    if not mid:
        return (None, {"reason": "no finite refinement"}) if return_debug else None
    mid.sort(key=lambda t: t[0])

    ev_full = features.Evidence(bgr, scale=1.0)
    k = 1.0 / SEARCH_SCALE
    finals = []
    for c, q in list(_dedupe(mid))[:N_POLISH]:
        qq, cc = _fit(ev_full, q * k, (0, 380, 4))
        if math.isfinite(cc):
            finals.append((cc, qq))
    if not finals:
        best = mid[0][1] * k
        return (best, {"stage": "coarse only"}) if return_debug else best
    finals.sort(key=lambda t: t[0])
    best = finals[0][1]
    if return_debug:
        return best, {"cost": finals[0][0], "n_seeds": len(seeds),
                      "alts": [[float(c), q.tolist()] for c, q in finals[:3]]}
    return best
