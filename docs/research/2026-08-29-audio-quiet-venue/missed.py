"""Rallies the product has no card for, found by ear.

The one strong result of the night is that a rally and the deep middle of
a break are far apart on a long-referenced onset curve — AUC 0.92 to 0.94
within a match. That is useless for trimming a clip, because the seconds
either side of a point sound exactly like the point. But it is not useless
for the opposite job: noticing a rally in a stretch the assembler left
out entirely.

Two things are reported. Recall first, which is the honesty check: the
track must light up on every point the product already has, or the
detector is not describing rallies at all and anything else it says is
noise. Then the leftovers — stretches that score like a rally and sit
outside every card — which are candidates for a human to look at, and are
offered as exactly that rather than as a count of missed points.
"""
import json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN

SLUGS = ["cebaa6d4", "c27e196d", "6e1b6ea6", "d59d7610", "9e15ed10",
         "77fc4dee", "ec6490f4", "7e02fbb9", "5bd279f4", "840b4635",
         "19a1efc7", "a52a6612", "cb0e7027", "d4592913", "6a3777db"]
STEP = 0.25
SMOOTH = 2.0
MIN_LEN = 2.5


def track(env, smooth=SMOOTH):
    t, z = env["times"], env["high"]["z"]
    grid = np.arange(t[0] + smooth / 2, t[-1] - smooth / 2, STEP)
    idx = np.searchsorted(t, np.stack([grid - smooth / 2, grid + smooth / 2]))
    c = np.concatenate([[0.0], np.cumsum(z)])
    return grid, (c[idx[1]] - c[idx[0]]) / np.maximum(idx[1] - idx[0], 1)


def runs_above(grid, score, th, min_len=MIN_LEN):
    on = score >= th
    out, i = [], 0
    while i < len(on):
        if not on[i]:
            i += 1; continue
        j = i
        while j + 1 < len(on) and on[j + 1]:
            j += 1
        if (grid[j] - grid[i]) >= min_len:
            out.append((float(grid[i]), float(grid[j]),
                        float(np.mean(score[i:j + 1]))))
        i = j + 1
    return out


def main():
    report = {}
    print("match                    cards   found   card recall   extra stretches   extra time")
    for slug in SLUGS:
        doc = CO.load(slug)
        if doc is None or not doc["wav"] or doc["clock"] != "source":
            continue
        samples, rate = AC.read_wav(doc["wav"])
        env = EN.envelopes(samples, rate)
        grid, score = track(env)
        cards = sorted((float(p["t0"]), float(p["t1"])) for p in doc["points"]
                       if not p["deleted"] and p["t0"] is not None)
        if len(cards) < 10:
            continue
        # Threshold from the match's own distribution, never from the labels:
        # the cards cover a known share of the file, so take the score that
        # keeps a comparable share and let each venue set its own level.
        covered = sum(b - a for a, b in cards)
        share = min(0.9, covered / (grid[-1] - grid[0]))
        th = float(np.quantile(score, 1 - share))
        segs = runs_above(grid, score, th)
        hit = sum(1 for a, b in cards
                  if any(min(b, e) - max(a, s) > 0.5 for s, e, _m in segs))
        extra = [s for s in segs
                 if not any(min(b, s[1]) - max(a, s[0]) > 0.5 for a, b in cards)]
        extra_s = sum(e - s for s, e, _m in extra)
        report[slug] = {"venue": doc["match"]["venue"],
                        "opp": doc["match"]["opponent_name"],
                        "cards": len(cards), "recall": hit / len(cards),
                        "extra": [{"t0": s, "t1": e, "score": m}
                                  for s, e, m in sorted(extra, key=lambda x: -x[2])[:40]],
                        "n_extra": len(extra), "extra_s": extra_s,
                        "dur": float(grid[-1])}
        print(f"{slug} {str(doc['match']['venue'])[:12]:12s} "
              f"{str(doc['match']['opponent_name'])[:8]:8s} {len(cards):4d}  "
              f"{len(segs):5d}   {hit/len(cards)*100:8.0f}%   "
              f"{len(extra):10d}      {extra_s:6.0f}s", flush=True)
    json.dump(report, open("/Users/adil/ponglens-research-work/missed.json", "w"))
    r = [x for x in report.values()]
    print(f"\n  card recall across {len(r)} matches: "
          f"median {np.median([x['recall'] for x in r])*100:.0f}%, "
          f"worst {min(x['recall'] for x in r)*100:.0f}%")
    print(f"  stretches outside every card: "
          f"{sum(x['n_extra'] for x in r)} totalling "
          f"{sum(x['extra_s'] for x in r)/60:.0f} minutes across the corpus")


if __name__ == "__main__":
    main()
