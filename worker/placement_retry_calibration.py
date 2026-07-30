#!/usr/bin/env python3
"""Stronger, owner-requested table calibration for placement retries.

The vision model proposes table corners from representative frames. Its output
is never authoritative: every proposal is snapped to nearby rim evidence and
must pass local geometry, bounce-region, and homography validation.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
import requests

try:
    from .points_pipeline import (
        L_M,
        W_M,
        Px,
        activity_gate,
        calibrate,
        load_detections,
        probe,
    )
    from .table_coordinates import (
        canonicalize_table_quad,
    )
except ImportError:
    from points_pipeline import (  # type: ignore
        L_M,
        W_M,
        Px,
        activity_gate,
        calibrate,
        load_detections,
        probe,
    )
    from table_coordinates import (  # type: ignore
        canonicalize_table_quad,
    )


CORNER_NAMES = ("A_near_1", "B_near_2", "C_far_2", "D_far_1")
CANONICAL_CORNER_NAMES = (
    "A_near_left",
    "B_near_right",
    "C_far_right",
    "D_far_left",
)
MIN_PROPOSAL_CONFIDENCE = 0.65
REPRESENTATIVE_MAX_DIM = 1600
OPENAI_BASE_URL = os.environ.get(
    "WORKER_OPENAI_BASE_URL",
    "https://api.openai.com/v1",
).rstrip("/")


def _write_cost_usage_sidecar(payload: dict, model: str) -> None:
    """Pass aggregate billing dimensions back across the subprocess boundary."""
    output = os.environ.get("PONGLENS_COST_USAGE_OUTPUT")
    if not output:
        return
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return
    details = usage.get("input_tokens_details")
    safe_usage = {
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
    }
    if isinstance(details, dict):
        safe_usage["input_tokens_details"] = {
            "cached_tokens": details.get("cached_tokens")
        }
    safe = {
        "response_id": str(payload.get("id") or "")[:160],
        "model": str(model)[:120],
        "usage": safe_usage,
    }
    try:
        Path(output).write_text(json.dumps(safe, separators=(",", ":")))
    except OSError:
        # Cost metering must never change placement retry behavior.
        pass


@dataclass(frozen=True)
class CornerProposal:
    corners: np.ndarray
    confidence: float


@dataclass(frozen=True)
class CalibrationOutcome:
    ok: bool
    code: str | None
    calibration: dict | None


def parse_corner_proposal(
    raw: object,
    width: int,
    height: int,
) -> CornerProposal:
    """Strictly parse a model proposal in the supplied image coordinates."""
    if not isinstance(raw, dict):
        raise ValueError("proposal must be an object")
    if raw.get("width") != width or raw.get("height") != height:
        raise ValueError("proposal frame dimensions do not match")

    confidence = raw.get("confidence")
    if (
        isinstance(confidence, bool)
        or not isinstance(confidence, (int, float))
        or not math.isfinite(float(confidence))
        or not MIN_PROPOSAL_CONFIDENCE <= float(confidence) <= 1.0
    ):
        raise ValueError("proposal confidence is below threshold")

    corners = raw.get("corners")
    corner_keys = frozenset(corners) if isinstance(corners, dict) else None
    if not isinstance(corners, dict) or corner_keys not in {
        frozenset(CORNER_NAMES),
        frozenset(CANONICAL_CORNER_NAMES),
    }:
        raise ValueError("proposal corners are incomplete")

    parsed = []
    names = (
        CANONICAL_CORNER_NAMES
        if corner_keys == frozenset(CANONICAL_CORNER_NAMES)
        else CORNER_NAMES
    )
    for name in names:
        point = corners[name]
        if (
            not isinstance(point, list)
            or len(point) != 2
            or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
                for value in point
            )
        ):
            raise ValueError(f"proposal corner {name} is invalid")
        x, y = (float(point[0]), float(point[1]))
        if not (0 <= x < width and 0 <= y < height):
            raise ValueError(f"proposal corner {name} is outside the frame")
        parsed.append((x, y))

    canonical = canonicalize_table_quad(
        np.asarray(parsed, dtype=np.float32),
        near_pair=(0, 1),
    )
    return CornerProposal(
        corners=canonical.corners,
        confidence=float(confidence),
    )


def _segments_intersect(a, b, c, d) -> bool:
    def orientation(p, q, r):
        first = q - p
        second = r - p
        return float(first[0] * second[1] - first[1] * second[0])

    ab_c = orientation(a, b, c)
    ab_d = orientation(a, b, d)
    cd_a = orientation(c, d, a)
    cd_b = orientation(c, d, b)
    return ab_c * ab_d < 0 and cd_a * cd_b < 0


def validate_quad(
    corners: np.ndarray,
    width: int,
    height: int,
    *,
    bounce_core: tuple[float, float, float, float] | None,
    min_aspect: float = 0.65,
) -> np.ndarray:
    """Return an ordered float32 table quad or raise a stable ValueError."""
    quad = np.asarray(corners, dtype=np.float32)
    if quad.shape != (4, 2) or not np.isfinite(quad).all():
        raise ValueError("quad coordinates are invalid")
    if (
        (quad[:, 0] < 0).any()
        or (quad[:, 0] >= width).any()
        or (quad[:, 1] < 0).any()
        or (quad[:, 1] >= height).any()
    ):
        raise ValueError("quad is outside the frame")
    if (
        not cv2.isContourConvex(quad.astype(np.int32))
        or _segments_intersect(quad[0], quad[1], quad[2], quad[3])
        or _segments_intersect(quad[1], quad[2], quad[3], quad[0])
    ):
        raise ValueError("quad must be convex and non-self-intersecting")

    frame_area = float(width * height)
    area = abs(float(cv2.contourArea(quad)))
    if not 0.002 * frame_area < area < 0.35 * frame_area:
        raise ValueError("quad area is implausible")

    edges = np.asarray(
        [
            np.linalg.norm(quad[(index + 1) % 4] - quad[index])
            for index in range(4)
        ],
        dtype=np.float64,
    )
    if float(edges.min()) < 25.0 * width / 1920.0:
        raise ValueError("quad edge is too short")

    # A-B and C-D are the near/far end lines; B-C and D-A are sidelines.
    end_ratio = float(max(edges[0], edges[2]) / min(edges[0], edges[2]))
    side_ratio = float(max(edges[1], edges[3]) / min(edges[1], edges[3]))
    aspect = float(
        ((edges[1] + edges[3]) / 2.0)
        / ((edges[0] + edges[2]) / 2.0)
    )
    if (
        end_ratio > 4.0
        or side_ratio > 4.0
        or not min_aspect <= aspect <= 6.0
    ):
        raise ValueError("quad perspective ratios are implausible")

    if bounce_core is not None:
        x0, x1, y0, y1 = (float(value) for value in bounce_core)
        core_area = max((x1 - x0) * (y1 - y0), 1.0)
        qx0, qy0 = quad.min(axis=0)
        qx1, qy1 = quad.max(axis=0)
        intersection = max(0.0, min(float(qx1), x1) - max(float(qx0), x0))
        intersection *= max(
            0.0,
            min(float(qy1), y1) - max(float(qy0), y0),
        )
        if intersection < 0.05 * min(core_area, area) or area > 4.0 * core_area:
            raise ValueError("quad does not overlap the bounce core")

    destination = np.asarray(
        [[0, 0], [W_M, 0], [W_M, L_M], [0, L_M]],
        dtype=np.float32,
    )
    forward = cv2.getPerspectiveTransform(quad, destination)
    inverse = cv2.getPerspectiveTransform(destination, quad)
    if (
        not np.isfinite(forward).all()
        or not np.isfinite(inverse).all()
        or abs(float(np.linalg.det(forward))) < 1e-10
        or abs(float(np.linalg.det(inverse))) < 1e-10
    ):
        raise ValueError("quad homography is singular")
    return quad


def _resize_bounded(image: np.ndarray, max_dim: int) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min(1.0, max_dim / max(width, height))
    if scale == 1.0:
        return image
    return cv2.resize(
        image,
        (round(width * scale), round(height * scale)),
        interpolation=cv2.INTER_AREA,
    )


def _magenta_mask(image_bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    hue = hsv[..., 0].astype(int)
    saturation = hsv[..., 1].astype(int)
    value = hsv[..., 2].astype(int)
    mask = (
        ((hue >= 130) | (hue <= 10))
        & (saturation >= 50)
        & (value >= 80)
    ).astype(np.uint8) * 255
    return cv2.morphologyEx(
        mask,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
    )


def representative_frames(
    video_path: str | Path,
    output_dir: str | Path,
) -> list[Path]:
    """Write one median background and up to two high-rim-support JPEGs."""
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError("could not open retry source video")

    frame_count = max(int(capture.get(cv2.CAP_PROP_FRAME_COUNT)), 1)
    stride = max(1, frame_count // 24)
    frames: list[np.ndarray] = []
    index = 0
    try:
        while len(frames) < 24:
            ok = capture.grab()
            if not ok:
                break
            if index % stride == 0:
                ok, frame = capture.retrieve()
                if ok:
                    frames.append(
                        _resize_bounded(frame, REPRESENTATIVE_MAX_DIM)
                    )
            index += 1
    finally:
        capture.release()
    if len(frames) < 3:
        raise ValueError("too few representative frames")

    background = np.median(np.stack(frames), axis=0).astype(np.uint8)
    paths = [output / "placement_retry_background.jpg"]
    if not cv2.imwrite(
        str(paths[0]),
        background,
        [cv2.IMWRITE_JPEG_QUALITY, 92],
    ):
        raise RuntimeError("could not write representative background")

    scored = sorted(
        (
            (int(np.count_nonzero(_magenta_mask(frame))), idx, frame)
            for idx, frame in enumerate(frames)
        ),
        reverse=True,
    )
    for rank, (_, _, frame) in enumerate(scored[:2], start=1):
        path = output / f"placement_retry_rim_{rank}.jpg"
        if cv2.imwrite(str(path), frame, [cv2.IMWRITE_JPEG_QUALITY, 92]):
            paths.append(path)
    return paths


def _image_data_url(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def request_corner_proposal(
    image_paths: list[Path],
    *,
    api_key: str,
    model: str,
    timeout_s: int = 90,
    reasoning_effort: str | None = None,
    max_output_tokens: int = 500,
) -> dict:
    """Make one Responses API request and return strict parsed JSON."""
    if not api_key:
        raise ValueError("OpenAI API key is unavailable")
    if not image_paths:
        raise ValueError("representative frames are unavailable")
    first = cv2.imread(str(image_paths[0]))
    if first is None:
        raise ValueError("representative background is unreadable")
    height, width = first.shape[:2]

    prompt = (
        "Identify the four OUTER corners of the visible playing surface in "
        "these frames. The visible playing surface and outer boundary, not "
        "any paint color, define the table. Use the "
        f"{width}x{height} image pixel coordinate system. A_near_left and "
        "B_near_right are the camera-left and camera-right endpoints of the "
        "larger camera-facing near end line. C_far_right and D_far_left are "
        "the corresponding endpoints of the smaller far end line. The "
        "cyclic polygon must be A_near_left -> B_near_right -> C_far_right "
        "-> D_far_left. Do not use the net, "
        "floor markings, table legs, or a neighboring table. Return only "
        "the requested schema and lower confidence when any rim corner is "
        "occluded or ambiguous."
    )
    content: list[dict] = [{"type": "input_text", "text": prompt}]
    content.extend(
        {
            "type": "input_image",
            "image_url": _image_data_url(Path(path)),
            "detail": "original",
        }
        for path in image_paths
    )
    coordinate = {
        "type": "array",
        "items": {"type": "number"},
        "minItems": 2,
        "maxItems": 2,
    }
    schema = {
        "type": "object",
        "properties": {
            "width": {"type": "integer", "enum": [width]},
            "height": {"type": "integer", "enum": [height]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "ambiguity_reason": {"type": "string", "maxLength": 240},
            "corners": {
                "type": "object",
                "properties": {
                    name: coordinate for name in CANONICAL_CORNER_NAMES
                },
                "required": list(CANONICAL_CORNER_NAMES),
                "additionalProperties": False,
            },
        },
        "required": [
            "width",
            "height",
            "confidence",
            "ambiguity_reason",
            "corners",
        ],
        "additionalProperties": False,
    }
    request_payload = {
        "model": model,
        "store": False,
        "input": [{"role": "user", "content": content}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "table_corner_proposal",
                "strict": True,
                "schema": schema,
            }
        },
        "max_output_tokens": int(max_output_tokens),
    }
    if reasoning_effort:
        request_payload["reasoning"] = {"effort": reasoning_effort}
    response = requests.post(
        f"{OPENAI_BASE_URL}/responses",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=request_payload,
        timeout=timeout_s,
    )
    response.raise_for_status()
    payload = response.json()
    _write_cost_usage_sidecar(payload, model)
    for item in payload.get("output", []):
        if item.get("type") != "message":
            continue
        for part in item.get("content", []):
            if part.get("type") == "output_text":
                return json.loads(part["text"])
    raise ValueError("OpenAI response did not contain a corner proposal")


def _line_from_points(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    vx, vy, x0, y0 = cv2.fitLine(
        points.astype(np.float32),
        cv2.DIST_L2,
        0,
        0.01,
        0.01,
    ).reshape(-1)
    return (
        np.asarray([float(x0), float(y0)], dtype=np.float64),
        np.asarray([float(vx), float(vy)], dtype=np.float64),
    )


def _intersect_lines(
    first: tuple[np.ndarray, np.ndarray],
    second: tuple[np.ndarray, np.ndarray],
) -> np.ndarray | None:
    p, r = first
    q, s = second
    cross = float(r[0] * s[1] - r[1] * s[0])
    if abs(cross) < 1e-6:
        return None
    delta = q - p
    t = float((delta[0] * s[1] - delta[1] * s[0]) / cross)
    return (p + t * r).astype(np.float32)


def snap_quad_to_rim(
    proposal: np.ndarray,
    background_bgr: np.ndarray,
    *,
    search_radius: int = 36,
) -> np.ndarray:
    """Fit nearby magenta rim evidence without moving a corner too far."""
    quad = np.asarray(proposal, dtype=np.float32)
    mask = _magenta_mask(background_bgr)
    ys, xs = np.nonzero(mask)
    evidence = np.stack([xs, ys], axis=1).astype(np.float32)
    if len(evidence) < 20:
        raise ValueError("insufficient rim support")

    lines: list[tuple[np.ndarray, np.ndarray]] = []
    supported = 0
    for index in range(4):
        start = quad[index]
        end = quad[(index + 1) % 4]
        direction = end - start
        length = float(np.linalg.norm(direction))
        if length <= 0:
            raise ValueError("degenerate rim edge")
        unit = direction / length
        relative = evidence - start
        along = relative @ unit
        distance = np.abs(relative[:, 0] * unit[1] - relative[:, 1] * unit[0])
        nearby = evidence[
            (along >= -0.1 * length)
            & (along <= 1.1 * length)
            & (distance <= search_radius)
        ]
        minimum = max(20, round(length * 0.08))
        if len(nearby) >= minimum:
            lines.append(_line_from_points(nearby))
            supported += 1
        else:
            lines.append(
                (
                    start.astype(np.float64),
                    unit.astype(np.float64),
                )
            )
    if supported < 3:
        raise ValueError("fewer than three rim edges have support")

    snapped = quad.copy()
    for index in range(4):
        intersection = _intersect_lines(lines[index - 1], lines[index])
        if (
            intersection is not None
            and np.isfinite(intersection).all()
            and np.linalg.norm(intersection - quad[index]) <= search_radius
        ):
            snapped[index] = intersection
    return snapped


def _scaled_core(
    core: tuple[float, float, float, float] | None,
    scale_x: float,
    scale_y: float,
) -> tuple[float, float, float, float] | None:
    if core is None:
        return None
    return (
        core[0] * scale_x,
        core[1] * scale_x,
        core[2] * scale_y,
        core[3] * scale_y,
    )


def _canonical_calibration_fields(
    corners: np.ndarray,
) -> tuple[dict[str, list[float]], list[float], bool]:
    canonical = canonicalize_table_quad(corners, near_pair=(0, 1))
    A, B, C, D = canonical.corners
    axis = ((D - A) + (C - B)) / 2.0
    norm = float(np.linalg.norm(axis))
    if not math.isfinite(norm) or norm <= 1e-8:
        raise ValueError("canonical table length axis is degenerate")
    axis /= norm
    return (
        {
            name: [round(float(point[0]), 1), round(float(point[1]), 1)]
            for name, point in zip(CORNER_NAMES, canonical.corners)
        },
        [float(axis[0]), float(axis[1])],
        canonical.reordered,
    )


def calibrate_for_retry(
    video_path,
    blurball_path,
    workdir,
    *,
    api_key,
    model,
    deterministic_calibrator: Callable = calibrate,
    vision_request: Callable = request_corner_proposal,
    rim_snapper: Callable = snap_quad_to_rim,
) -> CalibrationOutcome:
    detections = load_detections(Path(blurball_path))
    metadata = probe(str(video_path))
    width, height = int(metadata["width"]), int(metadata["height"])
    px = Px(width)
    gate = activity_gate(detections, width, height)
    core = gate["core"] if gate else None

    try:
        deterministic = deterministic_calibrator(
            str(video_path),
            str(workdir),
            detections,
            px,
            gate_core=core,
        )
        if deterministic is not None:
            corners = np.asarray(
                [
                    deterministic["corners_px"][name]
                    for name in CORNER_NAMES
                ],
                dtype=np.float32,
            )
            validate_quad(corners, width, height, bounce_core=core)
            named_corners, axis, reordered = _canonical_calibration_fields(
                corners
            )
            return CalibrationOutcome(
                ok=True,
                code=None,
                calibration={
                    "ok": True,
                    "table_corners_px": named_corners,
                    "length_axis": axis,
                    "orientation": "canonical-v1",
                    "legacy_reordered": reordered,
                    "note": deterministic["note"],
                },
            )
    except Exception:
        # A malformed or locally invalid deterministic result is equivalent
        # to no result and is exactly what the stronger fallback is for.
        pass

    try:
        images = representative_frames(video_path, workdir)
        raw = vision_request(images, api_key=api_key, model=model)
        background = cv2.imread(str(images[0]))
        if background is None:
            raise ValueError("representative background is unreadable")
        image_height, image_width = background.shape[:2]
        proposal = parse_corner_proposal(raw, image_width, image_height)
        snapped = rim_snapper(proposal.corners, background)

        scale_x, scale_y = width / image_width, height / image_height
        small_core = _scaled_core(core, 1.0 / scale_x, 1.0 / scale_y)
        validate_quad(
            snapped,
            image_width,
            image_height,
            bounce_core=small_core,
        )
        quad = snapped * np.asarray([scale_x, scale_y], dtype=np.float32)
        quad = validate_quad(quad, width, height, bounce_core=core)
        named_corners, axis, reordered = _canonical_calibration_fields(quad)
    except (
        ValueError,
        json.JSONDecodeError,
        requests.RequestException,
        TimeoutError,
        cv2.error,
    ):
        return CalibrationOutcome(
            ok=False,
            code="vision_calibration_rejected",
            calibration=None,
        )

    return CalibrationOutcome(
        ok=True,
        code=None,
        calibration={
            "ok": True,
            "table_corners_px": named_corners,
            "length_axis": axis,
            "orientation": "canonical-v1",
            "legacy_reordered": reordered,
            "note": (
                "vision-proposed calibration snapped to local rim evidence "
                "and validated against the bounce region"
            ),
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    calibrate_parser = subparsers.add_parser("calibrate")
    calibrate_parser.add_argument("--video", required=True)
    calibrate_parser.add_argument("--blurball", required=True)
    calibrate_parser.add_argument("--workdir", required=True)
    calibrate_parser.add_argument("--output", required=True)
    calibrate_parser.add_argument(
        "--model",
        default=os.environ.get(
            "WORKER_PLACEMENT_VISION_MODEL",
            "gpt-5.6-sol",
        ),
    )
    args = parser.parse_args()

    if args.command == "calibrate":
        outcome = calibrate_for_retry(
            args.video,
            args.blurball,
            args.workdir,
            api_key=os.environ.get("OPENAI_API_KEY", ""),
            model=args.model,
        )
        Path(args.output).write_text(json.dumps(asdict(outcome), indent=2))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
