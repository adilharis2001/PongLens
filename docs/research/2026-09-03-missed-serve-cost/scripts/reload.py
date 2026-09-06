"""Reload an --evidence-dump bundle into an Evidence-shaped object.

The bundle carries every array the real Evidence computed (track, bounces
with their on-table flag, crossings, accepted serve contacts, the dense
mask as runs) in source seconds. So the card assembly can be replayed by
calling the SHIPPED functions — serve_points, fallback_points, veto,
merge_continuous, resolve, split_long, on_own_table — over a reloaded
Evidence rather than over a private copy of any of them.

The self-check that this reload is faithful: build() must reproduce the
bundle's own `cards` list. Any bundle where it does not is reported and
excluded rather than quietly measured.
"""
import json
import os
import sys

import numpy as np

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
sys.path.insert(0, WORKER)

import points_v2 as V2                                        # noqa: E402
from points_v2 import homography_from_corners, project        # noqa: E402


class Reloaded:
    """Every attribute the assembly stages read, from the dump."""

    def __init__(self, b):
        self.b = b
        self.duration = float(b["duration"])
        self.fps = float(b["fps"])
        self.w = float(b["w"])
        self.scale = self.w / 1920.0
        self.n = int(self.duration / V2.TICK) + 1
        self.shape = b.get("camera")
        self.calibrated = self.shape is not None
        self.geometric = True

        self.track = {int(round(t * self.fps)): (float(x), float(y))
                      for t, x, y in b["track"]}
        self.H = homography_from_corners(
            {k: tuple(v) for k, v in b["quad"].items()})

        self.cross = np.asarray([float(t) for t in b["crossings"]], float)
        self.bt = np.asarray([float(t) for t, _f in b["bounces"]], float)
        self.bt_table = np.asarray(
            [float(t) for t, f in b["bounces"] if f], float)
        self.serves = sorted(round(float(t), 2) for t in b["serves"])
        self.motifs = []

        dense = np.zeros(self.n, bool)
        for a, c in b["dense"]:
            i0 = max(0, int(round(a / V2.TICK)))
            i1 = min(self.n, int(round(c / V2.TICK)))
            dense[i0:i1] = True
        self.ball_dense = dense
        self.ingate = np.zeros(self.n, bool)

    def between(self, arr, a, c):
        if not len(arr):
            return arr
        return arr[(arr >= a) & (arr <= c)]

    # -- bounce table coordinates, for the tolerance question ------------
    def bounce_uv(self):
        """[(t, u, v)] for every bounce in the dump, table metres."""
        out = []
        for t, _f in self.b["bounces"]:
            f = int(round(float(t) * self.fps))
            p = self.track.get(f)
            if p is None:
                for d in (1, -1, 2, -2):
                    p = self.track.get(f + d)
                    if p is not None:
                        break
            if p is None:
                out.append((float(t), None, None))
                continue
            uv = project(self.H, *p)
            out.append((float(t), None, None) if uv is None
                       else (float(t), uv[0], uv[1]))
        return out


def stages(E):
    """build_cards, stage by stage, using the shipped functions."""
    s = {}
    cards = V2.serve_points(E)
    s["serve"] = [dict(c) for c in cards]
    cards = cards + V2.fallback_points(E, cards)
    s["plus_fallback"] = [dict(c) for c in cards]
    cards, _cut = V2.veto(E, cards)
    s["post_veto"] = [dict(c) for c in cards]
    cards = V2.resolve(V2.merge_continuous(E, V2.resolve(cards)))
    s["merged"] = [dict(c) for c in cards]
    split = V2.split_long(E, cards)
    s["split"] = [dict(c) for c in split]
    resolved = V2.resolve(split)
    s["resolved"] = [dict(c) for c in resolved]
    final = V2.on_own_table(E, resolved)
    s["final"] = [dict(c) for c in final]
    s["dropped_by_own_table"] = [
        c for c in resolved
        if not any(abs(c["t0"] - d["t0"]) < 1e-9 and abs(c["t1"] - d["t1"]) < 1e-9
                   for d in final)]
    return s


def load(path):
    b = json.load(open(path))
    if not b.get("quad") or "track" not in b:
        return None, None
    E = Reloaded(b)
    return b, E


def faithful(b, final):
    """Does the replay reproduce the bundle's own card list?"""
    got = [[round(c["t0"], 2), round(c["t1"], 2),
            None if c.get("serve_s") is None else round(c["serve_s"], 2)]
           for c in final]
    want = [list(c) for c in b["cards"]]
    if len(got) != len(want):
        return False, f"{len(got)} vs {len(want)} cards"
    for g, w in zip(got, want):
        if abs(g[0] - w[0]) > 0.02 or abs(g[1] - w[1]) > 0.02:
            return False, f"{g} vs {w}"
    return True, "ok"
