"""Table corners from a keypoint network, pooled over sixteen frames.

Runs as its own process under its own interpreter. `points_pipeline` shells
out to it and reads the JSON back, for two reasons: the model needs torch and
a token-merging segmentation backbone that the shared TTVid environment does
not carry and must not be made to carry, and loading the network once for
sixteen frames costs three seconds while loading it sixteen times would cost
fifty.

    python table_keypoints.py --video match.mp4 --out calib.json

What it prints to stdout is progress for the worker log. The answer is the
JSON file.

WHY SIXTEEN FRAMES
------------------
One frame is wrong about the table 13.2% of the time. Sixteen frames, pooled
with the rule in table_keypoint_fit.pool_frames, is wrong 0.2% of the time.
Sixteen is not where the accuracy curve flattens — it is where the WORST
random draw stops being catastrophic: 25% error at fifteen frames or fewer,
3.8% at sixteen. Measured over 660 frames from 33 matches; see
docs/research/2026-08-16-table-detection/CONVERGENCE_FINDINGS.md.

Do not make the frame count adaptive. Early stopping on agreement is exactly
the failure mode this design exists to avoid: at four frames one match in the
study has a 35.7% chance of a confident WRONG answer, and in those cases the
frames agree with each other. Escalate models, not frame counts.

LICENCE
-------
The network is from Uplifting Table Tennis (WACV 2026), GPL-3.0, and lives
OUTSIDE this repository along with its weights — see PONGLENS_TABLE_KEYPOINT_HOME.
Running it server-side is not distribution and there is no Affero clause, so
nothing here obliges PongLens to publish source. It must never be bundled
into anything a user downloads.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import table_keypoint_fit as fit  # noqa: E402

# The canvas the network is evaluated on. Its heatmaps are indexed to this
# frame, not to the video's own size, so every quad comes back in these
# coordinates and is rescaled once at the end.
CANVAS = (1920, 1080)
DEFAULT_FRAMES = 16

# Where the GPL model and its weights live. Outside the repo on purpose:
# the weights are a separate download under no stated licence, and a public
# repository is the wrong place for either of them.
MODEL_HOME = os.environ.get(
    "PONGLENS_TABLE_KEYPOINT_HOME",
    "/Users/adil/ponglens-models/table-keypoints",
)
MODEL_NAME = os.environ.get("PONGLENS_TABLE_KEYPOINT_MODEL", "segformerpp_b0")


def load_model(device="cpu"):
    """The table-keypoint network, its preprocessing transform, and a device.

    Deliberately avoids the upstream `interface.py`, which drags in the ball
    detector, the uplifting model, tensorboard and hard-coded dataset paths.
    """
    import torch

    os.environ.setdefault("TORCH_HOME", os.path.join(MODEL_HOME, "torchhub"))
    repo = os.path.join(MODEL_HOME, "repo")
    weights = os.path.join(MODEL_HOME, "weights")
    if not os.path.isdir(repo):
        raise RuntimeError(f"table keypoint model not installed at {MODEL_HOME}")
    sys.path.insert(0, repo)

    # segformer_pp.py calls torch.hub.load without trust_repo, which prompts
    # on stdin and dies under a non-interactive runner.
    original_hub_load = torch.hub.load

    def hub_load(*args, **kwargs):
        if os.environ.get("PONGLENS_MATCH_RELEASE"):
            # No remote repository lookup or mutable cache in a sealed run.
            if not args or args[0] != "KieDani/SegformerPlusPlus":
                raise RuntimeError("unrecognised table backbone dependency")
            local = os.path.join(MODEL_HOME, "torchhub", "hub",
                                 "KieDani_SegformerPlusPlus_main")
            if not os.path.isfile(os.path.join(local, "hubconf.py")):
                raise RuntimeError("sealed table backbone missing")
            args = (local, *args[1:])
            kwargs["source"] = "local"
            # The full table checkpoint below supplies every trained weight.
            # Upstream hardcodes pretrained=True even with pretraining=False;
            # bypass that redundant ImageNet download in a sealed process.
            kwargs["pretrained"] = False
        kwargs.setdefault("trust_repo", True)
        return original_hub_load(*args, **kwargs)

    torch.hub.load = hub_load

    import paths
    paths.weights_path = weights          # hrnet.py reads this unconditionally
    from tabledetection.transforms import get_transform

    checkpoint_path = os.path.join(
        weights, "inference_tabledetection", MODEL_NAME, "model.pt")
    checkpoint = torch.load(checkpoint_path, map_location="cpu",
                            weights_only=False)
    name = checkpoint["additional_info"]["model_name"]
    resolution = checkpoint["additional_info"]["image_resolution"]

    if "segformerpp" not in name:
        raise RuntimeError(f"unsupported table keypoint model: {name}")
    from tabledetection.models.segformer_pp import Segformer_pp
    # pretraining=False skips the ImageNet download the constructor would
    # otherwise make. The trained checkpoint below specifies every weight in
    # this model — it loads with nothing missing and nothing unexpected — so
    # the ImageNet initialisation would be overwritten in full anyway, and
    # depending on a network fetch to build a model we already have on disk
    # is how an offline worker stops calibrating.
    model = Segformer_pp(model_size=name.split("_")[1], pretraining=False)

    missing, unexpected = model.load_state_dict(
        checkpoint["model_state_dict"], strict=False)
    if missing or unexpected:
        raise RuntimeError(
            f"table keypoint weights do not match the model: "
            f"{len(missing)} missing, {len(unexpected)} unexpected")

    model.eval()
    model.to(torch.device(device))
    return model, get_transform("test", resolution), torch.device(device)


class TableCornerDetector:
    """One frame in, one table quad out, in that frame's own pixels."""

    def __init__(self, device="cpu"):
        # CPU only, and not as a preference. MPS aborts with SIGABRT inside
        # Metal on the first inference, reproducibly, killing the whole
        # process. 237 consecutive CPU inferences ran with zero failures.
        self.model, self.transform, self.device = load_model(device)

    def candidates(self, image):
        """Every table this frame supports, in the frame's own pixels.

        One inference, all the answers. Which of them is the table being
        played on is decided by the crop ladder in calibrate_video.
        """
        import einops
        import torch

        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        data = self.transform({"image": rgb})
        tensor = einops.rearrange(data["image"], "h w c -> c h w")
        batch = torch.tensor(tensor.astype(np.float32)).unsqueeze(0)
        with torch.no_grad():
            prediction = self.model(batch.to(self.device))
        heatmap = prediction[0].float().cpu().numpy()

        height, width = image.shape[:2]
        sx, sy = width / CANVAS[0], height / CANVAS[1]
        tables = fit.fit_tables(heatmap, canvas=CANVAS)
        for table in tables:
            table["quad"] = [[x * sx, y * sy] for x, y in table["quad"]]
        return tables

    def __call__(self, image):
        """This frame's own best answer, by the historical rule."""
        return fit.select_one(self.candidates(image))


def sample_frames(video_path, count=DEFAULT_FRAMES):
    """Evenly spaced frames from the middle of the video.

    The first and last few per cent are skipped: they hold the camera being
    positioned, someone walking up to press record, and whatever the phone
    was pointing at on the way down.
    """
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError("could not open video for table calibration")
    try:
        total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if total <= 0:
            raise RuntimeError("video reports no frames")
        first, last = int(total * 0.04), int(total * 0.96)
        if last <= first:
            first, last = 0, max(0, total - 1)
        wanted = sorted({int(round(v))
                         for v in np.linspace(first, last, min(count, total))})
        frames = []
        for index in wanted:
            capture.set(cv2.CAP_PROP_POS_FRAMES, index)
            ok, image = capture.read()
            if ok and image is not None:
                frames.append((index, image))
        return frames
    finally:
        capture.release()


# THE CROP LADDER (Adil, 2026-09-18). Tightest first, widening only when the
# tighter view finds no table at all.
#
# A frame cannot tell a busy table from an idle one, and neither can a score:
# the per-frame rule prefers whichever table has all eleven landmarks visible,
# which is the table nobody is standing in front of, and a wide lens makes that
# one bigger too. On match 3794e632 (eight tables in a tournament hall) it
# chose an EMPTY table 68% of the way to the right edge, in 16 frames of 16,
# reporting 2.2px of agreement.
#
# Ranking the candidates instead was tried and REJECTED on measurement: a rule
# preferring the more central table picked a NEIGHBOUR on two hand-marked
# matches, because in a club the table beside yours is often nearer the middle
# of your shot than your own (Ali's real table sits 18% off centre against a
# neighbour at 5%; Ishaan's 11% against 2%). No support threshold separated
# those cases from 3794e632 either.
#
# Cropping works where ranking failed because it does not argue about which
# table is better. It removes the neighbour from the picture, and the geometry
# rule that has always rejected a quad with a corner outside the frame does the
# rest. No selection logic changes, so a match with one table in view behaves
# exactly as it did before.
#
# Measured on real video decodes of 45 corpus matches plus 3794e632: at 0.80
# every hand-marked table is still found to within 0.5% of its mark, nothing
# that was right became wrong, the three matches that refuse at full frame
# refuse at every level, and 3794e632 lands on the table actually being played
# on. Julian's match, whose real table sits 34% off centre, survives 0.80.
#
# The ladder only widens on REFUSAL, which is safe for the reason above: when
# the crop clips a real table, its projected corners fall outside the crop and
# frame_verdict rejects the frame, rather than quietly naming another table.
#
# This must be measured on real decodes. An earlier pass used cached JPEGs and
# read scores about 0.2 higher, which is more than the distance between passing
# and failing here.
CROP_LADDER = (0.80, 0.90, 1.00)


def _detect_at_crop(detector, frames, fraction, verbose):
    """One pass of the ladder: detect inside a centre crop of each frame.

    Quads come back in FULL-FRAME coordinates; the per-frame judgement is made
    against the crop, because that is the picture whose edges the corners had
    to stay inside.
    """
    kept, rejections = [], []
    for index, image in frames:
        height, width = image.shape[:2]
        keep_w = int(round(width * fraction))
        x0 = (width - keep_w) // 2
        view = image if fraction >= 1.0 else image[:, x0:x0 + keep_w]
        try:
            tables = detector.candidates(view)
        except Exception as error:                       # noqa: BLE001
            rejections.append(f"frame {index}: {error}")
            continue
        result = fit.select_one(tables)
        keep, reason = fit.frame_verdict(result, keep_w, height)
        if keep:
            result["quad"] = [[x + x0, y] for x, y in result["quad"]]
            result["frame_index"] = index
            kept.append(result)
        else:
            rejections.append(f"frame {index}: {reason}")
        if verbose:
            print(f"  crop {fraction:.2f} frame {index}: "
                  f"{'kept' if keep else reason}", flush=True)
    return kept, rejections


def calibrate_video(video_path, count=DEFAULT_FRAMES, device="cpu",
                    verbose=True):
    """The whole job: sample once, then walk the crop ladder until a table is
    found. Returns a dict."""
    started = time.perf_counter()
    frames = sample_frames(video_path, count)
    if not frames:
        return {"ok": False, "reason": "no frames could be read"}

    detector = TableCornerDetector(device=device)
    loaded_at = time.perf_counter()
    height, width = frames[0][1].shape[:2]

    pooled, reason, rejections, used_crop = None, "no crop attempted", [], None
    for fraction in CROP_LADDER:
        kept, rejections = _detect_at_crop(detector, frames, fraction, verbose)
        pooled, reason = fit.pool_frames(kept)
        used_crop = fraction
        if pooled is not None:
            break
        if verbose:
            print(f"  crop {fraction:.2f}: {reason}; widening", flush=True)

    elapsed = time.perf_counter() - started
    common = {
        "detector": f"table-keypoints/{MODEL_NAME}",
        "frames_sampled": len(frames),
        "frames_rejected": rejections,
        "source_width": width,
        "source_height": height,
        "crop": used_crop,
        "load_s": round(loaded_at - started, 2),
        "elapsed_s": round(elapsed, 2),
    }
    if pooled is None:
        return {"ok": False, "reason": reason, **common}
    return {"ok": True, **pooled, **common}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--frames", type=int, default=DEFAULT_FRAMES)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    try:
        payload = calibrate_video(args.video, args.frames, args.device,
                                  verbose=not args.quiet)
    except Exception as error:                           # noqa: BLE001
        payload = {"ok": False, "reason": f"{type(error).__name__}: {error}"}

    with open(args.out, "w") as handle:
        json.dump(payload, handle)

    if payload.get("ok"):
        print(f"table keypoints: {payload['frames_used']} of "
              f"{payload['frames_kept']} frames agree "
              f"({payload['agreement']:.0%}), spread "
              f"{payload['spread_px']:.1f}px, {payload['elapsed_s']}s")
    else:
        print(f"table keypoints declined: {payload.get('reason')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
