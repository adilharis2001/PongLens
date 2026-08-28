#!/usr/bin/env python3
"""Why no serve was found inside each card that has none.

The serve detector does not score a serve, it accepts a bounce PAIR. Six
rules stand between a pair and acceptance, so the honest way to explain a
card with no serve is to walk the same six over the same bounces and
record which one turned each pair away. Guessing from the outside — "the
camera is flat", "the ball was occluded" — is how a morning gets spent on
the wrong rule.

The constants come from points_v2 by import rather than by copy. A page
built on numbers that have drifted from the detector is worse than no
page, because it reads as evidence.

Reads the evidence dumps a research_reprocess run left in its workroot and
writes `<id>.serves.json` beside the bundle in R2, for /research/serve-misses.

    python research_serve_misses.py --workroot <dir> [--prefix research/crossings]
"""
import argparse
import bisect
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from points_v2 import (  # noqa: E402
    APEX_MIN_PX, BACKTRACK_MAX_M, NET_MARGIN_M, NET_V, PAIR_MAX_S,
    PRIOR_CROSS_MAX, PRIOR_CROSS_WINDOW_S, homography_from_corners,
    on_surface, project,
)
from research_reprocess import MEDIA_BUCKET, PREFIX, config, s3_client  # noqa: E402

CORNER_ORDER = ["A_near_1", "B_near_2", "C_far_2", "D_far_1"]

# Every way a pair can be turned away, in the order the detector applies
# them. The text is what the page shows, so it says what happened rather
# than naming the constant that stopped it.
REASONS = {
    "no_pair": "fewer than two bounces to pair at all",
    "off_surface": "the bounces did not land on the table surface",
    "same_side": "both bounces on the same half of the table",
    "too_far_apart": f"more than {PAIR_MAX_S}s between the two bounces",
    "on_the_net_line": f"a bounce sat within {NET_MARGIN_M}m of the net",
    "no_apex": "the ball never rose off the table between them",
    "backtracked": "the ball travelled backwards on the way",
    "rally_running": "a rally was already in progress",
    "would_have_passed": "these rules alone would have accepted a pair here",
}


def bounce_pixels(blob):
    """Bounces carry a time and an on-table flag; their position comes from
    the nearest tracked frame, which is how research_shape draws them too."""
    track = [(float(t), float(x), float(y)) for t, x, y in blob["track"]]
    times = [p[0] for p in track]
    out = []
    for t, on_table in blob["bounces"]:
        i = min(bisect.bisect_left(times, t), len(track) - 1)
        if i > 0 and abs(times[i - 1] - t) < abs(times[i] - t):
            i -= 1
        out.append((float(t), track[i][1], track[i][2], int(on_table)))
    return track, times, out


def walk_rules(t0, t1, bnc, track, times, crossings, H):
    """Every pair inside one card, and the first rule that rejected it."""
    inside = [b for b in bnc if t0 <= b[0] <= t1]
    proj = [(t, x, y, project(H, x, y), on_tbl) for t, x, y, on_tbl in inside]
    surface = [p for p in proj if p[3] and on_surface(p[3])]

    res = {"bounces": len(inside), "on_surface": len(surface),
           "pairs": 0, "rejects": {}, "reason": None, "detail": []}
    if len(inside) < 2:
        res["reason"] = "no_pair"
        return res, proj
    if len(surface) < 2:
        res["reason"] = "off_surface"
        return res, proj

    def bump(k):
        res["rejects"][k] = res["rejects"].get(k, 0) + 1

    cross = np.asarray(crossings, float)
    for i, (ta, xa, ya, pa, _) in enumerate(surface):
        for tb, xb, yb, pb, _ in surface[i + 1:]:
            dt = tb - ta
            if dt <= 0.05:
                continue
            res["pairs"] += 1
            note = None
            if dt > PAIR_MAX_S:
                note = "too_far_apart"
            elif (1 if pa[1] > NET_V else -1) == (1 if pb[1] > NET_V else -1):
                note = "same_side"
            elif (abs(pa[1] - NET_V) < NET_MARGIN_M
                  or abs(pb[1] - NET_V) < NET_MARGIN_M):
                note = "on_the_net_line"
            else:
                ia = bisect.bisect_left(times, ta)
                ib = bisect.bisect_left(times, tb)
                span = track[ia + 1:ib]
                if len(span) < 2:
                    note = "no_apex"
                else:
                    apex = min(p[2] for p in span)
                    if min(ya, yb) - apex < APEX_MIN_PX:
                        note = "no_apex"
                    else:
                        direction = 1 if pb[1] > pa[1] else -1
                        back, run = 0.0, pa[1]
                        for p in span:
                            q = project(H, p[1], p[2])
                            if not q:
                                continue
                            d = (q[1] - run) * direction
                            if d < 0:
                                back = max(back, -d)
                            run = q[1]
                        if back > BACKTRACK_MAX_M:
                            note = "backtracked"
                        elif len(cross) and int(
                            ((cross >= ta - PRIOR_CROSS_WINDOW_S)
                             & (cross < ta - 0.05)).sum()) > PRIOR_CROSS_MAX:
                            note = "rally_running"
            res["detail"].append([round(ta, 2), round(tb, 2),
                                  note or "would_have_passed"])
            if note is None:
                res["reason"] = "would_have_passed"
                return res, proj
            bump(note)
            if note == "too_far_apart":
                break        # the inner loop is time-ordered, as in the detector
    res["reason"] = (max(res["rejects"].items(), key=lambda kv: kv[1])[0]
                     if res["rejects"] else "no_pair")
    return res, proj


def build(blob):
    quad_d = blob.get("quad")
    if not quad_d:
        raise ValueError("no table quad; nothing to project against")
    H = homography_from_corners({k: tuple(v) for k, v in quad_d.items()})
    quad = [[float(quad_d[k][0]), float(quad_d[k][1])] for k in CORNER_ORDER]
    a, b, c, d = quad
    net = [[(a[0] + d[0]) / 2, (a[1] + d[1]) / 2],
           [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]]

    track, times, bnc = bounce_pixels(blob)
    w, h = float(blob["w"]), float(blob["h"])
    cards = []
    for card in blob["cards"]:
        serve_s = card[2] if len(card) > 2 else None
        if serve_s is not None:
            continue
        t0, t1 = float(card[0]), float(card[1])
        res, proj = walk_rules(t0, t1, bnc, track, times,
                               blob["crossings"], H)
        ia = bisect.bisect_left(times, t0)
        ib = bisect.bisect_left(times, t1)
        cards.append({
            "t0": round(t0, 2), "t1": round(t1, 2),
            "dur": round(t1 - t0, 2),
            # fractions of the frame, so the overlay survives any size
            "track": [[round(t, 2), round(x / w, 5), round(y / h, 5)]
                      for t, x, y in track[ia:ib]],
            "bounces": [{
                "t": round(t, 2),
                "x": round(x / w, 5), "y": round(y / h, 5),
                "u": round(p[0], 3) if p else None,
                "v": round(p[1], 3) if p else None,
                "onTable": bool(on_tbl),
                "onSurface": bool(p and on_surface(p)),
            } for t, x, y, p, on_tbl in proj],
            "crossings": [round(float(s), 2) for s in blob["crossings"]
                          if t0 <= s <= t1],
            "why": res,
        })
    return {
        "key": blob["match_id"],
        "w": w, "h": h,
        "duration": blob["duration"],
        "quad": quad, "net": net, "prism": blob.get("prism") or quad,
        "cards": cards,
        "total_cards": len(blob["cards"]),
        "meta": {
            "opponent": blob.get("opponent"), "venue": blob.get("venue"),
            "created": blob.get("created"), "route": blob.get("route"),
            "serves_per_min": blob.get("serves_per_min"),
            "camera": blob.get("camera"),
            "calibration": blob.get("calibration"),
        },
        "reasons": REASONS,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workroot", required=True)
    ap.add_argument("--prefix", default=PREFIX)
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("ids", nargs="*")
    args = ap.parse_args()

    s3 = None if args.no_upload else s3_client(config())
    for name in sorted(os.listdir(args.workroot)):
        if args.ids and name not in args.ids:
            continue
        src = os.path.join(args.workroot, name, "evidence.json")
        if not os.path.exists(src):
            continue
        with open(src) as fh:
            blob = json.load(fh)
        try:
            page = build(blob)
        except ValueError as e:
            print(f"{name[:8]}  skipped: {e}")
            continue
        dest = os.path.join(args.workroot, name, "serves.json")
        with open(dest, "w") as fh:
            json.dump(page, fh, separators=(",", ":"))
        if s3:
            s3.upload_file(dest, MEDIA_BUCKET,
                           f"{args.prefix}/{name}.serves.json",
                           ExtraArgs={"ContentType": "application/json"})
        tally = {}
        for c in page["cards"]:
            tally[c["why"]["reason"]] = tally.get(c["why"]["reason"], 0) + 1
        top = ", ".join(f"{v} {k}" for k, v in
                        sorted(tally.items(), key=lambda kv: -kv[1])[:3])
        print(f"{name[:8]}  {len(page['cards']):3d} of "
              f"{page['total_cards']:3d} cards with no serve  ->  {top}"
              f"   ({os.path.getsize(dest) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
