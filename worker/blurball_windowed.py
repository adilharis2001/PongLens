#!/usr/bin/env python
"""BlurBall inside chosen windows of a video, identical to a full run there.

Hand-marked matches only (spec 2026-09-24, section 5: "Track the ball only
inside the marked points"). An automatic match never runs this file; it runs
blurball_infer.py over every frame exactly as before.

The reviewed wrapper, blurball_infer.py, lives outside this repository (the
release copies it into the payload and rewrites one line). It is loaded here
as a module and never edited. Its model, postprocessor, tracker and affine
helper are used as they are; only its frame loop, which cannot be told to
skip anything, is reproduced below, and only after checking that the wrapper
is byte-for-byte the version this reproduction was written against.

What "identical" means, and why it holds
-----------------------------------------
Three things decide a detection in a full run, and each is kept:

1. Frame numbering. The wrapper numbers frames by decoding every one in
   order. So does this file; outside the windows it only grab()s (decode,
   no colour conversion, no model), so frame f here is frame f there.
2. Raw detections. The model sees non-overlapping triplets that start at
   frame 0, eight to a batch, so batch b is always frames 24b..24b+23. Only
   whole batches are computed here, at the same boundaries, so each one is
   the very tensor the full run builds, and the final partial batch at the
   end of the video is the same partial batch.
3. The tracker, which has one frame of memory: a frame's pick is limited to
   300 px from the previous frame's pick whenever that frame had one. The
   first frames of a window can therefore differ from a full run until both
   runs lose the ball on the same frame, which is certain on any frame whose
   raw detection list is empty (both runs saw the same empty list). Every
   window gets a warm-up before it; after each pass the file checks that
   the warm-up of every window holds such a frame. A window that does not
   is given a longer warm-up and the pass repeats, reusing every batch
   already computed. The last resort computes every batch from frame 0 up
   to the window, which is the full run by definition.

Output: the wrapper's JSONL (one line per frame, frames outside the computed
batches carry no detection), and beside it `<out>.frames.json`: each frame's
presentation time as this decoder read it, the windows, and which frames
were computed. The placement job turns a hand mark's playback seconds into
frame numbers with those times, never with seconds times a frame rate.
"""
from __future__ import annotations

import argparse
import bisect
import hashlib
import importlib.util
import json
import os
import sys
import time

# The wrapper runs from a sealed release; a bytecode cache written beside it
# would change the payload and stop every worker (CLAUDE.md, release rules).
sys.dont_write_bytecode = True

# blurball_infer.py as reviewed on 2026-09-24, with the release's REPO line
# put back to the original before hashing (the release rewrites exactly that
# line; match_release.build). Every live release records this same value as
# adapters.blurball_original_sha256.
REVIEWED_WRAPPER_SHA256 = (
    "cb2e1af40792d9379e6a1fd86843671a4abb93239e8b7be7a4a6c18a9aa9f781"
)
ORIGINAL_REPO_LINE = 'REPO = "/Users/adil/Desktop/Projects/TTVid/vendor/blurball"'
RELEASE_REPO_LINE = 'REPO = os.environ["PONGLENS_BLURBALL_HOME"]'
DEFAULT_WRAPPER = "/Users/adil/Desktop/Projects/TTVid/vendor/blurball_infer.py"

# The wrapper's own defaults, which is how the worker has always called it.
STEP = 3
FRAMES_IN = 3
BATCH = 8
THRESHOLD = 0.5
BLOCK = FRAMES_IN * BATCH

# Warm-ups tried in turn. Measured on twelve cached full-match tracks: the
# frames since the last empty detection list run p90 24-192 and p99 61-449,
# so three seconds settles most windows and thirty settles all but a ball
# held in view for half a minute, which the last resort then covers.
WARMUPS_S = (3.0, 10.0, 30.0)
# First pass only, before any frame time is known: a batch is decided on
# its first frame's time, and 24 frames span under 2.5 s above ~10 fps. A
# batch this misjudges is caught by the coverage check and computed in the
# next pass, which plans from the real frame times.
LOOKAHEAD_S = 2.5


class WrapperChanged(RuntimeError):
    pass


def wrapper_digest(text: str) -> str:
    normalized = text.replace(RELEASE_REPO_LINE, ORIGINAL_REPO_LINE, 1)
    return hashlib.sha256(normalized.encode()).hexdigest()


def load_wrapper(path: str):
    with open(path) as handle:
        text = handle.read()
    digest = wrapper_digest(text)
    if digest != REVIEWED_WRAPPER_SHA256:
        raise WrapperChanged(
            f"blurball_infer.py changed (sha256 {digest}); review "
            "blurball_windowed.py against it before trusting windowed runs")
    spec = importlib.util.spec_from_file_location("ponglens_blurball_wrapper", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, digest


def merge_windows(windows):
    """Sorted, merged [start, end] second ranges; empty or inverted dropped."""
    cleaned = sorted(
        (float(a), float(b)) for a, b in windows if float(b) > float(a))
    merged: list[list[float]] = []
    for a, b in cleaned:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return merged


def frame_span(times, start_s, end_s):
    """Inclusive frame indices whose time lies in [start_s, end_s], or None."""
    first = bisect.bisect_left(times, start_s - 1e-9)
    last = bisect.bisect_right(times, end_s + 1e-9) - 1
    if first > last:
        return None
    return first, last


def plan_blocks(times, windows, warmups, n_frames):
    """Batches needed so every window, with its warm-up, is computed."""
    blocks: set[int] = set()
    for (a, b), warm in zip(windows, warmups):
        if warm is None:  # last resort: everything from frame 0
            span = frame_span(times, float("-inf"), b)
            if span is None:
                continue
            blocks.update(range(0, span[1] // BLOCK + 1))
            continue
        span = frame_span(times, a - warm, b)
        if span is None:
            continue
        blocks.update(range(span[0] // BLOCK, span[1] // BLOCK + 1))
    last_block = (n_frames - 1) // BLOCK if n_frames else -1
    return {block for block in blocks if block <= last_block}


def converged(times, window, computed_blocks, dets_by_frame):
    """True when this window's frames match a full run exactly.

    Every frame of the window must be computed, and somewhere between the
    start of the computed run that reaches the window and the window's first
    frame there must be a frame with no raw detection at all."""
    span = frame_span(times, window[0], window[1])
    if span is None:
        return True
    first, last = span
    for block in range(first // BLOCK, last // BLOCK + 1):
        if block not in computed_blocks:
            return False
    block = first // BLOCK
    while block - 1 in computed_blocks:
        block -= 1
    run_start = block * BLOCK
    if run_start == 0:
        return True
    return any(not dets_by_frame.get(frame) for frame in range(run_start, first + 1))


class Runner:
    def __init__(self, wrapper, device_arg="auto"):
        self.w = wrapper
        torch = wrapper.torch
        if device_arg == "auto":
            device = "mps" if torch.backends.mps.is_available() else "cpu"
        else:
            device = device_arg
        self.device = device
        print(f"device={device} step={STEP} threshold={THRESHOLD}")
        repo = wrapper.REPO
        # Identical to blurball_infer.main() with its default arguments.
        model_cfg = wrapper.OmegaConf.load(
            os.path.join(repo, "src/configs/model/blurball.yaml"))
        cfg = wrapper.OmegaConf.create({
            "model": model_cfg,
            "detector": {
                "name": "blurball",
                "step": STEP,
                "postprocessor": {
                    "name": "blurball",
                    "score_threshold": THRESHOLD,
                    "scales": [0],
                    "blob_det_method": "concomp",
                    "use_hm_weight": True,
                },
            },
            "dataloader": {"heatmap": {"sigmas": [2.5]}},
            "tracker": {"max_disp": 300},
        })
        self.cfg = cfg
        model = wrapper.build_model(cfg)
        ckpt = torch.load(
            os.path.join(repo, "pretrained_weights/blurball_best"),
            map_location="cpu", weights_only=False)
        model.load_state_dict(ckpt["model_state_dict"])
        model.eval().to(device)
        self.model = model
        print(f"loaded weights (epoch {ckpt.get('epoch')}, "
              f"f1 {ckpt.get('video_inference_f1')})")
        self.postproc = wrapper.BlurBallPostprocessor(cfg)
        if int(cfg.model.frames_in) != FRAMES_IN:
            raise WrapperChanged("model frames_in is no longer 3")

    def infer_pass(self, video, decide, computed_blocks, dets_by_frame):
        """One decode of the whole video. Returns (frame times, frame count,
        blocks computed in this pass)."""
        w = self.w
        cv2, np, torch = w.cv2, w.np, w.torch
        cap = cv2.VideoCapture(video)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        n_total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        inp_w, inp_h = int(self.cfg.model.inp_width), int(self.cfg.model.inp_height)
        c = np.array([width / 2.0, height / 2.0], dtype=np.float32)
        s = max(height, width) * 1.0
        trans_inv = w.get_affine_transform(c, s, 0, [inp_w, inp_h], inv=1)
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 1, 3)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 1, 3)

        def preprocess(frame_bgr):
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            rgb = cv2.resize(rgb, (inp_w, inp_h), interpolation=cv2.INTER_AREA)
            x = (rgb.astype(np.float32) / 255.0 - mean) / std
            return torch.from_numpy(x.transpose(2, 0, 1))

        window_tensors, window_starts, buf = [], [], []

        def flush():
            if not window_tensors:
                return
            batch = torch.stack(window_tensors, dim=0).to(self.device)
            with torch.no_grad():
                preds = self.model(batch)
            size = batch.shape[0]
            mats = torch.from_numpy(
                np.broadcast_to(trans_inv, (1, size, 2, 3)).copy())
            results = self.postproc.run(preds, mats)
            for i in sorted(results.keys()):
                start = window_starts[i]
                for j in sorted(results[i].keys()):
                    dets = []
                    for _scale, r in results[i][j].items():
                        for xy, ang, ln, sc in zip(
                                r["xys"], r["angles"], r["lengths"], r["scores"]):
                            dets.append({"xy": xy, "angle": ang, "length": ln,
                                         "score": float(sc)})
                    dets_by_frame[start + j] = dets
            window_tensors.clear()
            window_starts.clear()

        times: list[float] = []
        new_blocks: set[int] = set()
        compute = False
        fidx = 0
        started = time.time()
        while True:
            if not cap.grab():
                break
            times.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0)
            if fidx % BLOCK == 0:
                block = fidx // BLOCK
                compute = block not in computed_blocks and decide(block, times[-1])
                buf = []
                if compute:
                    new_blocks.add(block)
            if compute:
                ok, frame = cap.retrieve()
                if not ok:
                    raise RuntimeError(f"frame {fidx} decoded but not retrieved")
                buf.append(preprocess(frame))
                if len(buf) == FRAMES_IN:
                    window_tensors.append(torch.cat(buf, dim=0))
                    window_starts.append(fidx - FRAMES_IN + 1)
                    buf = []
                    if len(window_tensors) >= BATCH:
                        flush()
            fidx += 1
            if fidx % 600 == 0:
                elapsed = time.time() - started
                print(f"frame {fidx}/{n_total}  {fidx / elapsed:.1f} fps  "
                      f"elapsed {elapsed:.0f}s", flush=True)
        flush()
        cap.release()
        return times, fidx, new_blocks

    def run(self, video, windows, warm_schedule=WARMUPS_S):
        windows = merge_windows(windows)
        warm_steps = [0] * len(windows)
        dets_by_frame: dict[int, list] = {}
        computed: set[int] = set()
        times = None
        n_frames = 0
        passes = 0
        while True:
            passes += 1
            warmups = [warm_schedule[step] if step < len(warm_schedule) else None
                       for step in warm_steps]
            if times is None:
                def decide(_block, first_time):
                    return any(
                        (a - (warm or 0.0) - LOOKAHEAD_S) <= first_time <= b
                        if warm is not None else first_time <= b
                        for (a, b), warm in zip(windows, warmups))
            else:
                planned = plan_blocks(times, windows, warmups, n_frames)

                def decide(block, _first_time, planned=planned):
                    return block in planned
            pass_times, n_frames, new_blocks = self.infer_pass(
                video, decide, computed, dets_by_frame)
            if times is not None and pass_times != times:
                raise RuntimeError("frame times changed between decodes")
            times = pass_times
            computed |= new_blocks
            check_times(times)
            pending = [index for index, window in enumerate(windows)
                       if not converged(times, window, computed, dets_by_frame)]
            print(f"pass {passes}: {len(computed)} of "
                  f"{(n_frames + BLOCK - 1) // BLOCK} batches computed, "
                  f"{len(pending)} window(s) still settling", flush=True)
            if not pending:
                return windows, warmups, times, n_frames, computed, dets_by_frame, passes
            for index in pending:
                warm_steps[index] += 1
            if passes > len(warm_schedule) + 1:
                raise RuntimeError("windowed tracking did not settle")

    def write(self, out, windows, warmups, times, n_frames, computed,
              dets_by_frame, passes, digest):
        tracker = self.w.OnlineTrackerBlur(self.cfg)
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        n_det = 0
        with open(out, "w") as handle:
            for i in range(n_frames):
                dets = dets_by_frame.get(i, [])
                cands = sorted(dets, key=lambda d: -d["score"])[:4]
                alt = [[round(float(d["xy"][0]), 1), round(float(d["xy"][1]), 1),
                        round(float(d["score"]), 3)] for d in cands]
                r = tracker.update(dets)
                if r["visi"]:
                    n_det += 1
                    rec = {"f": i, "x": round(float(r["x"]), 2),
                           "y": round(float(r["y"]), 2),
                           "conf": round(float(r["score"]), 4), "c": alt}
                else:
                    rec = {"f": i, "x": None, "y": None, "conf": 0.0, "c": alt}
                handle.write(json.dumps(rec) + "\n")
        ranges = []
        for block in sorted(computed):
            start, end = block * BLOCK, min(n_frames, (block + 1) * BLOCK)
            if ranges and ranges[-1][1] == start:
                ranges[-1][1] = end
            else:
                ranges.append([start, end])
        sidecar = {
            "v": 1,
            "frame_count": n_frames,
            "frame_times": [round(t, 6) for t in times],
            "windows": windows,
            "warmups_s": warmups,
            "computed_frames": ranges,
            "passes": passes,
            "block": BLOCK,
            "wrapper_sha256": digest,
        }
        with open(sidecar_path(out), "w") as handle:
            json.dump(sidecar, handle, separators=(",", ":"))
        computed_frames = sum(b - a for a, b in ranges)
        print(f"wrote {out}: {n_det}/{n_frames} frames with detection; "
              f"computed {computed_frames} of {n_frames} frames "
              f"({100 * computed_frames / max(n_frames, 1):.1f}%) in "
              f"{passes} pass(es)", flush=True)


def check_times(times):
    """Frame times must climb, or a mark cannot be turned into a frame."""
    if not times:
        raise RuntimeError("the video has no frames")
    if len(times) > 1 and times[-1] <= times[0]:
        raise RuntimeError("the decoder reported no frame timestamps")
    if any(b < a for a, b in zip(times, times[1:])):
        raise RuntimeError("the decoder reported frame timestamps out of order")


def sidecar_path(out: str) -> str:
    return out + ".frames.json"


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--windows", required=True,
                        help="JSON file holding [[start_s, end_s], ...]")
    parser.add_argument("--wrapper", default=os.environ.get(
        "PONGLENS_BLURBALL_INFER", DEFAULT_WRAPPER))
    parser.add_argument("--device", default="auto", choices=["auto", "mps", "cpu"])
    # Only for proving equality against a full run: short warm-ups force the
    # later passes and the last resort to run on real footage.
    parser.add_argument("--warmups", default=None,
                        help="comma-separated warm-up seconds (default: %s)"
                        % ",".join(str(w) for w in WARMUPS_S))
    args = parser.parse_args(argv)
    schedule = (tuple(float(v) for v in args.warmups.split(","))
                if args.warmups else WARMUPS_S)
    with open(args.windows) as handle:
        windows = json.load(handle)
    wrapper, digest = load_wrapper(args.wrapper)
    runner = Runner(wrapper, args.device)
    result = runner.run(args.video, windows, schedule)
    runner.write(args.out, *result, digest)


if __name__ == "__main__":
    main()
