"""Color-independent helpers for evaluating vision-proposed table corners."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

import cv2
import numpy as np

try:
    from .placement_retry_calibration import (
        CORNER_NAMES,
        parse_corner_proposal,
        validate_quad,
    )
    from .points_pipeline import L_M, W_M
except ImportError:
    from placement_retry_calibration import (  # type: ignore
        CORNER_NAMES,
        parse_corner_proposal,
        validate_quad,
    )
    from points_pipeline import L_M, W_M  # type: ignore


MAX_REPRESENTATIVE_DIM = 1600
MIN_TOTAL_EDGE_SUPPORT = 0.20
MIN_SUPPORTED_EDGES = 2
MIN_SINGLE_EDGE_SUPPORT = 0.12
MIN_PROJECTED_DETECTIONS = 6
MIN_PROJECTED_ON_TABLE_RATIO = 0.02


@dataclass(frozen=True)
class _VideoSample:
    frame_index: int
    image: np.ndarray


def _resize_bounded(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min(1.0, MAX_REPRESENTATIVE_DIM / max(width, height))
    if scale == 1.0:
        return image
    return cv2.resize(
        image,
        (round(width * scale), round(height * scale)),
        interpolation=cv2.INTER_AREA,
    )


def _sample_video(video_path: Path, count: int = 24) -> list[_VideoSample]:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError("could not open calibration source video")
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if frame_count <= 0:
        capture.release()
        raise ValueError("calibration source has no frames")
    indices = sorted(
        {
            int(round(value))
            for value in np.linspace(0, frame_count - 1, min(count, frame_count))
        }
    )
    samples = []
    try:
        for frame_index in indices:
            capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, image = capture.read()
            if ok and image is not None:
                samples.append(
                    _VideoSample(frame_index, _resize_bounded(image))
                )
    finally:
        capture.release()
    return samples


def _generic_frame_score(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape
    x0, x1 = round(width * 0.1), round(width * 0.9)
    y0, y1 = round(height * 0.1), round(height * 0.9)
    roi = gray[y0:y1, x0:x1]
    edges = cv2.Canny(roi, 45, 135)
    density = float(np.count_nonzero(edges)) / max(1, edges.size)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=max(12, round(min(width, height) * 0.08)),
        minLineLength=max(12, round(min(width, height) * 0.10)),
        maxLineGap=max(4, round(min(width, height) * 0.03)),
    )
    line_length = 0.0
    if lines is not None:
        for x_start, y_start, x_end, y_end in np.asarray(lines).reshape(-1, 4):
            line_length += math.hypot(x_end - x_start, y_end - y_start)
    sharpness = float(cv2.Laplacian(roi, cv2.CV_64F).var())
    density_penalty = 1.0 if 0.005 <= density <= 0.30 else 0.25
    return density_penalty * (
        math.log1p(max(0.0, sharpness)) + line_length / max(width, height)
    )


def select_generic_representative_frames(
    video_path: Path,
    output_dir: Path,
) -> list[Path]:
    """Write a median background and two temporally separated clear frames."""
    samples = _sample_video(Path(video_path))
    if len(samples) < 3:
        raise ValueError("too few representative frames")
    shapes = {sample.image.shape for sample in samples}
    if len(shapes) != 1:
        raise ValueError("representative frame dimensions are inconsistent")

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    background = np.median(
        np.stack([sample.image for sample in samples]),
        axis=0,
    ).astype(np.uint8)
    halves = np.array_split(np.arange(len(samples)), 2)
    selected = [
        max(
            (samples[int(index)] for index in half),
            key=lambda sample: _generic_frame_score(sample.image),
        )
        for half in halves
        if len(half)
    ]
    images = [background, *(sample.image for sample in selected)]
    names = ["background.jpg", "representative-1.jpg", "representative-2.jpg"]
    paths = []
    for name, image in zip(names, images):
        path = output_dir / name
        if not cv2.imwrite(
            str(path),
            image,
            [cv2.IMWRITE_JPEG_QUALITY, 92],
        ):
            raise RuntimeError(f"could not write representative image: {name}")
        paths.append(path)
    if len(paths) != 3:
        raise ValueError("could not select three representative images")
    return paths


def _scaled_core(
    core: tuple[float, float, float, float] | None,
    scale_x: float,
    scale_y: float,
) -> tuple[float, float, float, float] | None:
    if core is None:
        return None
    return (
        float(core[0]) * scale_x,
        float(core[1]) * scale_x,
        float(core[2]) * scale_y,
        float(core[3]) * scale_y,
    )


def _activity_overlap(
    corners: np.ndarray,
    core: tuple[float, float, float, float] | None,
) -> float:
    if core is None:
        return 0.0
    x0, x1, y0, y1 = core
    core_area = max(1.0, (x1 - x0) * (y1 - y0))
    qx0, qy0 = corners.min(axis=0)
    qx1, qy1 = corners.max(axis=0)
    intersection = max(0.0, min(float(qx1), x1) - max(float(qx0), x0))
    intersection *= max(0.0, min(float(qy1), y1) - max(float(qy0), y0))
    return min(
        1.0,
        float(
            intersection
            / min(core_area, max(1.0, cv2.contourArea(corners)))
        ),
    )


def _edge_support(image: np.ndarray, corners: np.ndarray) -> dict:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 45, 135)
    distance = cv2.distanceTransform(
        (edges == 0).astype(np.uint8),
        cv2.DIST_L2,
        3,
    )
    radius = max(3, round(image.shape[1] * 0.003))
    fractions = []
    for index in range(4):
        start = corners[index]
        end = corners[(index + 1) % 4]
        count = max(2, int(round(np.linalg.norm(end - start))))
        points = np.linspace(start, end, count)
        xs = np.clip(np.rint(points[:, 0]).astype(int), 0, image.shape[1] - 1)
        ys = np.clip(np.rint(points[:, 1]).astype(int), 0, image.shape[0] - 1)
        fractions.append(float(np.mean(distance[ys, xs] <= radius)))
    return {
        "edge_fractions": [round(value, 6) for value in fractions],
        "edge_support": round(float(np.mean(fractions)), 6),
        "supported_edges": sum(
            value >= MIN_SINGLE_EDGE_SUPPORT for value in fractions
        ),
    }


def _projection_support(
    corners: np.ndarray,
    detections: Mapping[int, tuple[float, float]],
    scale_x: float,
    scale_y: float,
) -> dict:
    points = np.asarray(
        [
            [float(x) * scale_x, float(y) * scale_y]
            for x, y in detections.values()
        ],
        dtype=np.float32,
    )
    if not len(points):
        return {
            "projected_count": 0,
            "projected_on_table": 0,
            "projected_on_table_ratio": 0.0,
        }
    destination = np.asarray(
        [[0, 0], [W_M, 0], [W_M, L_M], [0, L_M]],
        dtype=np.float32,
    )
    homography = cv2.getPerspectiveTransform(corners, destination)
    projected = cv2.perspectiveTransform(points.reshape(-1, 1, 2), homography)
    projected = projected.reshape(-1, 2)
    margin = 0.12
    on_table = (
        (projected[:, 0] >= -margin)
        & (projected[:, 0] <= W_M + margin)
        & (projected[:, 1] >= -margin)
        & (projected[:, 1] <= L_M + margin)
    )
    count = int(np.count_nonzero(on_table))
    return {
        "projected_count": int(len(points)),
        "projected_on_table": count,
        "projected_on_table_ratio": round(count / len(points), 6),
    }


def validate_generic_candidate(
    raw: object,
    background: np.ndarray,
    source_size: tuple[int, int],
    bounce_core: tuple[float, float, float, float] | None,
    detections: Mapping[int, tuple[float, float]],
) -> dict:
    """Validate a proposal without assuming a particular table-rim color."""
    image_height, image_width = background.shape[:2]
    source_width, source_height = source_size
    if source_width <= 0 or source_height <= 0:
        raise ValueError("source dimensions must be positive")
    proposal = parse_corner_proposal(raw, image_width, image_height)
    scale_x = image_width / source_width
    scale_y = image_height / source_height
    scaled_core = _scaled_core(bounce_core, scale_x, scale_y)
    scores = {
        "geometry": 0.0,
        "edge_support": 0.0,
        "supported_edges": 0,
        "edge_fractions": [],
        "activity_overlap": 0.0,
        "projected_count": 0,
        "projected_on_table": 0,
        "projected_on_table_ratio": 0.0,
    }
    try:
        corners = validate_quad(
            proposal.corners,
            image_width,
            image_height,
            bounce_core=scaled_core,
            min_aspect=0.25,
        )
        scores["geometry"] = 1.0
    except (ValueError, cv2.error) as error:
        return {
            "accepted": False,
            "reason": "geometry",
            "detail": str(error),
            "confidence": proposal.confidence,
            "corners": proposal.corners.tolist(),
            "scores": scores,
        }

    scores.update(_edge_support(background, corners))
    scores["activity_overlap"] = round(
        _activity_overlap(corners, scaled_core),
        6,
    )
    scores.update(
        _projection_support(corners, detections, scale_x, scale_y)
    )
    reason = None
    if (
        scores["edge_support"] < MIN_TOTAL_EDGE_SUPPORT
        or scores["supported_edges"] < MIN_SUPPORTED_EDGES
    ):
        reason = "edge_support"
    elif scores["activity_overlap"] < 0.05:
        reason = "activity_overlap"
    elif (
        scores["projected_count"] < MIN_PROJECTED_DETECTIONS
        or scores["projected_on_table_ratio"]
        < MIN_PROJECTED_ON_TABLE_RATIO
    ):
        reason = "projection"
    return {
        "accepted": reason is None,
        "reason": reason,
        "confidence": proposal.confidence,
        "corners": corners.tolist(),
        "scores": scores,
    }


def _corner_distances(
    first: np.ndarray,
    second: np.ndarray,
    width: int,
    height: int,
) -> np.ndarray:
    diagonal = math.hypot(width, height)
    if diagonal <= 0:
        raise ValueError("frame dimensions must be positive")
    return np.linalg.norm(first - second, axis=1) / diagonal


def select_consensus(
    candidates: Sequence[dict],
    width: int,
    height: int,
) -> dict:
    """Select the closest agreeing pair from accepted provider trials."""
    accepted = [
        (index, np.asarray(candidate["corners"], dtype=np.float32))
        for index, candidate in enumerate(candidates)
        if candidate.get("accepted")
    ]
    pairs = []
    for position, (first_index, first) in enumerate(accepted):
        for second_index, second in accepted[position + 1 :]:
            distances = _corner_distances(first, second, width, height)
            pairs.append(
                (
                    float(np.median(distances)),
                    float(np.max(distances)),
                    first_index,
                    second_index,
                    first,
                    second,
                )
            )
    if not pairs:
        return {
            "accepted": False,
            "reason": "fewer_than_two_valid_trials",
            "agreeing_trials": [],
        }
    best = min(pairs, key=lambda item: (item[0], item[1], item[2], item[3]))
    median_drift, maximum_drift, first_index, second_index, first, second = best
    if median_drift > 0.02 or maximum_drift > 0.04:
        return {
            "accepted": False,
            "reason": "unstable_proposals",
            "agreeing_trials": [],
            "median_drift_ratio": round(median_drift, 6),
            "maximum_drift_ratio": round(maximum_drift, 6),
        }
    corners = np.median(np.stack([first, second]), axis=0)
    return {
        "accepted": True,
        "reason": None,
        "agreeing_trials": [first_index, second_index],
        "median_drift_ratio": round(median_drift, 6),
        "maximum_drift_ratio": round(maximum_drift, 6),
        "corners": corners.tolist(),
    }


TABLE_LENGTH_M = 2.740
TABLE_WIDTH_M = 1.525
TABLE_RATIO = TABLE_LENGTH_M / TABLE_WIDTH_M  # 1.7967


def shape_error(corners, width, height):
    """How far a quad sits from being the image of a real table.

    An ITTF table is 2.740 x 1.525 m. Zhang & He (2006) show that for a
    planar rectangle under a pinhole camera with square pixels and the
    principal point at the image centre, the four image corners alone
    determine the rectangle's aspect ratio, with no calibration. So a quad
    can be compared against a physical constant instead of only against
    other quads.

    Returned as |log(recovered / 1.7967)|, so twice too long and twice too
    short score alike. None when the configuration is degenerate, which
    happens on near fronto-parallel views and is not an error.

    This is deliberately used to RANK and never to GATE. Measured against 62
    owner-marked matches it is far too noisy per-quad to reject on -- even
    the owner's own marks land outside a generous band 29% of the time --
    but choosing the least-bad of five trials is a much easier question than
    judging one in isolation, and at that job it works.
    """
    quad = np.asarray(corners, dtype=np.float64)
    if quad.shape != (4, 2):
        return None
    cx, cy = width / 2.0, height / 2.0

    def homog(point):
        return np.array([point[0] - cx, point[1] - cy, 1.0])

    a, b, c, d = quad
    m1, m2, m3, m4 = homog(d), homog(c), homog(a), homog(b)
    try:
        den2 = float(np.dot(np.cross(m2, m4), m3))
        den3 = float(np.dot(np.cross(m3, m4), m2))
        if abs(den2) < 1e-12 or abs(den3) < 1e-12:
            return None
        k2 = float(np.dot(np.cross(m1, m4), m3)) / den2
        k3 = float(np.dot(np.cross(m1, m4), m2)) / den3
        n2 = k2 * m2 - m1
        n3 = k3 * m3 - m1
        if abs(n2[2]) < 1e-12 or abs(n3[2]) < 1e-12:
            return None
        f_sq = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2])
        if not np.isfinite(f_sq) or f_sq <= 0:
            return None
        scale = np.diag([1.0 / f_sq, 1.0 / f_sq, 1.0])
        num = float(n2 @ scale @ n2)
        den = float(n3 @ scale @ n3)
        if num <= 0 or den <= 0:
            return None
        ratio = math.sqrt(den / num)
        if ratio <= 0:
            return None
        return abs(math.log(ratio / TABLE_RATIO))
    except (ValueError, ZeroDivisionError, FloatingPointError):
        return None


def select_by_shape(candidates, width, height):
    """Pick the accepted trial that looks most like a table.

    Replaces "closest agreeing pair". That rule answered on 52 of 62 marked
    matches and abandoned the other 10 to a paid Sol escalation -- yet on
    those 10 a good quad was already sitting in the trials we had bought:
    ranking by shape recovers 9 of them, median error 1.17% of the frame
    diagonal. On the 52 it already answered, ranking by shape also beat
    agreement, 1.72% against 2.36%.

    Agreement between two trials is weak evidence: two trials can agree on
    the same wrong table. Agreement with the laws of perspective cannot.
    """
    accepted = [c for c in candidates if c.get("accepted") and c.get("corners")]
    if not accepted:
        return {
            "accepted": False,
            "reason": "no_valid_trials",
            "agreeing_trials": [],
        }
    scored = []
    for index, candidate in enumerate(accepted):
        error = shape_error(candidate["corners"], width, height)
        scored.append((error if error is not None else math.inf, index, candidate))
    scored.sort(key=lambda item: (item[0], item[1]))
    best_error, _, best = scored[0]
    # Every trial degenerate means shape says nothing; fall back to the
    # agreement rule rather than picking arbitrarily.
    if not math.isfinite(best_error):
        return select_consensus(candidates, width, height)
    return {
        "accepted": True,
        "reason": None,
        "agreeing_trials": [candidates.index(best)],
        "shape_error": round(best_error, 6),
        "corners": list(best["corners"]),
    }


def reference_error(
    corners: Sequence[Sequence[float]],
    reference: Sequence[Sequence[float]],
    width: int,
    height: int,
) -> dict:
    candidate = np.asarray(corners, dtype=np.float32)
    expected = np.asarray(reference, dtype=np.float32)
    direct = _corner_distances(candidate, expected, width, height)
    reversed_distances = _corner_distances(
        candidate[[1, 0, 3, 2]],
        expected,
        width,
        height,
    )
    if (
        float(np.median(reversed_distances)),
        float(np.max(reversed_distances)),
    ) < (float(np.median(direct)), float(np.max(direct))):
        distances = reversed_distances
        mapping = "reversed"
    else:
        distances = direct
        mapping = "direct"
    return {
        "corner_ratios": [round(float(value), 6) for value in distances],
        "median_ratio": round(float(np.median(distances)), 6),
        "maximum_ratio": round(float(np.max(distances)), 6),
        "mapping": mapping,
    }
