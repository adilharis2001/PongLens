#!/usr/bin/env python3
"""Extract per-point player-side evidence and side-change candidates.

Runs in the isolated rtmpose-production venv (worker/requirements-
rtmpose.txt). Needs only the per-point clips and match.json's calibration
— no blurball track — so the same command serves the live worker stage
and offline backfill or evaluation over already-processed matches.

Architecture, and why it is detector-first: the retired v1 stage handed
RTMPose two huge fixed boxes derived from the table quad. RTMPose is a
top-down model — given a box it always produces a pose — so on side-on
footage the "far" box, which mostly frames the table and back wall,
returned poses of TVs and posters with just enough confidence to pass
(measured 2026-08-26 on 86f880b9: the far signature froze at the wall
colour through four side switches, making every real swap read as
'uncertain'). v2 instead detects actual people with RTMDet (Apache-2.0,
same rtmlib runtime, ~10ms/frame CPU), projects each person's feet
through the table homography, assigns them to the two table ends in
TABLE coordinates, and only then runs RTMPose on the chosen boxes.

Downstream-only by construction: reads the points the pipeline already
cut, never changes them.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path
from typing import Any, Mapping

import cv2
import numpy as np

if __package__:
    from .extract_match_structure_rtmpose import (
        _clip_metadata,
        _clip_path,
        _create_pose_model,
        _read_frame,
        _scaled_corners,
        atomic_json,
        sha256,
    )
    from .match_structure import EXPECTED_CHECKPOINT_SHA256
    from .side_change import (
        ALGORITHM_VERSION,
        EVIDENCE_VERSION,
        detect_side_changes,
        merge_config,
        summarize_point_side,
    )
else:
    from extract_match_structure_rtmpose import (
        _clip_metadata,
        _clip_path,
        _create_pose_model,
        _read_frame,
        _scaled_corners,
        atomic_json,
        sha256,
    )
    from match_structure import EXPECTED_CHECKPOINT_SHA256
    from side_change import (
        ALGORITHM_VERSION,
        EVIDENCE_VERSION,
        detect_side_changes,
        merge_config,
        summarize_point_side,
    )


SAMPLE_FRAMES = 7
# Person detector: RTMDet-m person checkpoint from the same OpenMMLab
# release train rtmlib itself pulls models from. No YOLO/ultralytics
# lineage — RTMDet is Apache-2.0 via MMDetection. rtmlib caches the
# download under ~/.cache/rtmlib. The nano/320 variant was tried first
# and missed the far player in ~6 of 7 frames — at 720px source width a
# far player is ~30px tall after the det resize, below nano's floor.
DET_MODEL_URL = (
    "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/"
    "onnx_sdk/rtmdet_m_8xb32-100e_coco-obj365-person-235e8209.zip"
)
DET_INPUT_SIZE = (640, 640)
# Player-vs-bystander geometry runs in IMAGE space, normalized by each
# person's own bbox height, never in ground-plane metres: projecting a
# detection's bottom edge through the homography breaks the moment the
# table occludes the legs (the far player on every side-on camera), and
# the perspective error scales with distance. Both rules below were
# measured into shape by the 2026-08-11 deadspace study
# (docs/research/2026-08-11-deadspace-assets/analysis_pose.md): a person
# belongs to the table when their anchor sits within NEAR_TABLE_FACTOR x
# their own bbox height of the quad, and ends are split by the nearer
# END line segment (A-B vs C-D) — a net line cannot split players, and
# "far player is higher in frame" is false on this corpus.
NEAR_TABLE_FACTOR = 1.1
# A second candidate whose end-line distance comes within this fraction
# of the taller candidate's bbox height makes the end AMBIGUOUS for the
# frame — doubles, or a bystander standing with the player — and the
# frame contributes no sample for that end. The guard runs before any
# appearance is read.
AMBIGUOUS_FACTOR = 0.6
# Two candidates at one end whose heights are within this ratio are
# treated as indistinguishable. 0.85 keeps a genuine doubles pair or a
# bystander standing level with the player ambiguous, while letting a
# clearly-smaller onlooker behind the player be passed over.
AMBIGUOUS_SIZE_RATIO = 0.85
# Minimum per-joint confidence for a torso corner to count. Detection
# gives real person crops, so the v1 floor is kept.
TORSO_MIN_CONF = 0.3


def sample_fractions(count: int) -> list[float]:
    """Evenly spaced fractions across the played middle of the clip.

    The fallback for points with no serve anchor. Clips carry roughly
    1.2s of head pad and 1.3s of tail pad around a median 3.8s of play,
    so the outer ~20% of a typical clip is dead time where a player may
    already be walking. Sampling 0.2..0.8 keeps frames inside the rally.
    """
    if count <= 1:
        return [0.5]
    return [0.2 + 0.6 * i / (count - 1) for i in range(count)]


# Seconds AFTER serve contact to read the players from. Anchoring to the
# serve rather than to fractions of the clip keeps every sample inside
# real play: clip fractions drift into the pads, into a fused
# neighbouring rally, or onto a player walking off to fetch the ball,
# and an appearance comparison should never be asked to read those.
#
# It starts after contact, not on it, and that was measured rather than
# assumed. Centring the window on contact (-0.7 to +1.8) took the median
# spread from 0.077 down to 0.065 but coverage from 83% to 68%: the
# SERVER's torso turns through the toss and swing, so the serving side
# becomes the least readable moment in the rally, not the most. Waiting
# for the swing to finish keeps the stability and gives the coverage
# back — 82% at 0.067 on 86f880b9, 106 points.
SERVE_WINDOW = (0.4, 3.2)


def serve_offsets(count: int) -> list[float]:
    """Offsets from serve contact, in seconds, for `count` samples."""
    lo, hi = SERVE_WINDOW
    if count <= 1:
        return [0.0]
    return [lo + (hi - lo) * i / (count - 1) for i in range(count)]


def serve_anchor_local_s(point: Mapping[str, Any]) -> float | None:
    """Serve contact as seconds into this point's CLIP, or None.

    `serve_s` is written by the v2 assembler in SOURCE seconds, and
    `clip_t0` is where the padded clip starts in the same clock, so the
    difference is the offset within the clip. v1 matches carry neither
    and fall back to fractions of the clip.
    """
    serve_s = point.get("serve_s")
    clip_t0 = point.get("clip_t0")
    if serve_s is None or clip_t0 is None:
        return None
    local = float(serve_s) - float(clip_t0)
    return local if math.isfinite(local) and local >= 0 else None


def point_frames(
    point: Mapping[str, Any],
    frame_count: int,
    fps: float,
    samples: int,
) -> tuple[list[int], str]:
    """Frame indices to read this point at, and where they came from.

    Serve-anchored when the assembler found a serve; otherwise spread
    across the played middle of the clip.
    """
    if frame_count <= 0:
        return [], "none"
    last = frame_count - 1
    anchor = serve_anchor_local_s(point)
    if anchor is not None and fps > 0:
        wanted = {
            min(last, max(0, int(round((anchor + offset) * fps))))
            for offset in serve_offsets(samples)
        }
        # A serve close to either edge of the clip collapses the window
        # onto one frame; that is worse than no anchor at all.
        if len(wanted) >= max(2, samples - 2):
            return sorted(wanted), "serve"
    return point_sample_frames(frame_count, samples), "clip"


def point_sample_frames(frame_count: int, samples: int) -> list[int]:
    if frame_count <= 0:
        return []
    last = frame_count - 1
    return sorted(
        {
            min(last, max(0, int(round(last * fraction))))
            for fraction in sample_fractions(samples)
        }
    )


def _named_corners(corners: Mapping[str, Any]) -> dict[str, list[float]]:
    named = {}
    for key, value in corners.items():
        letter = str(key)[:1].upper()
        if letter in "ABCD":
            named[letter] = [float(value[0]), float(value[1])]
    if set(named) != {"A", "B", "C", "D"}:
        raise ValueError("calibration corners must be named A..D")
    return named


def quad_foreshortening(corners: Mapping[str, Any]) -> float | None:
    """Length-axis pixels over 1.8x the near end-line pixels.

    Mirrors points_v2.foreshortening: a table is 2.740m x 1.525m so an
    honest camera sees the long axis longer than the end line; end-on
    cameras squash it (koko 0.32, terry 0.25). Diagnostic only here —
    recorded so the evaluation can decide whether to gate on it.
    """
    try:
        named = _named_corners(corners)
        near_mid = (
            (named["A"][0] + named["B"][0]) / 2.0,
            (named["A"][1] + named["B"][1]) / 2.0,
        )
        far_mid = (
            (named["C"][0] + named["D"][0]) / 2.0,
            (named["C"][1] + named["D"][1]) / 2.0,
        )
        axis_px = math.hypot(
            near_mid[0] - far_mid[0], near_mid[1] - far_mid[1]
        )
        end_px = math.hypot(
            named["A"][0] - named["B"][0], named["A"][1] - named["B"][1]
        )
        if end_px <= 1.0:
            return None
        return round(axis_px / (1.8 * end_px), 3)
    except Exception:
        return None


def _create_det_model(model: str, backend: str, device: str):
    from rtmlib import RTMDet

    return RTMDet(
        onnx_model=model,
        model_input_size=DET_INPUT_SIZE,
        backend=backend,
        device=device,
    )


def _det_checkpoint_sha(det_model: str) -> str | None:
    """SHA-256 of the resolved detector ONNX, for evidence provenance.

    rtmlib caches URL checkpoints under ~/.cache/rtmlib/hub/checkpoints
    with the zip's basename swapped to .onnx; a plain path is used as-is.
    """
    path = Path(det_model)
    if not path.is_file():
        name = path.name
        if name.endswith(".zip"):
            name = name[:-4] + ".onnx"
        path = (
            Path.home() / ".cache" / "rtmlib" / "hub" / "checkpoints" / name
        )
    return sha256(path) if path.is_file() else None


def _iou(a, b) -> float:
    x0 = max(a[0], b[0])
    y0 = max(a[1], b[1])
    x1 = min(a[2], b[2])
    y1 = min(a[3], b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    if inter <= 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / max(1e-9, area_a + area_b - inter)


def dedupe_boxes(boxes: list[list[float]]) -> list[list[float]]:
    """RTMDet occasionally returns near-duplicate boxes of one person."""
    kept: list[list[float]] = []
    for box in sorted(
        boxes,
        key=lambda b: (b[2] - b[0]) * (b[3] - b[1]),
        reverse=True,
    ):
        if all(_iou(box, other) < 0.6 for other in kept):
            kept.append(box)
    return kept


def _segment_distance(
    px: float, py: float, a: list[float], b: list[float]
) -> float:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq <= 1e-9:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _quad_distance(
    px: float, py: float, named: Mapping[str, list[float]]
) -> float:
    """Distance to the table quad's boundary; 0 inside the polygon."""
    order = ["A", "B", "C", "D"]
    points = [named[k] for k in order]
    inside = False
    j = len(points) - 1
    for i in range(len(points)):
        xi, yi = points[i]
        xj, yj = points[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (
            yj - yi
        ) + xi:
            inside = not inside
        j = i
    if inside:
        return 0.0
    return min(
        _segment_distance(px, py, points[i], points[(i + 1) % 4])
        for i in range(4)
    )


def _line_y_at(x: float, a: list[float], b: list[float]) -> float:
    """y of the segment a-b at horizontal position x (clamped)."""
    ax, ay = a
    bx, by = b
    if abs(bx - ax) < 1e-6:
        return (ay + by) / 2.0
    t = max(0.0, min(1.0, (x - ax) / (bx - ax)))
    return ay + t * (by - ay)


def choose_players(
    boxes: list[list[float]],
    corners: Mapping[str, Any],
) -> dict[str, Any]:
    """Pick the two people playing, from 171 hand-labelled frames.

    Adil labelled both players in five frames of every non-PingPod
    upload on 2026-08-26, and the two rules that came out of it are his,
    measured over 144 frames from 34 distinct matches (duplicate uploads
    removed):

        the NEAR player is simply the biggest person             92%
        the FAR player is the biggest one whose box OVERLAPS the
          table, because standing behind it lays the table
          across their legs                                      74%
        both right in the same frame                             73%

    What this replaces — splitting by which side of the near end line
    someone stands on, then taking the biggest each side — scored 92%
    and 37%, so 35% both. The near half was never the problem.

    Variants that lost, so nobody re-proposes them: requiring a minimum
    FRACTION of the box on the table rather than any overlap (33%),
    ranking the far side by overlap area instead of height (62%),
    "second biggest" with no table test at all (46%), and requiring the
    far player to be higher in frame than the near one (48%).

    Everyone must still be near the table — within NEAR_TABLE_FACTOR x
    their own height of the quad — which is what keeps a big spectator
    in the foreground out of it.
    """
    named = _named_corners(corners)
    near_line = (named["A"], named["B"])
    far_line = (named["C"], named["D"])
    quad = np.array([named[k] for k in "ABCD"], dtype=np.float32)

    seen: list[dict[str, Any]] = []
    live: list[int] = []
    for box in boxes:
        anchor_x = (float(box[0]) + float(box[2])) / 2.0
        anchor_y = float(box[3])
        height = max(1.0, float(box[3]) - float(box[1]))
        quad_distance = _quad_distance(anchor_x, anchor_y, named)
        allowance = NEAR_TABLE_FACTOR * height
        record: dict[str, Any] = {
            "box": [round(float(v), 1) for v in box],
            "anchor": [round(anchor_x, 1), round(anchor_y, 1)],
            "height": round(height, 1),
            "quad_distance": round(quad_distance, 1),
            "allowance": round(allowance, 1),
            "d_near": round(
                _segment_distance(anchor_x, anchor_y, *near_line), 1),
            "d_far": round(
                _segment_distance(anchor_x, anchor_y, *far_line), 1),
            "overlaps_table": _box_overlaps_quad(box, quad),
        }
        if quad_distance > allowance:
            record["verdict"] = "too far from the table"
            seen.append(record)
            continue
        record["verdict"] = "at the table"
        live.append(len(seen))
        seen.append(record)

    result: dict[str, Any] = {
        "near": None, "far": None,
        "near_ambiguous": False, "far_ambiguous": False,
        "near_candidates": len(live), "far_candidates": 0,
    }
    if not live:
        result["boxes"] = seen
        return result

    by_height = sorted(live, key=lambda i: -seen[i]["height"])
    near_i = by_height[0]
    rest = [i for i in by_height if i != near_i]
    overlapping = [i for i in rest if seen[i]["overlaps_table"]]
    # Falling back to the next biggest is worth 6 points of far accuracy
    # over giving up when nobody overlaps (68% against 62% before dedup).
    far_pool = overlapping or rest
    far_i = far_pool[0] if far_pool else None
    result["far_candidates"] = len(far_pool)

    # Two people of nearly the same height at the same role are genuinely
    # hard to tell apart — doubles, or someone standing level with the
    # player — and the frame contributes nothing rather than a guess.
    near_ambiguous = (
        len(rest) > 0
        and seen[rest[0]]["height"] >= AMBIGUOUS_SIZE_RATIO
        * seen[near_i]["height"]
        and not seen[rest[0]]["overlaps_table"]
    )
    far_ambiguous = (
        far_i is not None
        and len(far_pool) > 1
        and seen[far_pool[1]]["height"] >= AMBIGUOUS_SIZE_RATIO
        * seen[far_i]["height"]
    )
    result["near_ambiguous"] = near_ambiguous
    result["far_ambiguous"] = far_ambiguous
    result["near_proposed"] = seen[near_i]["box"]
    if far_i is not None:
        result["far_proposed"] = seen[far_i]["box"]
    if not near_ambiguous:
        result["near"] = seen[near_i]["box"]
    if far_i is not None and not far_ambiguous:
        result["far"] = seen[far_i]["box"]

    seen[near_i]["verdict"] = (
        "WOULD PICK as near — refused, someone else just as big"
        if near_ambiguous else "CHOSEN as the near player")
    if far_i is not None:
        seen[far_i]["verdict"] = (
            "WOULD PICK as far — refused, someone else just as big"
            if far_ambiguous else "CHOSEN as the far player"
            + ("" if seen[far_i]["overlaps_table"]
               else " (nobody overlapped the table)"))
    for i in live:
        if i not in (near_i, far_i):
            seen[i]["verdict"] = (
                "at the table, behind the players"
                if seen[i]["overlaps_table"]
                else "at the table, not picked")
    result["boxes"] = seen
    return result


def _box_overlaps_quad(box: list[float], quad: np.ndarray) -> bool:
    """Does this person's box intersect the table at all?

    The far player stands behind the table, so it lies across their legs
    and their box always catches some of it. The near player's box
    usually clears it, being in front and lower in frame. ANY overlap is
    the test — demanding a minimum fraction of the box drops far
    accuracy from 74% to 33%, because a distant player is small and the
    table covers little of them.
    """
    rect = np.array(
        [[box[0], box[1]], [box[2], box[1]],
         [box[2], box[3]], [box[0], box[3]]], dtype=np.float32)
    try:
        area, _ = cv2.intersectConvexConvex(rect, quad)
        return float(area) > 0.0
    except Exception:
        return False


# --- appearance descriptors -------------------------------------------------
#
# The median BGR of the torso's bounding RECTANGLE was the whole identity
# signal until 2026-08-27, and measurement said it was the limiter: 15.3%
# of all points were thrown away because the NEAR player's signature would
# not hold still across seven frames of one rally, and matches where the
# two players wear similar dark tops produced no usable margin at all.
#
# Both failures have the same two causes. A rectangle around the shoulders
# and hips is mostly NOT the player — it catches floor, wall and barrier
# through the gap under the arms, and how much it catches changes every
# time they move. And a median of raw BGR is a measure of brightness at
# least as much as of colour, so the same shirt reads differently at the
# two ends of a table lit from one side, which is exactly the comparison
# a changeover forces.
#
# So every descriptor below is computed on a MASKED polygon rather than a
# rectangle, and the colour ones are built to separate hue from
# brightness. They are all computed in one pass and all stored: which one
# to use is a question for the corpus, not for an opinion, and re-running
# pose over fifty matches to try the next idea costs two hours.

TORSO_POLYGON = (5, 6, 12, 11)      # L shoulder, R shoulder, R hip, L hip
LEGS_POLYGON = (11, 12, 14, 13)     # L hip, R hip, R knee, L knee
REGION_SHRINK = 0.82                # toward the centroid, to shed background
HS_BINS = (6, 6)


def _region_pixels(
    image: np.ndarray,
    keypoints: np.ndarray,
    scores: np.ndarray,
    joints: tuple[int, ...],
) -> np.ndarray | None:
    """BGR pixels inside a keypoint polygon, shrunk toward its centre.

    Every joint must be confident: a polygon completed from a guessed hip
    is a polygon over the floor. Shrinking is the cheap standard
    alternative to a segmentation model — the border of any person region
    is where the background is, and pulling the outline in by a fifth
    removes most of it while costing only clothing that the middle of the
    region already represents.
    """
    points = []
    for index in joints:
        if float(scores[index]) < TORSO_MIN_CONF:
            return None
        points.append([float(keypoints[index][0]), float(keypoints[index][1])])
    polygon = np.asarray(points, dtype=np.float32)
    centre = polygon.mean(axis=0)
    polygon = centre + (polygon - centre) * REGION_SHRINK
    x0 = max(0, int(math.floor(polygon[:, 0].min())))
    x1 = min(image.shape[1], int(math.ceil(polygon[:, 0].max())) + 1)
    y0 = max(0, int(math.floor(polygon[:, 1].min())))
    y1 = min(image.shape[0], int(math.ceil(polygon[:, 1].max())) + 1)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    mask = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
    cv2.fillConvexPoly(
        mask, (polygon - [x0, y0]).astype(np.int32), 255)
    pixels = image[y0:y1, x0:x1][mask > 0]
    if pixels.shape[0] < 12:
        return None
    return pixels.reshape(-1, 3).astype(np.float32)


def _shades_of_grey(pixels: np.ndarray, power: int = 6) -> np.ndarray:
    """Minkowski-norm colour constancy, the standard cheap illuminant fix.

    Estimates the illuminant as the p-norm of each channel and divides it
    out, so the same shirt under a warm lamp and under a window lands in
    the same place. p=6 is the value the colour-constancy literature
    settled on as the best single compromise between grey-world (p=1) and
    white-patch (p=inf).
    """
    scale = np.power(np.mean(np.power(pixels, power), axis=0), 1.0 / power)
    scale = np.maximum(scale, 1e-3)
    scale = scale / (np.linalg.norm(scale) / math.sqrt(3.0))
    return np.clip(pixels / scale, 0.0, 255.0)


def _chromaticity(pixels: np.ndarray) -> list[float]:
    """Median of two of the three normalized colour coordinates.

    b/(b+g+r) and g/(b+g+r) discard overall intensity outright, which is
    the crudest and most reliable illumination invariant there is. Two
    numbers, and the third is 1 minus their sum, so nothing is lost.
    """
    total = np.maximum(pixels.sum(axis=1, keepdims=True), 1e-3)
    normalized = pixels / total
    return [float(v) for v in np.median(normalized[:, :2], axis=0)]


def _lab_ab(pixels: np.ndarray) -> list[float]:
    """Median a*,b* in CIELab, with L* deliberately discarded.

    L* is lightness; a* and b* are where the colour lives. Dropping L* is
    the standard way to compare an appearance at one end of the table with
    the same appearance at the other, where the light is not the same.
    Scaled to roughly 0..1 so it sits on the same ruler as the others.
    """
    patch = np.clip(pixels, 0, 255).astype(np.uint8).reshape(-1, 1, 3)
    lab = cv2.cvtColor(patch, cv2.COLOR_BGR2LAB).reshape(-1, 3)
    ab = np.median(lab[:, 1:].astype(np.float32), axis=0)
    return [float(v / 255.0) for v in ab]


def _hs_histogram(pixels: np.ndarray) -> list[float]:
    """Square-rooted, L2-normalized hue-saturation histogram.

    A histogram survives a stray arm across the shirt where a median of a
    rectangle does not: one region of the body changing hand only moves
    weight between bins. Storing the SQUARE ROOT of the normalized
    histogram means the ordinary Euclidean distance between two of these
    IS the Hellinger distance, so the rest of the system compares them
    correctly without knowing they are histograms.

    Very dark and blown-out pixels are dropped first: hue is meaningless
    where there is no light and where the sensor has clipped, and a black
    shirt is otherwise a random hue reading.
    """
    patch = np.clip(pixels, 0, 255).astype(np.uint8).reshape(-1, 1, 3)
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV).reshape(-1, 3)
    keep = hsv[(hsv[:, 2] > 25) & (hsv[:, 2] < 250) & (hsv[:, 1] > 20)]
    if keep.shape[0] < 8:
        keep = hsv
    hist = cv2.calcHist(
        [keep.reshape(-1, 1, 3).astype(np.uint8)], [0, 1], None,
        list(HS_BINS), [0, 180, 0, 256]).flatten()
    total = float(hist.sum())
    if total <= 0:
        return [0.0] * (HS_BINS[0] * HS_BINS[1])
    root = np.sqrt(hist / total)
    return [round(float(v), 4) for v in root]


def player_descriptors(
    image: np.ndarray,
    keypoints: np.ndarray,
    scores: np.ndarray,
) -> dict[str, list[float]] | None:
    """Every candidate appearance signature for one player in one frame.

    Returns None when the torso itself cannot be located, which is the
    only hard requirement — legs are frequently behind the table and their
    descriptors are simply absent when they are.
    """
    torso = _region_pixels(image, keypoints, scores, TORSO_POLYGON)
    if torso is None:
        return None
    corrected = _shades_of_grey(torso)
    out = {
        "bgr": [round(float(v), 4)
                for v in np.median(torso, axis=0) / 255.0],
        "bgr_cc": [round(float(v), 4)
                   for v in np.median(corrected, axis=0) / 255.0],
        "rg": [round(v, 4) for v in _chromaticity(torso)],
        "lab": [round(v, 4) for v in _lab_ab(torso)],
        "lab_cc": [round(v, 4) for v in _lab_ab(corrected)],
        "hs": _hs_histogram(torso),
        "hs_cc": _hs_histogram(corrected),
    }
    legs = _region_pixels(image, keypoints, scores, LEGS_POLYGON)
    if legs is not None:
        out["legs_lab"] = [round(v, 4) for v in _lab_ab(legs)]
        out["legs_rg"] = [round(v, 4) for v in _chromaticity(legs)]
        out["legs_hs"] = _hs_histogram(legs)
    return out


def torso_signature_v2(
    image: np.ndarray,
    keypoints: np.ndarray,
    scores: np.ndarray,
) -> list[float] | None:
    """Normalized median BGR of the shoulders/hips crop (COCO 5,6,11,12).

    Kept as it was so v2 evidence stays reproducible; player_descriptors
    is what the extractor now stores.
    """
    torso_points = [
        keypoints[index]
        for index in (5, 6, 11, 12)
        if float(scores[index]) >= TORSO_MIN_CONF
    ]
    if len(torso_points) < 3:
        return None
    height, width = image.shape[:2]
    xs = [float(point[0]) for point in torso_points]
    ys = [float(point[1]) for point in torso_points]
    x0 = max(0, int(math.floor(min(xs))))
    x1 = min(width, int(math.ceil(max(xs))) + 1)
    y0 = max(0, int(math.floor(min(ys))))
    y1 = min(height, int(math.ceil(max(ys))) + 1)
    if x1 - x0 < 5 or y1 - y0 < 5:
        return None
    crop = image[y0:y1, x0:x1]
    if crop.size == 0:
        return None
    median = np.median(crop.reshape((-1, 3)), axis=0) / 255.0
    return [round(float(value), 4) for value in median]


def extract_side_change_evidence(
    clips_dir: Path,
    match_json_path: Path,
    output_path: Path,
    model_path: Path,
    backend: str,
    device: str,
    det_model: str = DET_MODEL_URL,
    config: Mapping[str, Any] | None = None,
    samples: int = SAMPLE_FRAMES,
    pose_model: Any | None = None,
    det_model_instance: Any | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    match = json.loads(match_json_path.read_text())
    points = sorted(
        match.get("points") or [], key=lambda point: int(point["idx"])
    )
    if not points:
        raise ValueError("match JSON contains no points")
    calibration = match.get("calibration")
    if not isinstance(calibration, Mapping) or calibration.get("ok") is False:
        raise ValueError("match JSON has no usable table calibration")

    first_clip = _clip_path(clips_dir, points[0])
    _, _, first_width, first_height = _clip_metadata(first_clip)
    if "size" not in calibration:
        source = match.get("source") or {}
        calibration = {
            **calibration,
            "size": [
                int(source.get("width") or first_width),
                int(source.get("height") or first_height),
            ],
        }

    if pose_model is None:
        actual_hash = sha256(model_path)
        if actual_hash != EXPECTED_CHECKPOINT_SHA256:
            raise ValueError("RTMPose checkpoint SHA-256 is unexpected")
        model_started = time.perf_counter()
        pose_model, engine_version = _create_pose_model(
            model_path, backend, device
        )
        model_load_s = time.perf_counter() - model_started
        checkpoint_hash = actual_hash
    else:
        engine_version = "injected-test-model"
        model_load_s = 0.0
        checkpoint_hash = sha256(model_path)
    if det_model_instance is None:
        det_started = time.perf_counter()
        # The detector always runs on CPU: onnxruntime's CoreML EP
        # rejects RTMDet-m's output shape outright (rank mismatch,
        # verified 2026-08-26), and this machine's Metal path has form —
        # the table-keypoint model SIGABRTs inside MPS too.
        det_model_instance = _create_det_model(det_model, backend, "cpu")
        model_load_s += time.perf_counter() - det_started

    cfg = merge_config(config)
    spread_max = float(cfg["spread_max"])
    point_summaries: list[dict[str, Any]] = []
    inference_s = 0.0
    decode_s = 0.0
    frames_requested = 0
    frames_decoded = 0

    for point in points:
        idx = int(point["idx"])
        clip = _clip_path(clips_dir, point)
        fps, frame_count, width, height = _clip_metadata(clip)
        corners = _scaled_corners(calibration, width, height)
        requested, anchor = point_frames(point, frame_count, fps, samples)
        capture = cv2.VideoCapture(str(clip))
        if not capture.isOpened():
            raise RuntimeError(f"could not open pose source clip: {clip}")
        frames_requested += len(requested)
        raw_samples: dict[str, list[list[float]]] = {"near": [], "far": []}
        raw_bank: dict[str, list[dict[str, list[float]]]] = {
            "near": [], "far": []}
        candidate_stats: dict[str, list[int]] = {"near": [], "far": []}
        ambiguous_frames = 0
        try:
            for frame in requested:
                decode_started = time.perf_counter()
                image = _read_frame(capture, frame)
                decode_s += time.perf_counter() - decode_started
                if image is None:
                    continue
                frames_decoded += 1
                inference_started = time.perf_counter()
                boxes = dedupe_boxes(
                    [
                        [float(v) for v in box]
                        for box in det_model_instance(image)
                    ]
                )
                chosen = choose_players(boxes, corners)
                sides = [
                    side
                    for side in ("near", "far")
                    if chosen.get(side) is not None
                ]
                if chosen.get("near_ambiguous") or chosen.get(
                    "far_ambiguous"
                ):
                    ambiguous_frames += 1
                for side in ("near", "far"):
                    candidate_stats[side].append(
                        int(chosen[f"{side}_candidates"])
                    )
                if sides:
                    bboxes = np.asarray(
                        [chosen[side] for side in sides], dtype=np.float32
                    )
                    keypoints, scores = pose_model(image, bboxes=bboxes)
                    for position, side in enumerate(sides):
                        bank = player_descriptors(
                            image,
                            keypoints[position],
                            scores[position],
                        )
                        if bank is not None:
                            raw_bank[side].append(bank)
                        signature = torso_signature_v2(
                            image,
                            keypoints[position],
                            scores[position],
                        )
                        if signature is not None:
                            raw_samples[side].append(signature)
                inference_s += time.perf_counter() - inference_started
        finally:
            capture.release()
        summary: dict[str, Any] = {
            "idx": idx,
            "t0": float(point["t0"]),
            "t1": float(point["t1"]),
            "near": summarize_point_side(raw_samples["near"], spread_max),
            "far": summarize_point_side(raw_samples["far"], spread_max),
            # Every candidate descriptor for every frame, so the choice
            # between them is a sweep over stored numbers rather than
            # another two hours of pose inference per idea.
            "bank": {
                side: raw_bank[side] for side in ("near", "far")
            },
            "anchor": anchor,
            "ambiguous_frames": ambiguous_frames,
            "candidates": {
                side: max(values) if values else 0
                for side, values in candidate_stats.items()
            },
        }
        summary["qualified"] = bool(
            summary["near"]
            and summary["far"]
            and summary["near"]["ok"]
            and summary["far"]["ok"]
        )
        point_summaries.append(summary)

    detection = detect_side_changes(point_summaries, cfg)
    qualified = sum(1 for p in point_summaries if p["qualified"])
    status = detection["status"]
    if status == "ready" and qualified < 2:
        status = "withheld"
        detection["reason"] = "fewer than two qualified points"
    elapsed_s = time.perf_counter() - started
    evidence = {
        "version": EVIDENCE_VERSION,
        "status": status,
        "algorithm": ALGORITHM_VERSION,
        "model": {
            "family": "RTMPose",
            "name": "RTMPose-M COCO-17 + RTMDet-m person",
            "checkpoint_sha256": checkpoint_hash,
            "det_checkpoint_sha256": _det_checkpoint_sha(det_model),
            "profile": f"det-first sparse-{samples}",
            "engine": "rtmlib",
            "engine_version": engine_version,
            "backend": backend,
            "device": device,
        },
        "foreshortening": quad_foreshortening(
            calibration.get("table_corners_px") or {}
        ),
        "points": point_summaries,
        "pairs": detection["pairs"],
        "side_changes": detection["side_changes"],
        "flips_total": detection["flips_total"],
        "coverage": {
            "total": len(point_summaries),
            "qualified": qualified,
            "serve_anchored": sum(
                1 for p in point_summaries if p.get("anchor") == "serve"
            ),
        },
        "config": detection["config"],
        "compute": {
            "elapsed_s": round(elapsed_s, 6),
            "model_load_s": round(model_load_s, 6),
            "decode_s": round(decode_s, 6),
            "inference_s": round(inference_s, 6),
            "frames_requested": frames_requested,
            "frames_decoded": frames_decoded,
        },
    }
    if detection.get("reason"):
        evidence["reason"] = detection["reason"]
    validate_evidence(evidence)
    atomic_json(output_path, evidence)
    return evidence


def validate_evidence(evidence: Mapping[str, Any]) -> None:
    """Reject malformed or forbidden-provenance evidence before persist."""
    serialized = json.dumps(evidence, sort_keys=True).lower()
    if "ultralytics" in serialized or "yolo" in serialized:
        raise ValueError("evidence contains forbidden model provenance")
    if evidence.get("version") != EVIDENCE_VERSION:
        raise ValueError("evidence version must be 2")
    if evidence.get("algorithm") != ALGORITHM_VERSION:
        raise ValueError("evidence algorithm is unsupported")
    if evidence.get("status") not in {"ready", "withheld", "failed"}:
        raise ValueError("evidence status is unsupported")
    points = evidence.get("points")
    if not isinstance(points, list):
        raise ValueError("evidence points must be a list")
    indices = [int(point["idx"]) for point in points]
    if len(indices) != len(set(indices)):
        raise ValueError("evidence point indices must be unique")
    known = set(indices)
    for change in evidence.get("side_changes") or []:
        if change.get("kind") != "side_change":
            raise ValueError("side change kind is unsupported")
        for field in ("after_idx", "before_idx"):
            if int(change[field]) not in known:
                raise ValueError("side change references an unknown point")
        confidence = change.get("confidence")
        if (
            not isinstance(confidence, (int, float))
            or not 0.0 <= float(confidence) <= 1.0
        ):
            raise ValueError("side change confidence must be within [0,1]")
    compute = evidence.get("compute")
    if not isinstance(compute, Mapping):
        raise ValueError("evidence compute is required")
    for key, value in compute.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if not math.isfinite(float(value)) or float(value) < 0:
            raise ValueError(f"compute field {key} must be non-negative")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clips-dir", required=True, type=Path)
    parser.add_argument("--match-json", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--det-model", default=DET_MODEL_URL)
    parser.add_argument("--backend", default="onnxruntime")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--samples", type=int, default=SAMPLE_FRAMES)
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="JSON object of side_change threshold overrides",
    )
    args = parser.parse_args()
    overrides = json.loads(args.config) if args.config else None
    evidence = extract_side_change_evidence(
        clips_dir=args.clips_dir,
        match_json_path=args.match_json,
        output_path=args.output,
        model_path=args.model,
        backend=args.backend,
        device=args.device,
        det_model=args.det_model,
        config=overrides,
        samples=args.samples,
    )
    confirmed = [
        change
        for change in evidence["side_changes"]
        if change.get("confirmed")
    ]
    print(
        f"{evidence['status']}: {evidence['coverage']['qualified']}/"
        f"{evidence['coverage']['total']} qualified points, "
        f"{len(confirmed)} confirmed side change(s)"
    )


if __name__ == "__main__":
    main()
