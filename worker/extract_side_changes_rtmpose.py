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
# two players wear similar dark tops produced no usable margin at all
# (Prabhas, 9e15ed10: the two players measure 0.147 apart where PingPod
# measures 0.240, and nothing fires at any threshold).
#
# Three separate defects, and it took a literature sweep to name them:
#
#   * A rectangle around the shoulders and hips is mostly NOT the player.
#     It catches floor, wall and barrier through the gap under the arms,
#     and how much it catches changes every time they move — which is
#     exactly the instability the spread gate was throwing points away
#     for.
#   * A median is the wrong statistic for the failing case. Two players in
#     dark tops have near-identical medians BY CONSTRUCTION; that is what
#     a separability of 0.147 means. What tells them apart is what the
#     median discards: a grey collar, a printed panel, a lighter
#     waistband, piping down one pair of shorts. All of it lives in the
#     tails.
#   * Raw BGR measures brightness at least as much as colour, so the same
#     shirt reads differently at the two ends of a table lit from one
#     side — and comparing a player at one end with themselves at the
#     other is precisely what a changeover forces.
#
# So: regions are masked polygons warped into a common frame rather than
# rectangles, statistics are quantiles rather than medians, and several
# descriptors are built to cancel a change of light outright. Everything
# below is computed in one pass and all of it is stored. Which one to use
# is a question for the corpus, not for an opinion, and re-running pose
# over fifty matches to try the next idea costs an hour and a half.

# Which of the stored descriptors becomes the point's signature. Every
# candidate is stored either way; this only names the one the state
# machine sees without a rescore. Moved by worker/sweep_descriptors.py.
DEFAULT_DESCRIPTOR: str | None = None

STRIP_W, STRIP_H = 24, 64
STRIP_U0, STRIP_U1 = 0.10, 1.75      # in torso lengths below the shoulders
STRIP_HALF_W = 0.40                  # of shoulder width, either side
LATERAL_KEEP = 0.72                  # central share of the strip's width
# Bands in u units, converted to strip rows. B3 straddles the hip line on
# purpose: it is the highest-contrast edge on a table tennis player, and
# unlike the thigh band it usually clears the table for the far player.
BANDS = (("chest", 0.10, 0.55), ("torso", 0.55, 0.95),
         ("waist", 0.85, 1.25), ("thigh", 1.25, 1.75))
QUANTILES = (10, 25, 50, 75, 90)
HS_BINS = (8, 8)
LEGS_POLYGON = (11, 12, 14, 13)
TORSO_POLYGON = (5, 6, 12, 11)
REGION_SHRINK = 0.82

# The sixteen standard web colours, built here rather than taken from
# van de Weijer's w2c table, which states no licence anywhere.
PALETTE = np.float32([
    [0, 0, 0], [0, 0, 128], [0, 128, 0], [0, 128, 128],
    [128, 0, 0], [128, 0, 128], [128, 128, 0], [192, 192, 192],
    [128, 128, 128], [0, 0, 255], [0, 255, 0], [0, 255, 255],
    [255, 0, 0], [255, 0, 255], [255, 255, 0], [255, 255, 255],
])


def _band_rows() -> tuple[tuple[str, int, int], ...]:
    span = STRIP_U1 - STRIP_U0
    out = []
    for name, u0, u1 in BANDS:
        r0 = int(round((u0 - STRIP_U0) / span * STRIP_H))
        r1 = int(round((u1 - STRIP_U0) / span * STRIP_H))
        out.append((name, max(0, r0), min(STRIP_H, max(r0 + 2, r1))))
    return tuple(out)


BAND_ROWS = _band_rows()


def rectified_strip(
    image: np.ndarray,
    keypoints: np.ndarray,
    scores: np.ndarray,
) -> tuple[np.ndarray, np.ndarray] | None:
    """The player's body warped into one fixed 24x64 frame, plus a mask.

    This is what makes comparing bands legitimate at all. The near
    player's body fills 300 pixels of height and the far player's fills
    40, and the far one is usually cut off by the table, so the same
    fraction of two detection boxes is not the same part of two people.
    Anchoring on the shoulder and hip midpoints instead puts 'chest' at
    the same rows for both, whatever their size or how the box was drawn.

    The mask keeps the central 72% of the strip's width and drops anything
    warped in from outside the frame. That is the cheap standard
    alternative to a segmentation model: the border of a person region is
    where the background is.
    """
    for index in (5, 6, 11, 12):
        if float(scores[index]) < TORSO_MIN_CONF:
            return None
    shoulders = (keypoints[5][:2] + keypoints[6][:2]) / 2.0
    hips = (keypoints[11][:2] + keypoints[12][:2]) / 2.0
    axis = np.asarray(hips, np.float32) - np.asarray(shoulders, np.float32)
    length = float(np.linalg.norm(axis))
    if length < 6.0:
        return None
    unit = axis / length
    perpendicular = np.asarray([-unit[1], unit[0]], np.float32)
    width = float(np.clip(
        np.linalg.norm(keypoints[5][:2] - keypoints[6][:2]),
        0.45 * length, 0.95 * length))
    origin = np.asarray(shoulders, np.float32) + STRIP_U0 * axis
    source = np.float32([
        origin,
        origin + (STRIP_U1 - STRIP_U0) * axis,
        origin + STRIP_HALF_W * width * perpendicular,
    ])
    target = np.float32([
        [STRIP_W / 2, 0], [STRIP_W / 2, STRIP_H], [STRIP_W, 0]])
    transform = cv2.getAffineTransform(source, target)
    interpolation = cv2.INTER_AREA if length > STRIP_H else cv2.INTER_LINEAR
    strip = cv2.warpAffine(image, transform, (STRIP_W, STRIP_H),
                           flags=interpolation, borderValue=(0, 0, 0))
    inside = cv2.warpAffine(
        np.ones(image.shape[:2], np.uint8), transform, (STRIP_W, STRIP_H),
        flags=cv2.INTER_NEAREST, borderValue=0)
    columns = np.zeros(STRIP_W, bool)
    margin = int(round(STRIP_W * (1.0 - LATERAL_KEEP) / 2.0))
    columns[margin:STRIP_W - margin] = True
    keep = (inside > 0) & columns[None, :]
    if int(keep.sum()) < 60:
        return None
    return strip.astype(np.float32), keep


def _band_pixels(
    strip: np.ndarray,
    keep: np.ndarray,
    row0: int,
    row1: int,
) -> np.ndarray | None:
    selected = strip[row0:row1][keep[row0:row1]]
    return selected if selected.shape[0] >= 10 else None


def band_quantiles(strip: np.ndarray, keep: np.ndarray) -> list[float]:
    """Five quantiles per Lab channel per band: the tails the median hides.

    A median says what colour a player mostly is. Two people in black
    t-shirts agree on that and disagree about everything else — the collar,
    the logo, the sleeve trim, where the shorts start. Reading the 10th
    and 90th percentile as well costs one call and measures exactly that
    disagreement. It is a strict superset of the old signature: the 50th
    percentile IS the old number.

    Compared with the plain Euclidean distance the rest of the system
    uses, a quantile vector behaves like a 1-D earth-mover's distance
    rather than a bin-wise one, so a residual shift of a channel degrades
    it smoothly instead of zeroing the overlap.
    """
    out: list[float] = []
    for _name, row0, row1 in BAND_ROWS:
        pixels = _band_pixels(strip, keep, row0, row1)
        if pixels is None:
            out.extend([0.0] * (len(QUANTILES) * 3))
            continue
        patch = np.clip(pixels, 0, 255).astype(np.uint8).reshape(-1, 1, 3)
        lab = cv2.cvtColor(patch, cv2.COLOR_BGR2LAB).reshape(-1, 3)
        quantiles = np.percentile(lab.astype(np.float32), QUANTILES, axis=0)
        out.extend(round(float(v), 4) for v in (quantiles / 255.0).ravel())
    return out


def band_log_contrast(strip: np.ndarray, keep: np.ndarray) -> list[float]:
    """How much darker one part of a player is than another, in log space.

    This is the cleanest answer to the two-ends problem in the whole set,
    and it needs no table and nothing to tune. A change of light is, to
    first order, one multiplier per colour channel. In log space a
    multiplier is an ADDITIVE constant — and two bands of the same player
    in the same frame are under the same light, so subtracting one band's
    log mean from another's cancels it exactly, camera gamma included.

    What is left is an identity fact that does not care which end they are
    standing at: a player in a black top and black shorts reads near zero,
    a player in a black top and pale shorts does not.
    """
    means = []
    for _name, row0, row1 in BAND_ROWS:
        pixels = _band_pixels(strip, keep, row0, row1)
        means.append(
            None if pixels is None
            else np.log1p(np.clip(pixels, 0, 255)).mean(axis=0)
        )
    out: list[float] = []
    for i, j in ((0, 1), (1, 2), (2, 3), (0, 3)):
        if means[i] is None or means[j] is None:
            out.extend([0.0, 0.0, 0.0])
        else:
            out.extend(round(float(v), 4) for v in (means[i] - means[j]))
    for _name, row0, row1 in BAND_ROWS:
        pixels = _band_pixels(strip, keep, row0, row1)
        if pixels is None:
            out.extend([0.0, 0.0, 0.0])
            continue
        logged = np.log1p(np.clip(pixels, 0, 255))
        spread = (np.percentile(logged, 90, axis=0)
                  - np.percentile(logged, 10, axis=0))
        out.extend(round(float(v), 4) for v in spread)
    return out


def _soft_hs(pixels: np.ndarray) -> np.ndarray:
    """Saturation-WEIGHTED, soft-binned hue-saturation histogram.

    The version this replaces threw away every pixel under a saturation of
    20 or a value of 25. On a dark top under gym lighting that is most of
    the shirt, so the descriptor was computed on whatever few pixels
    survived — which is noise, on precisely the match it needed to work
    on. Weighting by saturation keeps every pixel and lets the confident,
    colourful ones dominate on their own; hue's reliability is
    proportional to saturation, so a weight is the correct form and a
    threshold is a cliff that flips pixels in and out between frames.

    Soft binning matters more than bin count at these sample sizes: a
    torso 40 pixels tall has a few hundred usable pixels for 64 bins.
    """
    patch = np.clip(pixels, 0, 255).astype(np.uint8).reshape(-1, 1, 3)
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(
        np.float32)
    bins_h, bins_s = HS_BINS
    hue = hsv[:, 0] / 180.0 * bins_h
    sat = np.clip(hsv[:, 1] / 256.0 * bins_s, 0, bins_s - 1e-3)
    weight = hsv[:, 1] / 255.0
    h0, s0 = np.floor(hue).astype(int), np.floor(sat).astype(int)
    fh, fs = hue - h0, sat - s0
    acc = np.zeros((bins_h, bins_s), np.float64)
    for dh, wh in ((0, 1.0 - fh), (1, fh)):
        for ds, ws in ((0, 1.0 - fs), (1, fs)):
            np.add.at(acc, ((h0 + dh) % bins_h, np.clip(s0 + ds, 0, bins_s - 1)),
                      weight * wh * ws)
    acc = cv2.sepFilter2D(acc.astype(np.float32), -1,
                          np.float32([1, 2, 1]) / 4,
                          np.float32([1, 2, 1]) / 4)
    total = float(acc.sum())
    if total <= 0:
        return np.zeros(bins_h * bins_s, np.float32)
    # Stored square-rooted so the plain Euclidean distance the rest of the
    # system uses IS the Hellinger distance.
    return np.sqrt(acc / total).ravel()


def region_histograms(strip: np.ndarray, keep: np.ndarray) -> dict[str, list[float]]:
    upper = np.vstack([p for p in (
        _band_pixels(strip, keep, BAND_ROWS[0][1], BAND_ROWS[0][2]),
        _band_pixels(strip, keep, BAND_ROWS[1][1], BAND_ROWS[1][2]),
    ) if p is not None]) if True else None
    lower_parts = [p for p in (
        _band_pixels(strip, keep, BAND_ROWS[2][1], BAND_ROWS[2][2]),
        _band_pixels(strip, keep, BAND_ROWS[3][1], BAND_ROWS[3][2]),
    ) if p is not None]
    out = {"hs_up": [round(float(v), 4) for v in _soft_hs(upper)]}
    if lower_parts:
        lower = np.vstack(lower_parts)
        out["hs_low"] = [round(float(v), 4) for v in _soft_hs(lower)]
        out["cn_low"] = colour_names(lower)
    out["cn_up"] = colour_names(upper)
    return out


def colour_names(pixels: np.ndarray) -> list[float]:
    """Soft assignment to sixteen named colours.

    Sixteen numbers is a sample size a 40-pixel-tall torso can actually
    support, which is the whole argument for it over a finer histogram.
    Quantising early is also robust to a change of light: a shirt that
    moves from RGB(30,30,38) to RGB(38,38,50) between ends still lands
    almost entirely on the same name.
    """
    patch = np.clip(pixels, 0, 255).astype(np.float32)
    distance = ((patch[:, None, :] - PALETTE[None, :, :]) ** 2).sum(-1)
    weights = np.exp(-distance / (2.0 * 60.0 ** 2))
    totals = weights.sum(axis=1, keepdims=True)
    weights = weights / np.maximum(totals, 1e-9)
    histogram = weights.mean(axis=0)
    return [round(float(v), 4) for v in np.sqrt(histogram)]


def body_proportions(
    keypoints: np.ndarray,
    scores: np.ndarray,
) -> list[float] | None:
    """Ratios of one body to itself. No colour, no pixels, no light.

    The only signature here that two people in identical shirts cannot
    defeat. Every number is divided by the player's own torso length, so a
    40-pixel far player and a 120-pixel near player are directly
    comparable and the two-ends problem does not arise at all.

    Whether keypoint noise at 40 pixels leaves enough of it to be useful
    is a question for the corpus; the point of storing it is to find out.
    """
    for index in (5, 6, 11, 12):
        if float(scores[index]) < TORSO_MIN_CONF:
            return None
    shoulders = (keypoints[5][:2] + keypoints[6][:2]) / 2.0
    hips = (keypoints[11][:2] + keypoints[12][:2]) / 2.0
    length = float(np.linalg.norm(np.asarray(hips) - np.asarray(shoulders)))
    if length < 6.0:
        return None

    def ratio(a: int, b: int) -> float:
        return float(np.linalg.norm(keypoints[a][:2] - keypoints[b][:2])
                     / length)

    values = [ratio(5, 6), ratio(11, 12)]
    if min(float(scores[13]), float(scores[14])) >= TORSO_MIN_CONF:
        thigh = 0.5 * (ratio(11, 13) + ratio(12, 14))
        values.append(length / max(length + thigh * length, 1e-6))
    else:
        values.append(0.0)
    if min(float(scores[3]), float(scores[4])) >= TORSO_MIN_CONF:
        values.append(ratio(3, 4))
    else:
        values.append(0.0)
    if min(float(scores[7]), float(scores[8])) >= TORSO_MIN_CONF:
        values.append(0.5 * (ratio(5, 7) + ratio(6, 8)))
    else:
        values.append(0.0)
    return [round(v, 4) for v in values]


def _region_pixels(
    image: np.ndarray,
    keypoints: np.ndarray,
    scores: np.ndarray,
    joints: tuple[int, ...],
) -> np.ndarray | None:
    """BGR pixels inside a keypoint polygon, shrunk toward its centre."""
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
    cv2.fillConvexPoly(mask, (polygon - [x0, y0]).astype(np.int32), 255)
    pixels = image[y0:y1, x0:x1][mask > 0]
    if pixels.shape[0] < 12:
        return None
    return pixels.reshape(-1, 3).astype(np.float32)


def _chromaticity(pixels: np.ndarray) -> list[float]:
    """Median of two of the three normalized colour coordinates.

    b/(b+g+r) and g/(b+g+r) discard overall intensity outright. Kept as a
    stored variant rather than promoted: discarding intensity entirely
    also discards pale-shirt-versus-dark-shirt, which is real information.
    """
    total = np.maximum(pixels.sum(axis=1, keepdims=True), 1e-3)
    normalized = pixels / total
    return [float(v) for v in np.median(normalized[:, :2], axis=0)]


def _lab_ab(pixels: np.ndarray) -> list[float]:
    """Median a*,b* in CIELab, with L* deliberately discarded."""
    patch = np.clip(pixels, 0, 255).astype(np.uint8).reshape(-1, 1, 3)
    lab = cv2.cvtColor(patch, cv2.COLOR_BGR2LAB).reshape(-1, 3)
    ab = np.median(lab[:, 1:].astype(np.float32), axis=0)
    return [float(v / 255.0) for v in ab]


def table_half_reference(
    image: np.ndarray,
    corners: Mapping[str, list[float]],
) -> dict[str, list[float]] | None:
    """Median colour of the table's near half and its far half.

    The hardest comparison this detector makes is a player at the near end
    against the SAME player at the far end, after a changeover — and the
    two ends are rarely lit alike. One is under a window, the other under
    a lamp.

    We have a calibration target for exactly this and had not been using
    it: the table. It is one continuous, uniform, matte surface spanning
    both ends, photographed in both lights at once, in every frame.
    Whatever the near half's colour differs from the far half's IS the
    difference between the two illuminants.

    Medians, not means, because players, bats and the ball sit on top of
    the table and a mean would follow them around.
    """
    try:
        named = _named_corners(corners)
    except Exception:                                    # noqa: BLE001
        return None
    a, b = np.asarray(named["A"]), np.asarray(named["B"])
    c, d = np.asarray(named["C"]), np.asarray(named["D"])
    mid_right, mid_left = (b + c) / 2.0, (a + d) / 2.0
    halves = {
        "near": np.asarray([a, b, mid_right, mid_left], dtype=np.float32),
        "far": np.asarray([mid_left, mid_right, c, d], dtype=np.float32),
    }
    out = {}
    for name, quad in halves.items():
        x0 = max(0, int(math.floor(quad[:, 0].min())))
        x1 = min(image.shape[1], int(math.ceil(quad[:, 0].max())) + 1)
        y0 = max(0, int(math.floor(quad[:, 1].min())))
        y1 = min(image.shape[0], int(math.ceil(quad[:, 1].max())) + 1)
        if x1 - x0 < 6 or y1 - y0 < 6:
            return None
        mask = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
        cv2.fillConvexPoly(mask, (quad - [x0, y0]).astype(np.int32), 255)
        pixels = image[y0:y1, x0:x1][mask > 0]
        if pixels.shape[0] < 60:
            return None
        out[name] = [float(v) for v in np.median(
            pixels.reshape(-1, 3).astype(np.float32), axis=0)]
    return out


def end_correction(
    reference: Mapping[str, list[float]] | None,
    side: str,
) -> np.ndarray | None:
    """Per-channel gain putting the far end's light onto the near end's.

    The diagonal (von Kries) model: an illuminant change scales each
    channel by a constant, so one ratio per channel undoes it. Ratios are
    clamped — a half that is nearly black gives a ratio that is nearly
    meaningless, and a wild gain is worse than none.
    """
    if not reference or side == "near":
        return None
    near = np.asarray(reference.get("near") or [], dtype=np.float32)
    far = np.asarray(reference.get("far") or [], dtype=np.float32)
    if near.shape != (3,) or far.shape != (3,):
        return None
    if float(near.min()) < 8.0 or float(far.min()) < 8.0:
        return None
    gain = near / far
    if float(gain.max()) > 2.5 or float(gain.min()) < 0.4:
        return None
    return gain.astype(np.float32)


def player_descriptors(
    image: np.ndarray,
    keypoints: np.ndarray,
    scores: np.ndarray,
    correction: np.ndarray | None = None,
) -> dict[str, list[float]] | None:
    """Every candidate appearance signature for one player in one frame.

    None when the torso itself cannot be located, which is the only hard
    requirement — legs are frequently behind the table, and descriptors
    that need them are simply absent when they are.
    """
    torso = _region_pixels(image, keypoints, scores, TORSO_POLYGON)
    if torso is None:
        return None
    table_ref = (
        np.clip(torso * correction, 0.0, 255.0)
        if correction is not None else torso
    )
    out = {
        "bgr": [round(float(v), 4)
                for v in np.median(torso, axis=0) / 255.0],
        "rg": [round(v, 4) for v in _chromaticity(torso)],
        "lab": [round(v, 4) for v in _lab_ab(torso)],
        "bgr_tc": [round(float(v), 4)
                   for v in np.median(table_ref, axis=0) / 255.0],
        "lab_tc": [round(v, 4) for v in _lab_ab(table_ref)],
    }
    legs = _region_pixels(image, keypoints, scores, LEGS_POLYGON)
    if legs is not None:
        out["legs_lab"] = [round(v, 4) for v in _lab_ab(legs)]

    proportions = body_proportions(keypoints, scores)
    if proportions is not None:
        out["geom"] = proportions

    rectified = rectified_strip(image, keypoints, scores)
    if rectified is not None:
        strip, keep = rectified
        out["lab_q"] = band_quantiles(strip, keep)
        out["logdiff"] = band_log_contrast(strip, keep)
        out.update(region_histograms(strip, keep))
        if correction is not None:
            corrected = np.clip(strip * correction, 0.0, 255.0)
            out["lab_q_tc"] = band_quantiles(corrected, keep)
        else:
            out["lab_q_tc"] = out["lab_q"]
    return out


def torso_signature_v2(
    image: np.ndarray,
    keypoints: np.ndarray,
    scores: np.ndarray,
) -> list[float] | None:
    """Normalized median BGR of the shoulders/hips crop (COCO 5,6,11,12).

    The baseline, kept exactly as it was. It has to be carried through the
    whole sweep or none of the other numbers mean anything, and keeping it
    beside the masked-polygon version separates two effects that would
    otherwise be confounded: how much comes from no longer sampling wall
    and floor through the gap under the arms, and how much from the
    descriptor itself.
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


def _chosen_samples(
    frames: Sequence[Mapping[str, Any]],
    descriptor: str | None,
) -> list[list[float]]:
    """One named descriptor's vectors, from frames the chooser committed to.

    Frames where two people at one end were within 15% of each other's
    size are stored but not used here: they are for the sweep to decide
    about, not for the extractor to quietly include.
    """
    if not descriptor:
        return []
    out = []
    for frame in frames:
        if (frame.get("_amb") or [0.0])[0] > 0.5:
            continue
        vector = frame.get(descriptor)
        if vector:
            out.append(list(vector))
    return out


def _clip_or_none(clips_dir: Path, point: Mapping[str, Any]) -> Path | None:
    try:
        return _clip_path(clips_dir, point)
    except FileNotFoundError:
        return None


def table_half_reference(
    image: np.ndarray,
    corners: Mapping[str, list[float]],
) -> dict[str, list[float]] | None:
    """Median colour of the table's near half and its far half.

    The hardest comparison this detector makes is a player at the near end
    against the SAME player at the far end, after a changeover — and the
    two ends are rarely lit alike. One is under a window, the other under
    a lamp; one is nearer the only bright fitting in a club hall.

    We have a calibration target for exactly this and had not been using
    it: the table. It is one continuous, uniform, matte surface spanning
    both ends, photographed in both lights at once, in every single frame.
    Whatever the near half's colour differs from the far half's IS the
    difference between the two illuminants, so dividing it out puts a
    player's shirt on the same footing wherever they are standing.

    Medians, not means, because players, bats and the ball sit on top of
    the table and a mean would follow them around.
    """
    try:
        named = _named_corners(corners)
    except Exception:                                    # noqa: BLE001
        return None
    a, b = np.asarray(named["A"]), np.asarray(named["B"])
    c, d = np.asarray(named["C"]), np.asarray(named["D"])
    mid_right, mid_left = (b + c) / 2.0, (a + d) / 2.0
    halves = {
        "near": np.asarray([a, b, mid_right, mid_left], dtype=np.float32),
        "far": np.asarray([mid_left, mid_right, c, d], dtype=np.float32),
    }
    out = {}
    for name, quad in halves.items():
        x0 = max(0, int(math.floor(quad[:, 0].min())))
        x1 = min(image.shape[1], int(math.ceil(quad[:, 0].max())) + 1)
        y0 = max(0, int(math.floor(quad[:, 1].min())))
        y1 = min(image.shape[0], int(math.ceil(quad[:, 1].max())) + 1)
        if x1 - x0 < 6 or y1 - y0 < 6:
            return None
        mask = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
        cv2.fillConvexPoly(mask, (quad - [x0, y0]).astype(np.int32), 255)
        pixels = image[y0:y1, x0:x1][mask > 0]
        if pixels.shape[0] < 60:
            return None
        out[name] = [float(v) for v in np.median(
            pixels.reshape(-1, 3).astype(np.float32), axis=0)]
    return out


def end_correction(
    reference: Mapping[str, list[float]] | None,
    side: str,
) -> np.ndarray | None:
    """Per-channel gain putting one end's light onto the near end's.

    The diagonal (von Kries) model: an illuminant change scales each
    channel by a constant, so one ratio per channel undoes it. The near
    player needs no correction by definition — they are already in the
    reference light — and the far player is scaled by how the table's two
    halves differ. Ratios are clamped: a half that is nearly black gives a
    ratio that is nearly meaningless, and a wild gain is worse than none.
    """
    if not reference or side == "near":
        return None
    near = np.asarray(reference.get("near") or [], dtype=np.float32)
    far = np.asarray(reference.get("far") or [], dtype=np.float32)
    if near.shape != (3,) or far.shape != (3,):
        return None
    if float(near.min()) < 8.0 or float(far.min()) < 8.0:
        return None
    gain = near / far
    if float(gain.max()) > 2.5 or float(gain.min()) < 0.4:
        return None
    return gain.astype(np.float32)


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
    descriptor: str | None = None,
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

    first_clip = next(
        (path for path in (
            _clip_or_none(clips_dir, point) for point in points
        ) if path is not None),
        None,
    )
    if first_clip is None:
        raise FileNotFoundError(f"no point clip is present under {clips_dir}")
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
    descriptor = descriptor or DEFAULT_DESCRIPTOR
    point_summaries: list[dict[str, Any]] = []
    inference_s = 0.0
    decode_s = 0.0
    frames_requested = 0
    frames_decoded = 0

    missing_clips: list[int] = []
    for point in points:
        idx = int(point["idx"])
        try:
            clip = _clip_path(clips_dir, point)
        except FileNotFoundError:
            # A rally whose clip never made it to disk is a rally with no
            # evidence, which is exactly what an unqualified point already
            # means. Losing the other 154 rallies of a match over one gap
            # in a download is not.
            missing_clips.append(idx)
            point_summaries.append({
                "idx": idx,
                "t0": float(point["t0"]),
                "t1": float(point["t1"]),
                "near": None, "far": None, "qualified": False,
                "bank": {"near": [], "far": []},
                "missing_clip": True,
            })
            continue
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
        table_refs: list[dict[str, list[float]]] = []
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
                # Descriptors are computed for the PROPOSED player even
                # when the chooser refuses to commit, and the refusal
                # rides along as a flag. The ambiguity gate is worth
                # roughly a tenth of all points and it was decided at
                # extraction time, where it cost an hour and a half of
                # pose inference to question. It is now a filter the
                # sweep can move.
                sides = [
                    side
                    for side in ("near", "far")
                    if chosen.get(f"{side}_proposed") is not None
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
                        [chosen[f"{side}_proposed"] for side in sides],
                        dtype=np.float32,
                    )
                    keypoints, scores = pose_model(image, bboxes=bboxes)
                    reference = table_half_reference(image, corners)
                    if reference is not None:
                        table_refs.append(reference)
                    for position, side in enumerate(sides):
                        bank = player_descriptors(
                            image,
                            keypoints[position],
                            scores[position],
                            end_correction(reference, side),
                        )
                        committed = chosen.get(side) is not None
                        if bank is not None:
                            bank["_amb"] = [0.0 if committed else 1.0]
                            raw_bank[side].append(bank)
                        if not committed:
                            continue
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
            "near": summarize_point_side(
                _chosen_samples(raw_bank["near"], descriptor)
                or raw_samples["near"], spread_max),
            "far": summarize_point_side(
                _chosen_samples(raw_bank["far"], descriptor)
                or raw_samples["far"], spread_max),
            # Every candidate descriptor for every frame, so the choice
            # between them is a sweep over stored numbers rather than
            # another two hours of pose inference per idea.
            "bank": {
                side: raw_bank[side] for side in ("near", "far")
            },
            "table_reference": table_refs[len(table_refs) // 2]
            if table_refs else None,
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
        "missing_clips": missing_clips,
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
        "--descriptor", default=DEFAULT_DESCRIPTOR,
        help="which stored descriptor becomes the point signature")
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
        descriptor=args.descriptor,
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
