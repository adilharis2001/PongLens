"""Running per-frame aggregates over whatever match JSONs exist so far.

    venv/bin/python stats.py --tag full_v1
"""

from __future__ import annotations

import argparse
import glob
import json
import os
from collections import defaultdict

import numpy as np

import common


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="full_v1")
    args = ap.parse_args()
    out_dir = os.path.join(common.WORK, "out", args.tag)

    errs, stage1, zoomed, by_venue = [], [], [], defaultdict(list)
    fails, worst = 0, []
    for path in sorted(glob.glob(os.path.join(out_dir, "*.json"))):
        if os.path.basename(path).startswith("consensus"):
            continue
        data = json.load(open(path))
        for f in data["frames"]:
            if not f.get("ok"):
                fails += 1
                continue
            e = f["score"]["err_pct"]
            errs.append(e)
            by_venue[data["venue"]].append(e)
            if "err_stage1" in f:
                stage1.append(f["err_stage1"])
            if "err_zoom" in f:
                zoomed.append(f["err_zoom"])
            worst.append((e, data["match"][:8], f["frame"],
                          f.get("picked_prompt")))
    if not errs:
        print("nothing yet")
        return
    errs_np = np.array(errs)
    print(f"{args.tag}: {len(errs)} frames ok, {fails} failed")
    print(f"  final : median {np.median(errs_np):.2f}%  "
          f"mean {errs_np.mean():.2f}%  "
          f"gross>5% {(errs_np > 5).sum()} ({100*(errs_np > 5).mean():.0f}%)"
          f"  good<1% {(errs_np < 1).sum()} ({100*(errs_np < 1).mean():.0f}%)")
    if stage1:
        s = np.array(stage1)
        print(f"  stage1: median {np.median(s):.2f}%  gross {(s > 5).sum()}")
    if zoomed:
        z = np.array(zoomed)
        print(f"  zoom  : median {np.median(z):.2f}%  gross {(z > 5).sum()}")
    print("  by venue:")
    for v, es in sorted(by_venue.items()):
        es = np.array(es)
        print(f"    {v:<18} n={len(es):<4} median {np.median(es):.2f}%  "
              f"gross {(es > 5).sum()}")
    print("  worst frames:")
    for e, m, fr, prompt in sorted(worst, reverse=True)[:10]:
        print(f"    {e:6.2f}%  {m} {fr} ({prompt})")


if __name__ == "__main__":
    main()
