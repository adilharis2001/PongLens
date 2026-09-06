"""Tune the rally-span rule against point_boundaries, the curated ruler.

point_boundaries is the documented statement of when a point ran: Adil's
serve tap and his winner tap, already converted onto both clocks. It is
the thing to measure against rather than the raw columns.

Three knobs: how loud a knock has to be to count, how far apart two
knocks can be and still belong to the same rally, and how many knocks
make a rally. Reported per venue, because the whole reason for this study
is that a booth and a hall are not the same room.
"""
import itertools, json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN
from rallyspan import rally_span

SLUGS = ["cebaa6d4", "c27e196d", "6e1b6ea6", "d59d7610", "9e15ed10"]
PAD = 4.0     # look this far either side of the marked span


def load_all():
    out = {}
    for slug in SLUGS:
        doc = CO.load(slug)
        if doc is None or not doc["wav"]:
            continue
        samples, rate = AC.read_wav(doc["wav"])
        env = EN.envelopes(samples, rate)
        key = ("start_cut_s", "end_cut_s") if doc["clock"] == "cut" else \
              ("start_source_s", "end_source_s")
        spans = [(float(b[key[0]]), float(b[key[1]]))
                 for b in doc["boundaries"]
                 if not b.get("deleted") and b.get(key[0]) is not None
                 and b.get(key[1]) is not None]
        out[slug] = (env, doc, sorted(spans))
        print(f"loaded {slug}: {len(spans)} marked points", flush=True)
    return out


def evaluate(data, z_on, max_gap, min_run):
    per = {}
    for slug, (env, doc, spans) in data.items():
        ds, de, miss = [], [], 0
        for s, e in spans:
            r = rally_span(env, s - PAD, e + PAD, z_on, max_gap, min_run)
            if r is None:
                miss += 1; continue
            ds.append(r["start"] - s); de.append(r["end"] - e)
        per[slug] = {"venue": doc["match"]["venue"], "n": len(spans), "miss": miss,
                     "ds": np.array(ds), "de": np.array(de)}
    return per


def main():
    data = load_all()
    print("\n z_on gap  run | " + " | ".join(f"{s[:8]}" for s in data))
    print("             | " + " | ".join("start<1s end<1s" for _ in data))
    best = None
    for z_on, max_gap, min_run in itertools.product(
            (5.0, 6.0, 8.0, 10.0, 12.0), (0.9, 1.1, 1.3, 1.6), (3, 4, 6)):
        per = evaluate(data, z_on, max_gap, min_run)
        cells, quiet = [], []
        for slug, r in per.items():
            a = np.mean(np.abs(r["ds"]) < 1.0) if len(r["ds"]) else 0
            b = np.mean(np.abs(r["de"]) < 1.0) if len(r["de"]) else 0
            cells.append(f"  {a*100:5.0f}%  {b*100:5.0f}%")
            if r["venue"] and "ing" in str(r["venue"]).lower():
                quiet.append((a + b) / 2)
        s = float(np.mean(quiet)) if quiet else 0.0
        print(f" {z_on:4.1f} {max_gap:.1f} {min_run:3d} |" + " |".join(cells) +
              f"   pingpod {s*100:5.1f}%", flush=True)
        if best is None or s > best[0]:
            best = (s, z_on, max_gap, min_run, per)
    s, z_on, max_gap, min_run, per = best
    print(f"\n=== best for the quiet venue: z>={z_on}, gap<={max_gap}s, "
          f"at least {min_run} knocks ===")
    for slug, r in per.items():
        ds, de = r["ds"], r["de"]
        print(f"  {slug} {str(r['venue'])[:12]:12s} n={r['n']:3d} miss={r['miss']:2d}  "
              f"start med {np.median(ds):+5.2f}s  |err|<1s {np.mean(np.abs(ds)<1)*100:4.0f}%   "
              f"end med {np.median(de):+5.2f}s  |err|<1s {np.mean(np.abs(de)<1)*100:4.0f}%")
    json.dump({"z_on": z_on, "max_gap": max_gap, "min_run": min_run},
              open("/Users/adil/ponglens-research-work/span_best.json", "w"))


if __name__ == "__main__":
    main()
