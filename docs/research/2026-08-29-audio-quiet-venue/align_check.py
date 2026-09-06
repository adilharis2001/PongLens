"""Find the offset between the audio and the event times, per point.

Rather than trusting any arithmetic about clocks, this slides the visual
event times against the audio peaks over a few seconds either way and
reports the offset with the most agreement. A constant offset across all
points means one formula is wrong by a constant. Offsets that scatter
point by point mean the two are not on a shared clock at all, and no
constant can fix it.

A flat curve with no clear winner means the audio and the events have
nothing to do with each other, which is its own answer.
"""
import os, sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN

TOL = 0.045
GRID = np.arange(-4.0, 4.001, 0.010)


def main():
    for slug in sys.argv[1:]:
        doc = CO.load(slug)
        if doc is None or not doc["wav"]:
            print(f"{slug}: no audio"); continue
        samples, rate = AC.read_wav(doc["wav"])
        env = EN.envelopes(samples, rate)
        t, z = env["times"], env["high"]["z"]
        idx = EN.peaks(z, rate, 6.0)
        pt = t[idx]
        conv = CO.to_audio_clock(doc)
        by_point = defaultdict(list)
        for e in doc["events"]:
            if e["kind"] not in ("bounce", "contact") or (e["vis"] or 0) < 0.7:
                continue
            ta = conv(e)
            if ta is not None:
                by_point[e["point_id"]].append(ta)
        # global
        allv = np.array(sorted(x for v in by_point.values() for x in v))
        def score(shift, vals):
            if len(vals) == 0: return 0.0
            q = vals + shift
            j = np.searchsorted(pt, q)
            d = np.full(len(q), 1e9)
            for off in (-1, 0):
                k = np.clip(j + off, 0, len(pt) - 1)
                d = np.minimum(d, np.abs(q - pt[k]))
            return float(np.mean(d <= TOL))
        curve = np.array([score(s, allv) for s in GRID])
        best = GRID[int(np.argmax(curve))]
        print(f"\n=== {slug} {doc['match']['venue']} / {doc['match']['opponent_name']} "
              f"({doc['clock']} clock) ===")
        print(f"  {len(allv)} visual events, {len(pt)} audio peaks over "
              f"{len(samples)/rate:.0f}s")
        print(f"  best global shift {best:+.3f}s -> {curve.max()*100:.0f}% agree "
              f"(at 0.000s: {score(0.0, allv)*100:.0f}%, "
              f"floor {np.median(curve)*100:.0f}%)")
        # per point
        offs, gains = [], []
        for pid, vals in by_point.items():
            v = np.array(sorted(vals))
            if len(v) < 6:
                continue
            c = np.array([score(s, v) for s in GRID])
            if c.max() < 0.5:
                continue
            offs.append(GRID[int(np.argmax(c))]); gains.append(c.max())
        if offs:
            offs = np.array(offs)
            print(f"  {len(offs)} points align above 50%: shift median "
                  f"{np.median(offs):+.3f}s, spread (MAD) "
                  f"{np.median(np.abs(offs - np.median(offs))):.3f}s, "
                  f"range {offs.min():+.2f}..{offs.max():+.2f}")
        else:
            print("  no single point aligns above 50% at any shift")


if __name__ == "__main__":
    main()
