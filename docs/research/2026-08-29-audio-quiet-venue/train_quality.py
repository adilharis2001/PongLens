"""How clean is the audio event train, venue by venue?

This is the crux of the whole question. Audio hears a sharp knock; vision
sees the ball touch something. Where they agree, audio is describing this
table. Where audio fires and vision saw nothing, audio is describing the
room — a shoe, a neighbour's table, a chair.

The previous study measured only one direction: 87% of production's own
visual bounces have an audio peak within 30 ms. That is RECALL, and it was
never the problem. The number nobody had was PRECISION — of the knocks
audio reports during a rally, how many are this table's ball at all.

Measured strictly inside rally windows, so gap noise is not being counted
against it, and at a matched peak density per venue so the comparison is
about selectivity rather than about who set the threshold lower.

Vision misses events too, so precision here is a floor, not a verdict. The
comparison between venues at one setting is the point.
"""
import json, os, sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN

TOL_S = 0.045
MIN_VIS = 0.7


def rally_windows(doc):
    """Where a rally was certainly running, on the audio's clock."""
    cut = doc["clock"] == "cut"
    key = ("start_cut_s", "end_cut_s") if cut else ("start_source_s", "end_source_s")
    wins = [(float(b[key[0]]), float(b[key[1]])) for b in doc["boundaries"]
            if not b.get("deleted") and b.get(key[0]) is not None
            and b.get(key[1]) is not None]
    if wins:
        return sorted(wins), "taps"
    # No taps for this match: fall back to the assembler's own card windows,
    # tightened, which is a weaker ruler and is labelled as such.
    out = []
    for p in doc["points"]:
        if p["deleted"] or p["t0"] is None or p["t1"] is None:
            continue
        if cut and p["cut_t0"] is None:
            continue
        pre = float(doc["match"].get("pre_pad") or 1.2)
        off = (float(p["cut_t0"]) + pre - float(p["t0"])) if cut else 0.0
        out.append((float(p["t0"]) + off + 1.0, float(p["t1"]) + off - 1.0))
    return sorted(w for w in out if w[1] > w[0]), "cards"


def main():
    slugs = sys.argv[1:] or CO.all_slugs()
    rows = []
    for slug in slugs:
        doc = CO.load(slug)
        if doc is None or not doc["wav"]:
            continue
        wins, ruler = rally_windows(doc)
        if not wins:
            continue
        samples, rate = AC.read_wav(doc["wav"])
        env = EN.envelopes(samples, rate)
        t, z = env["times"], env["high"]["z"]
        conv = CO.to_audio_clock(doc)
        vis = sorted(x for x in
                     (conv(e) for e in doc["events"]
                      if e["kind"] in ("bounce", "contact") and (e["vis"] or 0) >= MIN_VIS)
                     if x is not None)
        vis = np.array(vis)
        if len(vis) < 40:
            continue
        total = sum(b - a for a, b in wins)
        # peak density is matched across venues by choosing the threshold
        # that yields the same number of peaks per rally second
        # Pick once at the bottom; a higher threshold is just a subset.
        base = EN.peaks(z, rate, 2.0)
        base_t, base_z = t[base], z[base]
        inwin_mask = np.zeros(len(base), bool)
        for a, b in wins:
            inwin_mask |= (base_t >= a) & (base_t <= b)
        best = {}
        for target in (2.0, 3.0, 4.0):
            want = int(round(target * total))
            cand = np.sort(base_z[inwin_mask])[::-1]
            if len(cand) == 0:
                continue
            th = float(cand[min(want, len(cand)) - 1])
            pt = base_t[base_z >= th]
            keep = np.zeros(len(pt), bool)
            for a, b in wins:
                keep |= (pt >= a) & (pt <= b)
            pt = pt[keep]
            vkeep = np.zeros(len(vis), bool)
            for a, b in wins:
                vkeep |= (vis >= a) & (vis <= b)
            vv = vis[vkeep]
            if len(pt) == 0 or len(vv) == 0:
                continue
            j = np.searchsorted(vv, pt)
            d = np.full(len(pt), 1e9)
            for off in (-1, 0):
                k = np.clip(j + off, 0, len(vv) - 1)
                d = np.minimum(d, np.abs(pt - vv[k]))
            prec = float(np.mean(d <= TOL_S))
            j2 = np.searchsorted(pt, vv)
            d2 = np.full(len(vv), 1e9)
            for off in (-1, 0):
                k = np.clip(j2 + off, 0, len(pt) - 1)
                d2 = np.minimum(d2, np.abs(vv - pt[k]))
            rec = float(np.mean(d2 <= TOL_S))
            best[target] = (th, prec, rec, len(pt), len(vv))
        if 3.0 not in best:
            continue
        th, prec, rec, npk, nvis = best[3.0]
        rows.append({"slug": slug, "venue": doc["match"]["venue"],
                     "opp": doc["match"]["opponent_name"], "ruler": ruler,
                     "rally_s": total, "z_for_3ps": th,
                     "prec": prec, "rec": rec, "npk": npk, "nvis": nvis,
                     "all": {str(k): v for k, v in best.items()}})
        print(f"{slug} {str(doc['match']['venue'])[:15]:15s} "
              f"{str(doc['match']['opponent_name'])[:10]:10s} {ruler:5s} "
              f"rally {total:5.0f}s  z@3/s {th:5.1f}  "
              f"precision {prec*100:4.0f}%  recall {rec*100:4.0f}%  "
              f"({npk} peaks vs {nvis} seen)", flush=True)
    json.dump(rows, open("/Users/adil/ponglens-research-work/train_quality.json", "w"))
    print("\n=== by venue, at 3 audio peaks per rally second ===")
    by = defaultdict(list)
    for r in rows:
        by[str(r["venue"])].append(r)
    for venue, rs in sorted(by.items(), key=lambda kv: -np.mean([r["prec"] for r in kv[1]])):
        print(f"  {venue[:18]:18s} {len(rs)} matches   "
              f"precision {np.mean([r['prec'] for r in rs])*100:4.0f}%   "
              f"recall {np.mean([r['rec'] for r in rs])*100:4.0f}%   "
              f"threshold z {np.mean([r['z_for_3ps'] for r in rs]):.1f}")


if __name__ == "__main__":
    main()
