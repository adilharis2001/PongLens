"""Rebuild the ball track from the raw BlurBall candidates and re-measure.

  ./venv/bin/python eval/reseed_table_regression.py <candidates-dir> <bundles-dir>

serve_slack_regression.py replays the serve rule over the track the shipped
pipeline already produced. This one goes a stage earlier: it re-runs the real
build_track over the raw four-candidates-per-frame files, then the real
bounces, crossings and serve_motifs on top, so a change INSIDE build_track can
be measured end to end.

Step one is the only thing that makes the rest trustworthy: with production
build_track untouched, the rebuilt track must equal the track stored in the
bundle frame for frame, and the anchored count must equal the one
serve_slack_regression already prints. If either drifts, every later number is
measuring the harness rather than the change.

The change under test: at RESEED ONLY — the moment the chain has lost the ball
and restarts on the strongest candidate anywhere in the frame — prefer a
candidate near the table. Nothing else moves.

VERDICT 2026-08-28: measured dead. Zero serves and zero anchored cards moved,
on any of five tolerances. Record: docs/research/2026-08-28-table-aware-reseed.md

Production carries no scaffold for this — the measurement said not to build it,
so points_v2.py is untouched. To re-run, re-apply these two edits and revert
them afterwards:

  1. def build_track(cand, scale=1.0, near_table=None):
  2. replace   best = max(cs, key=lambda c: c[2])
     with      best = _reseed(cs, near_table)
     and add, above build_track:

        def _reseed(cs, near_table):
            if near_table is not None:
                on = [c for c in cs if near_table(c[0], c[1])]
                if on:
                    cs = on
            return max(cs, key=lambda c: c[2])

With near_table None that is the shipped function line for line, which is what
lets the baseline check below prove the harness is honest.
"""
import glob
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import numpy as np

import points_v2 as V2
from points_v2 import (load_multi, build_track, bounces, crossings,
                       homography_from_corners, serve_motifs, project,
                       in_corridor)
from table_coordinates import canonicalize_table_quad

EXCLUDE = {"ae5400d5"}          # broadcast footage, ruled out of scope


# --- reseed counter -------------------------------------------------------
# Wraps the production _reseed rather than restating it: the count is a
# by-product of the real call, so it cannot describe a decision the shipped
# code does not make.
_RESEEDS = [0]
if not hasattr(V2, "_reseed"):
    raise SystemExit(
        "points_v2 has no _reseed, so the scaffold is not applied. This is the\n"
        "expected state: the measurement said not to build it and production was\n"
        "reverted. Re-apply the two edits in this file's docstring to re-run, and\n"
        "revert them again afterwards.")
_TRUE_REAL = V2._reseed


def _counting_reseed(cs, near_table):
    _RESEEDS[0] += 1
    return _TRUE_REAL(cs, near_table)


V2._reseed = _counting_reseed


# --- table proximity predicates -------------------------------------------
def quad_px(corners_px):
    """The four table corners in image pixels, canonical A B C D order."""
    names = list(corners_px)
    corners = [corners_px[n] for n in names]
    near = tuple(i for i, n in enumerate(names) if "near" in n)
    return np.asarray(canonicalize_table_quad(corners, near_pair=near).corners,
                      float)


def _seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / L2))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def poly_dist(q, x, y):
    """0 inside the quad, else pixels to its nearest edge."""
    inside = True
    sign = None
    for i in range(4):
        ax, ay = q[i]
        bx, by = q[(i + 1) % 4]
        c = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
        s = 1 if c > 0 else -1
        if sign is None:
            sign = s
        elif s != sign:
            inside = False
    if inside:
        return 0.0
    return min(_seg_dist(x, y, q[i][0], q[i][1],
                         q[(i + 1) % 4][0], q[(i + 1) % 4][1])
               for i in range(4))


def make_predicates(corners_px, H):
    q = quad_px(corners_px)
    near_w = math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1])   # near end, px

    def corridor(x, y):
        p = project(H, x, y)
        return bool(p) and in_corridor(*p)

    def px(k):
        pad = k * near_w
        return lambda x, y: poly_dist(q, x, y) <= pad

    return [("corridor", corridor),
            ("px0.25", px(0.25)),
            ("px0.50", px(0.50)),
            ("px1.00", px(1.00)),
            ("px2.00", px(2.00))]


# --- measurement ----------------------------------------------------------
def anchored_set(track, b, scale, H):
    """The production chain from a track to the set of anchored card indexes."""
    fps = b["fps"]
    bnc = bounces(track, scale)
    cross = crossings(track, H, fps)
    motifs = serve_motifs(track, bnc, H, fps, scale, cross)
    serves = sorted({round(m["contact_s"], 2) for m in motifs})
    cards = b.get("cards") or []
    hit = {i for i, c in enumerate(cards)
           if any(c[0] <= s <= c[1] for s in serves)}
    return serves, hit, len(cards)


def main():
    cdir, bdir = sys.argv[1], sys.argv[2]
    names = None
    rows = []
    for cpath in sorted(glob.glob(os.path.join(cdir, "*.jsonl"))):
        mid = os.path.basename(cpath)[:-6]
        if mid[:8] in EXCLUDE:
            continue
        bpath = os.path.join(bdir, mid, "evidence.json")
        if not os.path.exists(bpath):
            print(f"{mid[:8]}: no bundle, skipped"); continue
        b = json.load(open(bpath))
        if not b.get("quad"):
            print(f"{mid[:8]}: no quad in bundle, skipped"); continue
        cand = load_multi(cpath)
        if cand is None:
            print(f"{mid[:8]}: no candidates in file, skipped"); continue

        scale = b["w"] / 1920.0
        corners = {k: tuple(v) for k, v in b["quad"].items()}
        H = homography_from_corners(corners)
        fps = b["fps"]

        _RESEEDS[0] = 0
        base = build_track(cand, scale)
        nreseed = _RESEEDS[0]
        stored = {int(round(t * fps)): (float(x), float(y))
                  for t, x, y in b["track"]}
        ok = (len(base) == len(stored)
              and all(f in stored
                      and abs(base[f][0] - stored[f][0]) < 0.06
                      and abs(base[f][1] - stored[f][1]) < 0.06
                      for f in base))
        bs, bhit, ncards = anchored_set(base, b, scale, H)

        preds = make_predicates(corners, H)
        names = [n for n, _ in preds]
        variants = []
        for _n, pred in preds:
            t = build_track(cand, scale, near_table=pred)
            moved = sum(1 for f in t if f not in base or t[f] != base[f])
            vs, vhit, _ = anchored_set(t, b, scale, H)
            variants.append(dict(track=len(t), moved=moved, serves=len(vs),
                                 hit=vhit, gain=len(vhit - bhit),
                                 loss=len(bhit - vhit)))
        rows.append(dict(mid=mid[:8], ok=ok, reseeds=nreseed, ncards=ncards,
                         nbase=len(base), serves=len(bs), hit=bhit,
                         variants=variants))

    print("\n=== baseline (production build_track, rebuilt from candidates) ===")
    print(f"{'match':10s} {'exact':>6s} {'track':>8s} {'reseeds':>8s} "
          f"{'serves':>7s} {'anchored':>9s} {'cards':>6s}")
    tb = tc = 0
    allok = True
    for r in rows:
        print(f"{r['mid']:10s} {'YES' if r['ok'] else 'NO':>6s} {r['nbase']:8d} "
              f"{r['reseeds']:8d} {r['serves']:7d} {len(r['hit']):9d} "
              f"{r['ncards']:6d}")
        tb += len(r['hit']); tc += r['ncards']; allok &= r['ok']
    print(f"{'TOTAL':10s} {'':6s} {'':8s} "
          f"{sum(r['reseeds'] for r in rows):8d} "
          f"{sum(r['serves'] for r in rows):7d} {tb:9d} {tc:6d}")
    print(f"\nTrack reproduced exactly on every match: "
          f"{'YES' if allok else 'NO'}")

    for vi, name in enumerate(names or []):
        print(f"\n=== table-aware reseed: {name} ===")
        print(f"{'match':10s} {'frames moved':>13s} {'serves':>7s} "
              f"{'anchored':>9s} {'gained':>7s} {'lost':>5s} {'net':>5s}")
        ta = g = l = mv = 0
        for r in rows:
            v = r['variants'][vi]
            n = len(v['hit'])
            print(f"{r['mid']:10s} {v['moved']:13d} {v['serves']:7d} "
                  f"{n:9d} {v['gain']:7d} {v['loss']:5d} "
                  f"{n - len(r['hit']):+5d}")
            ta += n; g += v['gain']; l += v['loss']; mv += v['moved']
        print(f"{'TOTAL':10s} {mv:13d} "
              f"{sum(r['variants'][vi]['serves'] for r in rows):7d} "
              f"{ta:9d} {g:7d} {l:5d} {ta - tb:+5d}")
        print(f"  anchored {tb}/{tc} -> {ta}/{tc}   "
              f"({g} cards gained an anchor, {l} lost one)")


if __name__ == "__main__":
    main()
