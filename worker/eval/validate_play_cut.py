"""Dead-space round 4 referee: spans cut vs plays cut on one real video.

Runs the points stage twice on the same blurball detections — legacy
'spans' mode and the new 'plays' mode — and verifies the ONE invariant
that makes the plays cut safe to ship:

  THE EMITTED POINTS MUST BE IDENTICAL. Only the video assembly and the
  cut_t0 mapping may change. Any drift in t0/t1 means the modes are not
  the same detector and the change is broken.

Then reports the retention delta, which is the whole reason this round
exists.

Usage:
  venv/bin/python eval/validate_play_cut.py \
      --video input.mov --workdir /tmp/playcut [--strictness normal]
      [--encode]     # also render both mp4s for eyeballing

blurball.jsonl is reused from workdir if present, else inferred (slow).
"""

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.dirname(HERE)
PIPELINE = os.path.join(WORKER, "points_pipeline.py")
# Same interpreters production uses (worker.py TTVID constants): blurball
# and the pipeline both run under the TTVid vendor venv (numpy+cv2+torch).
TTVID = "/Users/adil/Desktop/Projects/TTVid"
BLURBALL = f"{TTVID}/vendor/blurball_infer.py"
PY = f"{TTVID}/vendor/venv/bin/python"


def run(cmd):
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def load_points(outdir):
    with open(os.path.join(outdir, "match.json")) as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--workdir", required=True)
    ap.add_argument("--strictness", default="normal")
    ap.add_argument("--encode", action="store_true")
    args = ap.parse_args()

    os.makedirs(args.workdir, exist_ok=True)
    bb = os.path.join(args.workdir, "blurball.jsonl")
    if not os.path.exists(bb):
        run([PY, BLURBALL, "--video", args.video, "--out", bb])

    outs = {}
    for mode in ("spans", "plays"):
        outdir = os.path.join(args.workdir, f"points_{mode}")
        run([PY, PIPELINE, "points", "--blurball", bb,
             "--video", args.video, "--outdir", outdir,
             "--strictness", args.strictness, "--cut-mode", mode,
             "--no-clips"])
        outs[mode] = load_points(outdir)

    a, b = outs["spans"], outs["plays"]
    pa = [(p["t0"], p["t1"]) for p in a["points"]]
    pb = [(p["t0"], p["t1"]) for p in b["points"]]
    dur = a["source"]["duration"]

    print("\n================ VERDICT ================")
    ok = pa == pb
    print(f"point parity : {len(pa)} vs {len(pb)} points — "
          f"{'IDENTICAL' if ok else 'DRIFT (FAIL)'}")
    if not ok:
        for i, (x, y) in enumerate(zip(pa, pb)):
            if x != y:
                print(f"  first drift at #{i}: spans={x} plays={y}")
                break
        sys.exit(1)

    segs = b.get("cut_segments") or []
    plays_len = sum(s1 - s0 for s0, s1 in segs)
    # spans-mode cut length: recompute the span list the legacy cut keeps,
    # under the SAME interpreter production uses (numpy lives there).
    spans_src = (
        "import json,sys; sys.path.insert(0, %r); "
        "from points_pipeline import *; "
        "meta=probe(%r); det=load_detections(%r); "
        "pre,post,merge=STRICTNESS[%r]; "
        "gate=activity_gate(det, meta['width'], meta['height']); "
        "spans=activity_spans(det, meta['duration'], meta['fps'], pre, "
        "post, merge, Px(meta['width']), "
        "gate=gate['bbox'] if gate else None); "
        "print(json.dumps(spans))"
    ) % (WORKER, args.video, bb, args.strictness)
    out = subprocess.run([PY, "-c", spans_src], check=True,
                         capture_output=True, text=True)
    spans = json.loads(out.stdout.strip().splitlines()[-1])
    spans_len = sum(s1 - s0 for s0, s1 in spans)

    print(f"source       : {dur:8.1f}s")
    print(f"spans cut    : {spans_len:8.1f}s  ({100*spans_len/dur:5.1f}%)"
          f"  [{len(spans)} segments]")
    print(f"plays cut    : {plays_len:8.1f}s  ({100*plays_len/dur:5.1f}%)"
          f"  [{len(segs)} segments]")
    print(f"removed extra: {spans_len-plays_len:8.1f}s")

    # cut_t0 sanity: every plays-mode cut_t0 must be strictly inside the
    # concatenated segment timeline and non-decreasing.
    cts = [p["cut_t0"] for p in b["points"]]
    assert all(x <= y for x, y in zip(cts, cts[1:])), "cut_t0 not monotonic"
    assert all(0 <= t <= plays_len for t in cts), "cut_t0 out of range"
    print("cut_t0       : monotonic, in range — OK")

    if args.encode:
        for mode, mj in (("spans", None), ("plays", b)):
            out = os.path.join(args.workdir, f"cut_{mode}.mp4")
            cmd = [PY, PIPELINE, "cut", "--blurball", bb,
                   "--video", args.video, "--out", out,
                   "--strictness", args.strictness]
            if mj is not None:
                cmd += ["--segments",
                        os.path.join(args.workdir, "points_plays",
                                     "match.json")]
            run(cmd)
    print("=========================================")


if __name__ == "__main__":
    main()
