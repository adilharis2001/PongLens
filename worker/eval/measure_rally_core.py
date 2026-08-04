"""Dead-space round 5 measurement: how fat are the point windows?

For every emitted point, find the RALLY CORE from raw detection
kinematics — first SUSTAINED fast-ball run (the serve flight) to the last
fast detection (the rally's final flight) — and measure how much of
[t0, t1] lies outside it. This is the window fatness the plays cut
(round 4) cannot touch: pre-serve ball bouncing chained onto the head,
retrieval walking chained onto the tail.

Deliberately homography-free. Table calibration fails regularly in the
wild (it failed on this very eval match), so a trim rule that needs H
would die exactly where placement already dies. Fast steps (px.fast,
the pipeline's own threshold) exist on every match.

Measurement only — nothing here changes the pipeline.

Usage (TTVid venv, same as production):
  vendor/venv/bin/python eval/measure_rally_core.py \
      --blurball .../blurball.jsonl --match-json .../match.json
"""

import argparse
import json
import os
import sys

HEAD_PAD_S = 0.5     # before the serve flight's first frame
TAIL_PAD_S = 1.0     # reaction time after the last rally flight
MIN_RUN = 6          # frames of sustained fast motion = a real flight
                     # (round 3: real points measured runs as low as 6)
RUN_GAP = 3          # frames of tracking dropout tolerated inside a run


def fast_times(det, f0, f1, fps, fast_px):
    """Times of fast ball steps inside [f0, f1)."""
    out = []
    for f in range(f0, f1):
        a, b = det.get(f), det.get(f - 1)
        if a and b and ((a[0]-b[0])**2 + (a[1]-b[1])**2) ** 0.5 > fast_px:
            out.append(f)
    return out


def first_sustained_run(fast, min_run=MIN_RUN, gap=RUN_GAP):
    """First frame of the first run of >= min_run fast frames."""
    if not fast:
        return None
    run_start, run_len, prev = fast[0], 1, fast[0]
    for f in fast[1:]:
        if f - prev <= gap:
            run_len += 1
        else:
            run_start, run_len = f, 1
        if run_len >= min_run:
            return run_start
        prev = f
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blurball", required=True)
    ap.add_argument("--match-json", required=True)
    args = ap.parse_args()

    worker_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, worker_dir)
    from points_pipeline import (Px, SEGMENT_PADS, load_detections,
                                 play_cut_segments)

    with open(args.match_json) as fh:
        mj = json.load(fh)
    det = load_detections(args.blurball)
    fps = mj["source"]["fps"]
    px = Px(mj["source"]["width"])
    dur = mj["source"]["duration"]

    rows, unfit = [], 0
    for p in mj["points"]:
        t0, t1 = p["t0"], p["t1"]
        f0, f1 = int(t0 * fps), int(t1 * fps)
        fast = fast_times(det, f0, f1, fps, px.fast)
        start_f = first_sustained_run(fast)
        if start_f is None:
            unfit += 1
            rows.append((t0, t1, t0, t1, False))    # recall first
            continue
        core0 = max(t0, start_f / fps - HEAD_PAD_S)
        core1 = min(t1, fast[-1] / fps + TAIL_PAD_S)
        if core1 <= core0:
            core0, core1 = t0, t1
        rows.append((t0, t1, core0, core1, True))

    full = sum(t1 - t0 for t0, t1, *_ in rows)
    core = sum(c1 - c0 for _, _, c0, c1, _ in rows)
    heads = sorted(c0 - t0 for t0, t1, c0, c1, ok in rows if ok)
    tails = sorted(t1 - c1 for t0, t1, c0, c1, ok in rows if ok)

    def pct(x):
        return 100.0 * x / dur

    print(f"points          : {len(rows)}  (no sustained flight, "
          f"kept whole: {unfit})")
    print(f"source          : {dur:8.1f}s")
    print(f"window time     : {full:8.1f}s  ({pct(full):5.1f}% of source)")
    print(f"core time       : {core:8.1f}s  ({pct(core):5.1f}% of source)")
    print(f"trimmable fat   : {full-core:8.1f}s")
    for name, a in (("head fat", heads), ("tail fat", tails)):
        if a:
            n = len(a)
            print(f"{name:15} : median {a[n//2]:5.2f}s   p90 "
                  f"{a[int(n*0.9)]:5.2f}s   max {a[-1]:5.2f}s")

    head, tail = SEGMENT_PADS[mj["options"]["strictness"]]
    now = sum(s1 - s0 for s0, s1 in play_cut_segments(
        [(t0, t1) for t0, t1, *_ in rows], dur, head, tail))
    trimmed = sum(s1 - s0 for s0, s1 in play_cut_segments(
        [(c0, c1) for _, _, c0, c1, _ in rows], dur, head, tail))
    print(f"plays cut now   : {now:8.1f}s  ({pct(now):5.1f}%)")
    print(f"core-trimmed cut: {trimmed:8.1f}s  ({pct(trimmed):5.1f}%)")


if __name__ == "__main__":
    main()
