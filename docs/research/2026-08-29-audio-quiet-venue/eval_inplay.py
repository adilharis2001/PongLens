"""Turn the separation into a number the product can act on.

AUC says the two classes are distinguishable. It does not say how much
footage could be cut, which is the only thing that matters here: today's
cut keeps 80-93% of the raw and the goal is about 30%.

So this asks the operating question directly. Slide one threshold over the
in-play score and, at each setting, measure

  * how much of the time Adil marked as a RALLY survives — this is the
    thing that must not be traded away, because a clip that loses the end
    of a point is worse than a clip with a second of dead air in it;
  * how much of the time between points is correctly dropped.

The threshold is deliberately a single global number rather than one per
match. A per-match threshold cannot ship unless something sets it, and
"the venue calibrates itself" is exactly the kind of claim that quietly
fails on the first venue nobody tested.
"""
import json, os, sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC
import corpus as CO
import envelope as EN
import inplay as IP

STEP_S = 0.25          # decision granularity
SMOOTH_S = 1.5         # the score is a running mean over this much audio


def score_track(env, step=STEP_S, smooth=SMOOTH_S):
    """One in-play score per quarter second, from the whole recording."""
    t = env["times"]
    z = env["high"]["z"]
    grid = np.arange(t[0] + smooth / 2, t[-1] - smooth / 2, step)
    half = smooth / 2
    idx = np.searchsorted(t, np.stack([grid - half, grid + half]))
    csum = np.concatenate([[0.0], np.cumsum(z)])
    n = np.maximum(idx[1] - idx[0], 1)
    return grid, (csum[idx[1]] - csum[idx[0]]) / n


def label_track(doc, grid):
    """1 rally, 0 gap, -1 don't know (too close to a tap to be sure)."""
    b = [x for x in doc["boundaries"] if not x.get("deleted")]
    key = ("start_cut_s", "end_cut_s") if doc["clock"] == "cut" else \
          ("start_source_s", "end_source_s")
    spans = sorted((float(x[key[0]]), float(x[key[1]])) for x in b
                   if x.get(key[0]) is not None and x.get(key[1]) is not None)
    lab = np.full(len(grid), -1, np.int8)
    if not spans:
        return lab, spans
    lo, hi = spans[0][0], spans[-1][1]
    inside = (grid >= lo) & (grid <= hi)
    lab[inside] = 0
    for s, e in spans:
        lab[(grid >= s - IP.SHRINK_S) & (grid <= e + IP.SHRINK_S)] = -1
        lab[(grid >= s + IP.SHRINK_S) & (grid <= e - IP.SHRINK_S)] = 1
    for (s0, e0), (s1, e1) in zip(spans, spans[1:]):
        lab[(grid > e0 + IP.SHRINK_S) & (grid < s1 - IP.SHRINK_S)] = 0
    lab[~inside] = -1
    return lab, spans


def main():
    slugs = sys.argv[1:] or ["cebaa6d4", "c27e196d", "6e1b6ea6", "d59d7610", "9e15ed10"]
    tracks = {}
    for slug in slugs:
        doc = CO.load(slug)
        if doc is None or not doc["wav"]:
            continue
        samples, rate = AC.read_wav(doc["wav"])
        env = EN.envelopes(samples, rate)
        grid, score = score_track(env)
        lab, spans = label_track(doc, grid)
        tracks[slug] = {"grid": grid, "score": score, "lab": lab,
                        "venue": doc["match"]["venue"],
                        "opp": doc["match"]["opponent_name"], "spans": spans}
        rally = float((lab == 1).sum()) * STEP_S
        gap = float((lab == 0).sum()) * STEP_S
        print(f"{slug} {str(doc['match']['venue'])[:14]:14s} "
              f"{str(doc['match']['opponent_name'])[:10]:10s} "
              f"rally {rally:6.0f}s   gap {gap:6.0f}s   "
              f"gap is {gap/(rally+gap)*100:.0f}% of the marked span", flush=True)

    print("\n=== one global threshold, all five matches pooled ===")
    print(" thresh   rally kept   gap dropped   (a rally second lost is the bad one)")
    allscore = np.concatenate([t["score"][t["lab"] >= 0] for t in tracks.values()])
    alllab = np.concatenate([t["lab"][t["lab"] >= 0] for t in tracks.values()])
    for th in np.arange(0.30, 1.21, 0.05):
        keep = float(np.mean(allscore[alllab == 1] >= th))
        drop = float(np.mean(allscore[alllab == 0] < th))
        star = "  <=" if 0.985 <= keep < 0.995 else ""
        print(f"  {th:4.2f}    {keep*100:6.1f}%       {drop*100:6.1f}%{star}")

    print("\n=== per match, at the threshold that keeps 99% of rally overall ===")
    ths = np.arange(0.05, 2.0, 0.01)
    keeps = np.array([np.mean(allscore[alllab == 1] >= t) for t in ths])
    th99 = float(ths[np.argmin(np.abs(keeps - 0.99))])
    print(f"  threshold {th99:.2f}")
    for slug, t in tracks.items():
        s, l = t["score"], t["lab"]
        keep = float(np.mean(s[l == 1] >= th99))
        drop = float(np.mean(s[l == 0] < th99))
        print(f"  {slug} {str(t['venue'])[:14]:14s} {str(t['opp'])[:10]:10s} "
              f"rally kept {keep*100:5.1f}%   gap dropped {drop*100:5.1f}%")

    print("\n=== does it hold on SHORT gaps too? (pooled) ===")
    for lo, hi in ((0, 3), (3, 6), (6, 12), (12, 30), (30, 1e9)):
        got = tot = 0
        for t in tracks.values():
            spans = t["spans"]
            for (s0, e0), (s1, e1) in zip(spans, spans[1:]):
                length = s1 - e0
                if not (lo <= length < hi):
                    continue
                m = (t["grid"] > e0 + IP.SHRINK_S) & (t["grid"] < s1 - IP.SHRINK_S)
                if m.sum() == 0:
                    continue
                got += int((t["score"][m] < th99).sum()); tot += int(m.sum())
        if tot:
            print(f"  gaps {lo:>3}-{hi if hi < 1e9 else '+':>3}s: "
                  f"{got/tot*100:5.1f}% of their seconds correctly dropped "
                  f"({tot*STEP_S:6.0f}s of gap)")
    json.dump({s: {"grid": t["grid"].tolist(), "score": t["score"].tolist(),
                   "lab": t["lab"].tolist(), "venue": t["venue"], "opp": t["opp"]}
               for s, t in tracks.items()},
              open("/Users/adil/ponglens-research-work/inplay_tracks.json", "w"))


if __name__ == "__main__":
    main()
