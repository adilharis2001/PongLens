"""Where does the rally actually start and stop inside a clip?

The dead space that still costs the product is not the long break between
points — the assembler already drops most of that. It is the pad at each
end of a kept clip: the seconds before the serve and after the point,
which the memo on dead space calls Kind 3 and puts at 29% of everything
kept. Its stated blocker is a serve detector.

A rally is a run of loud knocks with small gaps between them. Before it
there is a quieter stretch; after it the ball is on the floor and someone
is walking. So: take the card window, find the longest run of onsets whose
neighbours are close together, and call its first and last members the
start and the end of the rally.

Judged against Adil's own taps. Those are only good to about 0.7 s, which
is stated plainly in the project notes and is the reason nothing here
claims a tighter number than that — but 0.7 s is ample for deciding where
to put a cut, which is all this is for.
"""
import json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN

Z_ON = 6.0           # a knock has to be this far above the venue's own floor
MAX_GAP_S = 1.30     # neighbouring strikes in a rally are closer than this
MIN_RUN = 4          # a rally is at least this many knocks


def rally_span(env, t0, t1, z_on=Z_ON, max_gap=MAX_GAP_S, min_run=MIN_RUN):
    t, z, rate = env["times"], env["high"]["z"], env["rate"]
    m = (t >= t0) & (t <= t1)
    if m.sum() < 16:
        return None
    idx = EN.peaks(z[m], rate, z_on)
    if len(idx) < min_run:
        return None
    times = t[m][idx]
    amps = z[m][idx]
    runs, start = [], 0
    for i in range(1, len(times)):
        if times[i] - times[i - 1] > max_gap:
            runs.append((start, i)); start = i
    runs.append((start, len(times)))
    best = max(runs, key=lambda r: (r[1] - r[0] >= min_run,
                                    float(amps[r[0]:r[1]].sum())))
    a, b = best
    if b - a < min_run:
        return None
    return {"start": float(times[a]), "end": float(times[b - 1]),
            "n": int(b - a), "energy": float(amps[a:b].sum()),
            "all_n": int(len(times))}


def main():
    slugs = sys.argv[1:] or ["cebaa6d4", "c27e196d", "6e1b6ea6", "d59d7610", "9e15ed10"]
    dump = {}
    print("match                     n   START vs his serve tap        END vs his winner tap")
    print("                              med    |err|<0.5  <1.0  <2.0    med    <0.5  <1.0  <2.0")
    for slug in slugs:
        doc = CO.load(slug)
        if doc is None or not doc["wav"]:
            print(f"{slug}: no audio"); continue
        samples, rate = AC.read_wav(doc["wav"])
        env = EN.envelopes(samples, rate)
        cut = doc["clock"] == "cut"
        rows = []
        for p in doc["points"]:
            if p["deleted"] or p["t0"] is None or p["t1"] is None:
                continue
            if cut:
                if p["cut_t0"] is None:
                    continue
                off = float(p["cut_t0"]) - float(p["t0"])
            else:
                off = 0.0
            t0, t1 = float(p["t0"]) + off, float(p["t1"]) + off
            span = rally_span(env, t0, t1)
            if span is None:
                rows.append({"idx": p["idx"], "found": False}); continue
            serve = p["serve_src"]; scored = p["scored_src"]
            rows.append({
                "idx": p["idx"], "found": True,
                "t0": t0, "t1": t1, "start": span["start"], "end": span["end"],
                "n": span["n"],
                "serve": (float(serve) + off) if serve is not None else None,
                "scored": (float(scored) + off) if scored is not None else None,
            })
        dump[slug] = {"venue": doc["match"]["venue"],
                      "opp": doc["match"]["opponent_name"],
                      "clock": doc["clock"], "rows": rows}
        ds = np.array([r["start"] - r["serve"] for r in rows
                       if r.get("found") and r.get("serve") is not None])
        de = np.array([r["end"] - r["scored"] for r in rows
                       if r.get("found") and r.get("scored") is not None])
        def frac(a, k):
            return f"{np.mean(np.abs(a) < k)*100:5.0f}%" if len(a) else "    -"
        found = sum(1 for r in rows if r.get("found"))
        print(f"{slug} {str(doc['match']['venue'])[:12]:12s} {found:3d}/{len(rows):3d} "
              f"{np.median(ds):+6.2f} {frac(ds,0.5)} {frac(ds,1.0)} {frac(ds,2.0)}   "
              f"{np.median(de) if len(de) else float('nan'):+6.2f} "
              f"{frac(de,0.5)} {frac(de,1.0)} {frac(de,2.0)}", flush=True)
    json.dump(dump, open("/Users/adil/ponglens-research-work/rallyspan.json", "w"))


if __name__ == "__main__":
    main()
