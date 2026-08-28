"""Replay the real serve rule over stored evidence bundles, old vs new.

  ./venv/bin/python eval/serve_slack_regression.py <dir-of-bundles>

A bundle is the `--evidence-dump` JSON research_reprocess.py writes: the ball
track, the bounces, the crossings and the table, in source seconds. That is
everything serve_motifs needs, so the whole corpus re-measures in seconds with
no video, no GPU and no calls to anything.

This imports the production function rather than restating it. A reimplemented
rule agreeing with itself is the failure mode this file exists to avoid: the
first pass at these numbers was a private copy of serve_motifs, and a copy can
be right about a change the shipped code does not make.

Prints per match and a total. The numbers on the 11-match review corpus, at
the settings shipped 2026-08-28:

    625 serves and 555 anchored cards at 0.15 / 1.5
    662 serves and 602 anchored cards at 0.45 / 2.5

Record: docs/superpowers/specs/2026-08-28-serve-surface-slack-design.md
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import points_v2 as V2
from points_v2 import homography_from_corners, serve_motifs

OLD = (0.15, 1.5)
NEW = (0.45, 2.5)


def load(path):
    """Bundle -> (frame-keyed track, bounces, H, fps, crossings, cards)."""
    b = json.load(open(path))
    if not b.get("quad"):
        return None
    fps = b["fps"]
    track = {}
    for t, x, y in b["track"]:
        track[int(round(t * fps))] = (float(x), float(y))
    bounces = []
    for t, _on_table in b["bounces"]:
        f = int(round(t * fps))
        if f in track:
            bounces.append((f, track[f][0], track[f][1]))
    H = homography_from_corners({k: tuple(v) for k, v in b["quad"].items()})
    # serve_motifs measures the apex in PIXELS and scales the threshold by
    # the video's width, so a 640-wide match needs scale 0.33 or its serves
    # are judged against a bar three times too high. Passing 1.0 for every
    # match silently lost 14 serves on the one 360p video in the corpus.
    scale = b["w"] / 1920.0
    return (track, sorted(bounces), H, fps,
            [float(t) for t in b["crossings"]], b.get("cards") or [], b, scale)


def measure(loaded, pad, cluster):
    track, bounces, H, fps, cross, cards, _b, scale = loaded
    V2.PAIR_SURFACE_PAD_M = pad
    V2.CLUSTER_S = cluster
    motifs = serve_motifs(track, bounces, H, fps, scale, cross)
    serves = sorted({round(m["contact_s"], 2) for m in motifs})
    anchored = sum(1 for c in cards
                   if any(c[0] <= s <= c[1] for s in serves))
    return len(serves), anchored, len(cards)


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    paths = sorted(glob.glob(os.path.join(root, "**", "*.json"), recursive=True))
    rows = []
    for path in paths:
        try:
            loaded = load(path)
        except Exception:
            continue
        if not loaded:
            continue
        old = measure(loaded, *OLD)
        new = measure(loaded, *NEW)
        rows.append((os.path.basename(os.path.dirname(path))[:8] or
                     os.path.basename(path)[:8], old, new))
    if not rows:
        raise SystemExit(f"no evidence bundles under {root}")

    print(f"{'match':10s} {'serves old':>10s} {'new':>5s} {'cards':>6s} "
          f"{'anchored old':>13s} {'new':>5s} {'gain':>5s}")
    tot = [0, 0, 0, 0, 0]
    for mid, (so, ao, n), (sn, an, _) in rows:
        print(f"{mid:10s} {so:10d} {sn:5d} {n:6d} {ao:13d} {an:5d} {an - ao:+5d}")
        tot[0] += so; tot[1] += sn; tot[2] += n; tot[3] += ao; tot[4] += an
    print("-" * 60)
    print(f"{'TOTAL':10s} {tot[0]:10d} {tot[1]:5d} {tot[2]:6d} "
          f"{tot[3]:13d} {tot[4]:5d} {tot[4] - tot[3]:+5d}")
    print(f"\n{len(rows)} matches. Anchored {tot[3]}/{tot[2]} "
          f"({tot[3] / tot[2] * 100:.0f}%) -> {tot[4]}/{tot[2]} "
          f"({tot[4] / tot[2] * 100:.0f}%)")


if __name__ == "__main__":
    main()
