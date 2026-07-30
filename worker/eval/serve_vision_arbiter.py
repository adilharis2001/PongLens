#!/usr/bin/env python3
"""Bounded, privacy-safe vision referee for uncertain serve candidates."""

from __future__ import annotations

import base64
import json
import math
import re
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import cv2
import requests


MAX_CANDIDATES = 2
MAX_FRAMES_PER_CANDIDATE = 6
MAX_TOTAL_FRAMES = 12
MIN_PROVIDER_CONFIDENCE = 0.90
ANONYMOUS_CANDIDATE = re.compile(r"^candidate-[1-9][0-9]*$")
HARD_GEOMETRY_REASONS = frozenset(
    {
        "selected_serve_geometry_invalid",
        "selected_bounce_evidence_weak",
        "selected_hypothesis_has_hard_contradiction",
        "serve_bounces_not_on_opposite_halves",
    }
)


def _response_schema(candidate_ids: Sequence[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "candidate_id": {
                "type": "string",
                "enum": [*candidate_ids, "none"],
            },
            "server_side": {
                "type": "string",
                "enum": ["near", "far", "unknown"],
            },
            "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
            },
            "reason": {"type": "string", "maxLength": 240},
        },
        "required": [
            "candidate_id",
            "server_side",
            "confidence",
            "reason",
        ],
        "additionalProperties": False,
    }


def build_request(
    candidate_frames: Mapping[str, Sequence[str]],
    *,
    model: str = "gpt-5.6",
    max_output_tokens: int = 300,
) -> dict[str, Any]:
    """Build a strict request containing only anonymous candidate storyboards."""

    selected = list(candidate_frames.items())[:MAX_CANDIDATES]
    if not selected:
        raise ValueError("at least one candidate is required")
    candidate_ids = [candidate_id for candidate_id, _frames in selected]
    if any(
        not ANONYMOUS_CANDIDATE.fullmatch(candidate_id)
        for candidate_id in candidate_ids
    ):
        raise ValueError("candidate IDs must be anonymous")
    content: list[dict[str, Any]] = [
        {
            "type": "input_text",
            "text": (
                "Review the anonymous, chronological frame sequences below. "
                "Choose only a candidate that clearly shows a legal-looking "
                "table-tennis serve event: ball contact followed by a bounce "
                "on the server's half, net crossing, and a bounce on the "
                "opposite half. 'near' means the player at the bottom/camera "
                "end; 'far' means the player beyond the table. Walking, ball "
                "retrieval, and tossing the ball to the other player are not "
                "serves. Return none/unknown if the sequence is ambiguous. "
                "Do not identify either person."
            ),
        }
    ]
    total = 0
    for candidate_id, frames in selected:
        content.append(
            {
                "type": "input_text",
                "text": f"{candidate_id}, chronological frames:",
            }
        )
        for image_data_url in list(frames)[:MAX_FRAMES_PER_CANDIDATE]:
            if total >= MAX_TOTAL_FRAMES:
                break
            if not str(image_data_url).startswith("data:image/jpeg;base64,"):
                raise ValueError("candidate frame must be a JPEG data URL")
            content.append(
                {
                    "type": "input_image",
                    "image_url": str(image_data_url),
                    "detail": "original",
                }
            )
            total += 1
    if total == 0:
        raise ValueError("candidate frames are unavailable")
    return {
        "model": model,
        "store": False,
        "input": [{"role": "user", "content": content}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "serve_candidate_referee",
                "strict": True,
                "schema": _response_schema(candidate_ids),
            }
        },
        "max_output_tokens": int(max_output_tokens),
    }


def _safe_usage(payload: Mapping[str, Any]) -> dict[str, Any]:
    usage = payload.get("usage")
    if not isinstance(usage, Mapping):
        return {}
    safe = {
        key: int(usage[key])
        for key in ("input_tokens", "output_tokens", "total_tokens")
        if isinstance(usage.get(key), int)
    }
    details = usage.get("input_tokens_details")
    if isinstance(details, Mapping) and isinstance(
        details.get("cached_tokens"), int
    ):
        safe["cached_tokens"] = int(details["cached_tokens"])
    return safe


def parse_response(
    payload: Mapping[str, Any],
    *,
    allowed_candidate_ids: set[str],
) -> dict[str, Any]:
    """Parse and validate a Responses API result without retaining identifiers."""

    raw: Any = None
    for item in payload.get("output", []):
        if not isinstance(item, Mapping) or item.get("type") != "message":
            continue
        for part in item.get("content", []):
            if (
                isinstance(part, Mapping)
                and part.get("type") == "output_text"
            ):
                raw = json.loads(str(part["text"]))
                break
    if not isinstance(raw, Mapping):
        raise ValueError("provider response did not contain structured output")
    candidate_id = raw.get("candidate_id")
    server_side = raw.get("server_side")
    confidence = raw.get("confidence")
    reason = raw.get("reason")
    if candidate_id == "none":
        candidate_id = None
    if server_side == "unknown":
        server_side = None
    if candidate_id is not None and candidate_id not in allowed_candidate_ids:
        raise ValueError("provider returned an unknown candidate")
    if server_side not in {None, "near", "far"}:
        raise ValueError("provider returned an invalid server side")
    if (
        isinstance(confidence, bool)
        or not isinstance(confidence, (int, float))
        or not math.isfinite(float(confidence))
        or not 0 <= float(confidence) <= 1
    ):
        raise ValueError("provider returned invalid confidence")
    if not isinstance(reason, str) or len(reason) > 240:
        raise ValueError("provider returned invalid reason")
    return {
        "candidate_id": candidate_id,
        "server_side": server_side,
        "confidence": float(confidence),
        "reason": reason,
        "usage": _safe_usage(payload),
        "model": str(payload.get("model") or "")[:120],
    }


def request_openai(
    request: Mapping[str, Any],
    *,
    api_key: str,
    timeout_s: int = 90,
    base_url: str = "https://api.openai.com/v1",
) -> dict[str, Any]:
    """Submit one already-bounded request and return its raw JSON payload."""

    if not api_key:
        raise ValueError("OpenAI API key is unavailable")
    response = requests.post(
        f"{base_url.rstrip('/')}/responses",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=dict(request),
        timeout=int(timeout_s),
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("provider response is not an object")
    return payload


def apply_arbiter(
    local: Mapping[str, Any],
    provider: Mapping[str, Any],
    *,
    allowed_candidate_ids: set[str],
) -> dict[str, Any]:
    """Apply provider evidence without overriding a geometric contradiction."""

    result = dict(local)
    if local.get("status") != "needs_review":
        result["api_status"] = "not_needed"
        return result
    if local.get("reason") in HARD_GEOMETRY_REASONS:
        result["api_status"] = "blocked_by_geometry"
        return result
    candidate_id = provider.get("candidate_id")
    side = provider.get("server_side")
    confidence = provider.get("confidence")
    if (
        candidate_id not in allowed_candidate_ids
        or side not in {"near", "far"}
        or isinstance(confidence, bool)
        or not isinstance(confidence, (int, float))
        or float(confidence) < MIN_PROVIDER_CONFIDENCE
    ):
        result["api_status"] = "abstained"
        result["api_evidence"] = dict(provider)
        return result
    result.update(
        {
            "status": "high_confidence",
            "server_side": side,
            "confidence": float(confidence),
            "reason": "vision_api_resolved_local_ambiguity",
            "source": "vision_api",
            "api_status": "accepted",
            "api_evidence": dict(provider),
        }
    )
    return result


def arbitrate(
    local: Mapping[str, Any],
    candidate_frames: Mapping[str, Sequence[str]],
    provider: Callable[[Mapping[str, Any]], Mapping[str, Any]],
    *,
    model: str = "gpt-5.6",
) -> dict[str, Any]:
    """Run an injected provider and fail closed to the local abstention."""

    if local.get("status") != "needs_review":
        return {**local, "api_status": "not_needed"}
    candidate_ids = set(list(candidate_frames)[:MAX_CANDIDATES])
    try:
        request = build_request(candidate_frames, model=model)
        raw = provider(request)
        parsed = (
            parse_response(raw, allowed_candidate_ids=candidate_ids)
            if "output" in raw
            else dict(raw)
        )
        return apply_arbiter(
            local,
            parsed,
            allowed_candidate_ids=candidate_ids,
        )
    except Exception:
        return {**local, "api_status": "failed"}


def _jpeg_data_url(frame) -> str:
    ok, encoded = cv2.imencode(
        ".jpg",
        frame,
        [int(cv2.IMWRITE_JPEG_QUALITY), 85],
    )
    if not ok:
        raise ValueError("candidate frame could not be encoded")
    return "data:image/jpeg;base64," + base64.b64encode(
        encoded.tobytes()
    ).decode("ascii")


def extract_candidate_frames(
    clip_path: Path,
    candidate_times: Mapping[str, float],
    *,
    offsets: Sequence[float] = (-0.45, -0.20, 0.0, 0.20, 0.45, 0.70),
    max_dimension: int = 1024,
) -> dict[str, list[str]]:
    """Extract at most two six-frame chronological candidate storyboards."""

    clip_path = Path(clip_path)
    capture = cv2.VideoCapture(str(clip_path))
    if not capture.isOpened():
        raise ValueError("point clip is unreadable")
    output: dict[str, list[str]] = {}
    try:
        for candidate_id, candidate_t in list(candidate_times.items())[
            :MAX_CANDIDATES
        ]:
            if not ANONYMOUS_CANDIDATE.fullmatch(candidate_id):
                raise ValueError("candidate IDs must be anonymous")
            times = sorted(
                {
                    max(0.0, float(candidate_t) + float(offset))
                    for offset in list(offsets)[:MAX_FRAMES_PER_CANDIDATE]
                }
            )
            frames: list[str] = []
            for timestamp in times:
                capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
                ok, frame = capture.read()
                if not ok:
                    continue
                height, width = frame.shape[:2]
                scale = min(
                    1.0,
                    float(max_dimension) / max(width, height),
                )
                if scale < 1.0:
                    frame = cv2.resize(
                        frame,
                        (
                            max(1, round(width * scale)),
                            max(1, round(height * scale)),
                        ),
                        interpolation=cv2.INTER_AREA,
                    )
                frames.append(_jpeg_data_url(frame))
            if frames:
                output[candidate_id] = frames
    finally:
        capture.release()
    if not output:
        raise ValueError("candidate frames are unavailable")
    return output

