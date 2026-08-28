"""Why does a card have no serve? Ask the rule, do not infer it.

  ./venv/bin/python eval/serve_refusal_census.py <dir-of-bundles>

`serve_motifs` is six yes/no tests over pairs of bounces. When a card ends up
with no serve the shipped code returns nothing and says nothing, so every
question about the misses used to be answered by reasoning about the rule from
outside it. That is how a "56% recoverable" turned into 19 and then into 12:
each number counted things that had the shape of the answer.

This asks the rule itself. serve_motifs takes a `reject` sink; every pair it
turns down lands there with the gate that turned it down. For each unanchored
card we take the pairs inside its window and report the one that got FURTHEST
through the gates, because that is the pair closest to being a serve and its
gate is the rule standing between this card and an anchor.

A card with no pairs at all is a different animal, and gets its own bucket:
either its bounces never made the playing surface, or there were no bounces.
"""
import glob
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import points_v2 as V2
from points_v2 import homography_from_corners, serve_motifs
from serve_slack_regression import load, NEW

# Gate order = how far a pair got before it was refused. Later means closer to
# being called a serve. Ordered to match the sequence inside serve_motifs.
GATE_DEPTH = {
    "no_table_coords": 0,
    "bounce_off_surface": 0,
    "pair_too_far_apart": 1,
    "same_side_of_net": 2,
    "bounce_too_near_net": 3,
    "ball_untracked_between": 4,
    "no_apex": 5,
    "no_table_coords_between": 6,
    "travelled_backwards": 7,
    "rally_already_running": 8,
}
PAIRWISE = {g for g, d in GATE_DEPTH.items() if d >= 1}


def census(loaded):
    track, bounces, H, fps, cross, cards, bundle, scale = loaded
    V2.PAIR_SURFACE_PAD_M, V2.CLUSTER_S = NEW
    reject = []
    motifs = serve_motifs(track, bounces, H, fps, scale, cross, reject=reject)
    serves = sorted({round(m["contact_s"], 2) for m in motifs})

    out = []
    for idx, c in enumerate(cards):
        t0, t1 = float(c[0]), float(c[1])
        if any(t0 <= s <= t1 for s in serves):
            continue
        # A serve's contact is CONTACT_LOOKBACK_S before its first bounce, so a
        # pair only anchors this card if that contact lands inside the window.
        lo = t0 - 0.05
        hi = t1 + V2.CONTACT_LOOKBACK_S + 0.05
        inside = [r for r in reject if lo <= r[0] <= hi]
        pairs = [r for r in inside if r[2] in PAIRWISE]
        if pairs:
            best = max(pairs, key=lambda r: GATE_DEPTH[r[2]])
            reason, at = best[2], best[0]
            near = sum(1 for r in pairs if r[2] == reason)
        elif inside:
            worst = Counter(r[2] for r in inside).most_common(1)[0]
            reason, at, near = worst[0], inside[0][0], worst[1]
        else:
            reason, at, near = "no_bounces_at_all", t0, 0
        out.append({
            "card": idx, "t0": round(t0, 2), "t1": round(t1, 2),
            "reason": reason, "at": at, "n": near,
            "pairs_tried": len(pairs), "bounces_seen": len(inside),
        })
    return out, len(cards), len(serves)


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    paths = sorted(glob.glob(os.path.join(root, "**", "*.json"), recursive=True))
    totals, per_match, records = Counter(), {}, defaultdict(list)
    cards_all = missing_all = 0
    for path in paths:
        try:
            loaded = load(path)
        except Exception:
            continue
        if not loaded:
            continue
        mid = os.path.basename(os.path.dirname(path)) or os.path.basename(path)
        rows, ncards, _ = census(loaded)
        cards_all += ncards
        missing_all += len(rows)
        per_match[mid] = (ncards, len(rows), Counter(r["reason"] for r in rows))
        totals.update(r["reason"] for r in rows)
        records[mid] = rows

    print(f"{cards_all} cards, {missing_all} with no serve\n")
    print(f"{'why the rule refused':26s} {'cards':>6s} {'share':>7s}")
    print("-" * 42)
    for reason, n in totals.most_common():
        print(f"{reason:26s} {n:6d} {n / missing_all * 100:6.1f}%")
    print()
    print(f"{'match':10s} {'cards':>6s} {'missing':>8s}  top reason")
    print("-" * 60)
    for mid, (nc, nm, cnt) in sorted(per_match.items(),
                                     key=lambda kv: -kv[1][1]):
        top = cnt.most_common(1)[0] if cnt else ("-", 0)
        print(f"{mid[:8]:10s} {nc:6d} {nm:8d}  {top[0]} ({top[1]})")

    dest = os.environ.get("CENSUS_OUT")
    if dest:
        json.dump(records, open(dest, "w"))
        print(f"\nper-card detail -> {dest}")


if __name__ == "__main__":
    main()
