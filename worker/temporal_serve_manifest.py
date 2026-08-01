"""Seal a blinded, match-separated temporal serve experiment cohort."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence
from zoneinfo import ZoneInfo

from worker.build_serve_detection_research import point_contexts


SCHEMA_VERSION = 1
FORBIDDEN_INPUT_KEYS = {
    "confirmed_winner",
    "expected_server_side",
    "first_server",
    "first_server_source",
    "gold",
    "human_label",
    "player_identity",
    "reviewer_id",
    "score_before",
    "scored_server_side",
    "winner",
}


class ProductionReader(Protocol):
    def list_temporal_serve_matches(self) -> Sequence[Mapping[str, Any]]:
        """Return candidate matches with their point rows and calibration."""


@dataclass(frozen=True)
class EligibleMatch:
    match_id: str
    label: str
    created_at: str
    points: tuple[dict[str, Any], ...]


def _canonical_hash(payload: Mapping[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _other_side(side: str) -> str:
    return "far" if side == "near" else "near"


def _expected_side(context: Mapping[str, Any]) -> str | None:
    server = context.get("server")
    user_side = context.get("user_side")
    if server not in {"user", "opponent"} or user_side not in {"near", "far"}:
        return None
    return str(user_side) if server == "user" else _other_side(str(user_side))


def _eligible_match(raw: Mapping[str, Any]) -> EligibleMatch | None:
    if raw.get("first_server_source") != "user":
        return None
    if raw.get("first_server") not in {"user", "opponent"}:
        return None
    if raw.get("user_side") not in {"near", "far"}:
        return None
    calibration = raw.get("calibration") or {}
    if not calibration.get("ok") or not calibration.get("table_corners_px"):
        return None
    points = [dict(point) for point in raw.get("points") or []]
    contexts = point_contexts(raw, points)
    sealed = []
    for point in sorted(
        points,
        key=lambda item: (
            float(item.get("t0") or item.get("idx") or 0),
            int(item.get("idx") or 0),
        ),
    ):
        if point.get("confirmed_winner") not in {"user", "opponent"}:
            continue
        if bool(point.get("is_let")):
            continue
        clip_uri = str(point.get("clip_path") or "")
        media_sha256 = str(point.get("clip_sha256") or "")
        if not clip_uri or len(media_sha256) != 64:
            continue
        context = contexts.get(int(point["idx"])) or {}
        expected = _expected_side(context)
        if expected is None:
            continue
        point_id = str(point["id"])
        match_id = str(raw["id"])
        sealed.append(
            {
                "source_id": f"temporal:{match_id}:{point_id}",
                "source_point_id": point_id,
                "source_point_idx": int(point["idx"]),
                "model_input": {
                    "source_id": f"temporal:{match_id}:{point_id}",
                    "source_match_id": match_id,
                    "source_point_id": point_id,
                    "source_point_idx": int(point["idx"]),
                    "clip_uri": clip_uri,
                    "media_sha256": media_sha256,
                    "placement": deepcopy(point.get("placement") or {}),
                    "calibration": deepcopy(calibration),
                },
                "evaluation": {
                    "expected_server_side": expected,
                    "server_source": str(context.get("server_source") or ""),
                    "game_number": int(context.get("game_number") or 1),
                },
            }
        )
    if len(sealed) < 5:
        return None
    return EligibleMatch(
        match_id=str(raw["id"]),
        label=str(raw.get("label") or raw.get("opponent_name") or ""),
        created_at=str(raw.get("created_at") or ""),
        points=tuple(sealed),
    )


def _stable_order(match_id: str) -> str:
    return hashlib.sha256(f"temporal-serve-scale-v1:{match_id}".encode()).hexdigest()


def _split_matches(
    matches: Sequence[EligibleMatch],
    canary_id: str,
) -> dict[str, list[EligibleMatch]]:
    ordered = sorted(matches, key=lambda item: (_stable_order(item.match_id), item.match_id))
    canary = next(item for item in ordered if item.match_id == canary_id)
    remaining = [item for item in ordered if item.match_id != canary_id]
    count = len(ordered)
    holdout_count = min(count - 2, max(1, 10 if count >= 12 else math.ceil(count * 0.30)))
    development_count = min(
        count - holdout_count - 1,
        max(1, round(count * 0.20)),
    )
    holdout = [canary, *remaining[: max(0, holdout_count - 1)]]
    development = remaining[max(0, holdout_count - 1) : max(0, holdout_count - 1) + development_count]
    train = remaining[max(0, holdout_count - 1) + development_count :]
    return {"train": train, "development": development, "holdout": holdout}


def _round_robin_points(
    matches: Sequence[EligibleMatch],
    target_points: int,
) -> dict[str, list[dict[str, Any]]]:
    cap = max(5, math.ceil(target_points / max(1, len(matches)) * 1.5))
    available = {
        match.match_id: list(match.points[:cap])
        for match in matches
    }
    selected = {match.match_id: [] for match in matches}
    ordered = sorted(matches, key=lambda item: (_stable_order(item.match_id), item.match_id))
    cursor = 0
    while sum(len(items) for items in selected.values()) < target_points:
        progressed = False
        for match in ordered:
            items = available[match.match_id]
            if cursor < len(items):
                selected[match.match_id].append(items[cursor])
                progressed = True
                if sum(len(value) for value in selected.values()) >= target_points:
                    break
        if not progressed:
            break
        cursor += 1
    return selected


def _find_chris_canary(
    matches: Sequence[EligibleMatch],
    chris_date: str,
    canary_timezone: str,
) -> EligibleMatch:
    expected_date = datetime.fromisoformat(chris_date).date()
    zone = ZoneInfo(canary_timezone)

    def local_created_date(match: EligibleMatch):
        raw = match.created_at.replace("Z", "+00:00")
        try:
            created = datetime.fromisoformat(raw)
        except ValueError:
            return None
        if created.tzinfo is None:
            return created.date()
        return created.astimezone(zone).date()

    candidates = [
        match
        for match in matches
        if "chris" in match.label.lower()
        and local_created_date(match) == expected_date
    ]
    if not candidates:
        raise ValueError(f"no eligible Chris match found on {chris_date}")
    return max(candidates, key=lambda item: (item.created_at, item.match_id))


def build_manifest(
    production: ProductionReader,
    *,
    target_points: int = 1000,
    minimum_matches: int = 30,
    chris_date: str = "2026-07-30",
    canary_timezone: str = "America/New_York",
) -> dict[str, Any]:
    if target_points <= 0 or minimum_matches < 3:
        raise ValueError("target points must be positive and minimum matches at least three")
    matches = [
        match
        for raw in production.list_temporal_serve_matches()
        if (match := _eligible_match(raw)) is not None
    ]
    if len(matches) < 3:
        raise ValueError("at least three eligible matches are required")
    canary = _find_chris_canary(matches, chris_date, canary_timezone)
    selected = _round_robin_points(matches, target_points)
    matches = [match for match in matches if selected[match.match_id]]
    splits = _split_matches(matches, canary.match_id)
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "experiment": "temporal-serve-scale-v1",
        "status": "complete" if len(matches) >= minimum_matches else "preliminary",
        "target_points": int(target_points),
        "minimum_matches": int(minimum_matches),
        "canary_local_date": chris_date,
        "canary_timezone": canary_timezone,
        "holdout_canaries": [canary.match_id],
        "splits": {
            name: [
                {
                    "match_id": match.match_id,
                    "match_label": match.label,
                    "created_at": match.created_at,
                    "points": selected[match.match_id],
                }
                for match in split_matches
            ]
            for name, split_matches in splits.items()
        },
    }
    payload["counts"] = {
        "matches": len(matches),
        "points": sum(
            len(match["points"])
            for split in payload["splits"].values()
            for match in split
        ),
        "by_split": {
            name: {
                "matches": len(items),
                "points": sum(len(item["points"]) for item in items),
            }
            for name, items in payload["splits"].items()
        },
    }
    payload["manifest_sha256"] = _canonical_hash(payload)
    validate_manifest(payload)
    return payload


def _assert_blinded(value: Any, path: str = "model_input") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = str(key).lower()
            if normalized in FORBIDDEN_INPUT_KEYS or (
                normalized == "score" and path == "model_input"
            ):
                raise ValueError(f"forbidden model input key at {path}.{key}")
            _assert_blinded(child, f"{path}.{key}")
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for index, child in enumerate(value):
            _assert_blinded(child, f"{path}[{index}]")


def validate_manifest(manifest: Mapping[str, Any]) -> None:
    if int(manifest.get("schema_version") or 0) != SCHEMA_VERSION:
        raise ValueError("unsupported temporal serve manifest schema")
    splits = manifest.get("splits") or {}
    if set(splits) != {"train", "development", "holdout"}:
        raise ValueError("manifest requires train, development, and holdout splits")
    ids_by_split: dict[str, set[str]] = {}
    point_count = 0
    for name, matches in splits.items():
        ids = {str(match.get("match_id") or "") for match in matches}
        if not all(ids) or len(ids) != len(matches):
            raise ValueError(f"duplicate or missing match ID in {name}")
        ids_by_split[name] = ids
        for match in matches:
            for point in match.get("points") or []:
                _assert_blinded(point.get("model_input") or {})
                expected = (point.get("evaluation") or {}).get("expected_server_side")
                if expected not in {"near", "far"}:
                    raise ValueError("point evaluation lacks physical server truth")
                point_count += 1
    if ids_by_split["train"] & ids_by_split["development"]:
        raise ValueError("train and development match leakage")
    if ids_by_split["train"] & ids_by_split["holdout"]:
        raise ValueError("train and holdout match leakage")
    if ids_by_split["development"] & ids_by_split["holdout"]:
        raise ValueError("development and holdout match leakage")
    canaries = set(manifest.get("holdout_canaries") or [])
    if not canaries or not canaries <= ids_by_split["holdout"]:
        raise ValueError("holdout canary is missing from holdout")
    if canaries & (ids_by_split["train"] | ids_by_split["development"]):
        raise ValueError("holdout canary leaked into fitting data")
    counts = manifest.get("counts") or {}
    if int(counts.get("points") or -1) != point_count:
        raise ValueError("manifest point count mismatch")


def write_manifest_atomic(path: Path, manifest: Mapping[str, Any]) -> None:
    validate_manifest(manifest)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.tmp"
    temporary.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)
