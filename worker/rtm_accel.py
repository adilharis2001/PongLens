"""Run the two body-stage models on this Mac's GPU instead of its cores.

rtmlib's own `device="mps"` is broken here: it asks onnxruntime for
CoreMLExecutionProvider with NO provider options (rtmlib/tools/base.py),
so CoreML falls back to its legacy NeuralNetwork format at half precision.
That is what makes RTMDet fail with a shape-rank error and RTMPose return
NaN. Naming the MLProgram format and letting it keep float32 fixes both.

Two settings were measured, not guessed (60 real frames, 1907x1028 crops
from a real match, M1 Ultra):

  RTMDet   RequireStaticInputShapes=1   48.2 ms -> 28.3 ms/frame.  Its
           input is already static [1,3,640,640]; the flag keeps the
           dynamic-shaped NMS tail off CoreML, which partitions better.
  RTMPose  the same flag makes it SLOWER (20.4 -> 26.9 ms) because its
           batch dimension is genuinely dynamic, so it is left off.

Both produce the same numbers the processor does — see the parity check
in tools/, and `pose_batched` below is bit-identical to rtmlib's loop.
"""
from __future__ import annotations

import os
import numpy as np


def coreml_providers(static: bool = False, cache_dir: str | None = None):
    opts = {"ModelFormat": "MLProgram", "MLComputeUnits": "ALL"}
    if static:
        opts["RequireStaticInputShapes"] = "1"
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        opts["ModelCacheDirectory"] = cache_dir
    # CPU stays in the list: a node CoreML cannot take still has somewhere
    # to run, which is how the detector's NMS tail keeps working.
    return [("CoreMLExecutionProvider", opts), "CPUExecutionProvider"]


def accelerate(det, pose, cache_dir: str | None = None) -> None:
    """Swap both rtmlib tools onto CoreML in place. Pre/post-processing,
    thresholds and every other line of rtmlib are untouched."""
    import onnxruntime as ort
    det.session = ort.InferenceSession(
        path_or_bytes=det.onnx_model,
        providers=coreml_providers(static=True, cache_dir=cache_dir))
    pose.session = ort.InferenceSession(
        path_or_bytes=pose.onnx_model,
        providers=coreml_providers(static=False, cache_dir=cache_dir))


def pose_fixed_batch2(pose, img: np.ndarray, bboxes) -> tuple[np.ndarray, np.ndarray]:
    """RTMPose for one or two people, ALWAYS at batch 2.

    rtmlib loops the boxes one at a time at batch 1. Batching both into one
    session.run is 1.65x faster and bit-identical (0.000000 px) — but CoreML
    RE-SPECIALISES the model every time the input shape changes, and 11% of
    samples across the thirteen frozen matches name only one player. Measured
    on the alternating mix: 73.7 ms a frame against 12.7 ms at a fixed shape,
    a 5.8x penalty that would eat most of the win.

    So a lone box is sent twice and the duplicate thrown away: the session
    only ever sees batch 2. That costs ~2 ms on the 11% of frames with one
    player, and the surviving player's keypoints are identical to the batch-1
    answer. Holding the shape fixed is also why peak memory stays near 1.0 GB
    instead of spiking the way CoreML does on genuinely varying shapes.
    """
    n = len(bboxes)
    if n == 0:
        raise ValueError("pose_fixed_batch2 called with no boxes")
    boxes = np.asarray(bboxes, dtype=np.float32)
    use = boxes if n == 2 else np.concatenate([boxes, boxes[:1]], axis=0)
    # If anyone ever supports three or more people, fail loudly here rather
    # than silently collapsing throughput by 6x.
    assert len(use) == 2, f"pose_fixed_batch2 expects 1 or 2 boxes, got {n}"

    imgs, centers, scales = [], [], []
    for bbox in use:
        im, c, s = pose.preprocess(img, bbox)
        imgs.append(im.transpose(2, 0, 1))
        centers.append(c)
        scales.append(s)
    batch = np.ascontiguousarray(np.stack(imgs), dtype=np.float32)
    names = [o.name for o in pose.session.get_outputs()]
    outs = pose.session.run(names, {pose.session.get_inputs()[0].name: batch})

    keypoints, scores = [], []
    for i in range(n):                      # n, not len(use): drop the pad
        k, s = pose.postprocess([outs[0][i:i + 1], outs[1][i:i + 1]],
                                centers[i], scales[i])
        keypoints.append(k)
        scores.append(s)
    return np.concatenate(keypoints, axis=0), np.concatenate(scores, axis=0)
