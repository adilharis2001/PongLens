#!/usr/bin/env python3
"""Build and seed the hosted cross-match serve-detection research batch."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict, deque
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from typing import Any, Callable, Mapping, Sequence
import uuid

from worker.serve_detection import select_server_hypothesis


ROOT = Path(__file__).resolve().parents[1]
ADMIN_EMAIL = "adilharis2001@gmail.com"
MEDIA_BUCKET = "ponglens-media"
BATCH_SLUG = "serve-detection-cross-match-v1"
BATCH_TITLE = "Cross-match serve detection review"
DESTINATION_PREFIX = "research/serve-detection/v1/sources"
MATCH_QUOTA = 20
TOTAL_SOURCES = 100
HIGH_CONFIDENCE_CAP = 10
FOLLOWUP_TOTAL = 42
FOLLOWUP_OCCLUDED = 23
FOLLOWUP_HIGH_CONFIDENCE_WRONG = 10
FOLLOWUP_CONTROLS_PER_MATCH = 2
MATCH_CONFIG = (
    (
        "vaibhav",
        "2ffe54c7-f2f7-4d32-9a95-fd16174204bb",
        "Vaibhav",
    ),
    ("gui", "a0fb8f44-89b1-464e-a2a5-388b502dbda5", "Gui"),
    ("chris", "8e17b962-e26e-454a-9fe2-8f7c0a3a61de", "Chris"),
    ("faye", "1466e3c3-4578-4c72-b755-bead82ffb289", "Faye"),
    (
        "patrick",
        "e009b852-4fca-4dc5-949c-454d9c2d5b0f",
        "Patrick",
    ),
)


def canonical_hash(payload: Mapping[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


def parse_r2_uri(value: str) -> tuple[str, str]:
    if not value.startswith("r2://"):
        raise ValueError(f"Not an R2 URI: {value}")
    bucket, separator, key = value[5:].partition("/")
    if not separator or not bucket or not key:
        raise ValueError(f"Malformed R2 URI: {value}")
    return bucket, key


@dataclass(frozen=True)
class Candidate:
    match_key: str
    match_id: str
    match_label: str
    point_id: str
    point_idx: int
    clip_path: str
    status: str
    reason: str
    proposal: Mapping[str, Any]
    gold: Mapping[str, Any]
    clip_start_s: float = 0.0


def _other_player(player: str | None) -> str | None:
    if player == "user":
        return "opponent"
    if player == "opponent":
        return "user"
    return None


def _other_side(side: str | None) -> str | None:
    if side == "near":
        return "far"
    if side == "far":
        return "near"
    return None


def point_contexts(
    match: Mapping[str, Any],
    points: Sequence[Mapping[str, Any]],
) -> dict[int, dict[str, Any]]:
    """Resolve scored server and physical ends without detector evidence."""

    first_server = str(match.get("first_server") or "")
    current_server = (
        first_server if first_server in {"user", "opponent"} else None
    )
    game_first = current_server
    configured_side = str(match.get("user_side") or "")
    current_user_side = (
        configured_side if configured_side in {"near", "far"} else None
    )
    serves_in_block = 0
    game_number = 1
    score_user = 0
    score_opponent = 0
    held_open = False
    contexts: dict[int, dict[str, Any]] = {}

    ordered = sorted(
        points,
        key=lambda point: (
            float(point["t0"])
            if point.get("t0") is not None
            else float(point.get("idx") or 0),
            int(point.get("idx") or 0),
        ),
    )
    for point in ordered:
        point_idx = int(point["idx"])
        override = str(point.get("server_override") or "")
        if override not in {"user", "opponent"}:
            override = ""
        if override:
            if (
                current_server is not None
                and game_first is not None
                and override != current_server
            ):
                game_first = _other_player(game_first)
            if current_server is None:
                serves_in_block = 0
            current_server = override
            if game_first is None:
                game_first = current_server

        contexts[point_idx] = {
            "server": current_server,
            "server_source": (
                "override"
                if override
                else "rotation"
                if current_server is not None
                else "unresolved"
            ),
            "user_side": current_user_side,
            "opponent_side": _other_side(current_user_side),
            "game_number": game_number,
            "score_before": {
                "user": score_user,
                "opponent": score_opponent,
            },
        }

        is_let = bool(point.get("is_let"))
        winner = None if is_let else point.get("confirmed_winner")
        if winner == "user":
            score_user += 1
        elif winner == "opponent":
            score_opponent += 1
        else:
            winner = None

        boundary = str(point.get("game_end_override") or "")
        if boundary == "end":
            ended = True
        elif boundary == "continue":
            held_open = True
            ended = False
        elif held_open or winner is None:
            ended = False
        else:
            ended = (
                (score_user >= 11 or score_opponent >= 11)
                and abs(score_user - score_opponent) >= 2
            )

        if not is_let:
            serves_in_block += 1
            deuce = score_user >= 10 and score_opponent >= 10
            if (
                current_server is not None
                and serves_in_block >= (1 if deuce else 2)
            ):
                current_server = _other_player(current_server)
                serves_in_block = 0

        if ended:
            score_user = 0
            score_opponent = 0
            held_open = False
            serves_in_block = 0
            game_number += 1
            game_first = _other_player(game_first)
            current_server = game_first
            current_user_side = _other_side(current_user_side)

    return contexts


def _stable_score(*parts: object) -> str:
    return hashlib.sha256(
        ":".join(str(part) for part in parts).encode()
    ).hexdigest()


def stable_uuid(*parts: object) -> str:
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            ":".join(str(part) for part in parts),
        )
    )


def _followup_rank(source_id: str) -> str:
    return _stable_score("serve-followup-v2", source_id)


def _assignment_by_source(
    export_payload: Mapping[str, Any],
) -> dict[str, Mapping[str, Any]]:
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for raw in export_payload.get("assignments") or []:
        if not isinstance(raw, Mapping):
            continue
        source_id = str(raw.get("source_id") or "")
        if source_id:
            grouped[source_id].append(raw)
    return {
        source_id: sorted(
            rows,
            key=lambda row: (
                0 if row.get("status") == "submitted" else 1,
                int(row.get("sequence") or 0),
                str(row.get("assignment_id") or ""),
            ),
        )[0]
        for source_id, rows in grouped.items()
    }


def choose_followup_sample(
    export_payload: Mapping[str, Any],
    source_rows: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Select the fixed second-pass cohort without mutating first-pass truth."""

    assignment_by_source = _assignment_by_source(export_payload)
    source_by_id = {
        str(source.get("id") or ""): source
        for source in source_rows
        if source.get("id")
    }
    if len(source_by_id) != TOTAL_SOURCES:
        raise ValueError(
            f"follow-up requires {TOTAL_SOURCES} unique research sources"
        )
    if set(source_by_id) != set(assignment_by_source):
        raise ValueError(
            "follow-up export and production source IDs do not match"
        )

    reasons_by_source: dict[str, set[str]] = defaultdict(set)
    for source_id, assignment in assignment_by_source.items():
        human = assignment.get("human_label") or {}
        if human.get("no_observable_serve") == "not_visible":
            reasons_by_source[source_id].add("occluded")

        source = source_by_id[source_id]
        detector = (source.get("proposal") or {}).get("detector") or {}
        gold = assignment.get("gold") or {}
        predicted_side = detector.get("server_side")
        scored_side = gold.get("scored_server_side")
        if (
            detector.get("status") == "high_confidence"
            and predicted_side in {"near", "far"}
            and scored_side in {"near", "far"}
            and predicted_side != scored_side
        ):
            reasons_by_source[source_id].add(
                "high_confidence_wrong_server"
            )

    occluded_count = sum(
        "occluded" in reasons for reasons in reasons_by_source.values()
    )
    wrong_count = sum(
        "high_confidence_wrong_server" in reasons
        for reasons in reasons_by_source.values()
    )
    if occluded_count != FOLLOWUP_OCCLUDED:
        raise ValueError(
            f"expected {FOLLOWUP_OCCLUDED} occluded sources, "
            f"found {occluded_count}"
        )
    if wrong_count != FOLLOWUP_HIGH_CONFIDENCE_WRONG:
        raise ValueError(
            f"expected {FOLLOWUP_HIGH_CONFIDENCE_WRONG} high-confidence "
            f"server disagreements, found {wrong_count}"
        )

    primary_ids = {
        source_id
        for source_id, reasons in reasons_by_source.items()
        if reasons
    }
    expected_primary = (
        FOLLOWUP_OCCLUDED + FOLLOWUP_HIGH_CONFIDENCE_WRONG - 1
    )
    if len(primary_ids) != expected_primary:
        raise ValueError(
            "expected exactly one overlap between occluded and "
            "high-confidence disagreement cohorts"
        )

    for _, _, match_label in MATCH_CONFIG:
        controls = []
        for source_id, source in source_by_id.items():
            if source_id in primary_ids:
                continue
            assignment = assignment_by_source[source_id]
            human = assignment.get("human_label") or {}
            if (
                str(source.get("match_label") or "") != match_label
                or human.get("actual_serve_contact_s") is None
            ):
                continue
            detector = (source.get("proposal") or {}).get("detector") or {}
            gold = assignment.get("gold") or {}
            if (
                detector.get("status") == "high_confidence"
                and detector.get("server_side") in {"near", "far"}
                and gold.get("scored_server_side") in {"near", "far"}
                and detector.get("server_side")
                != gold.get("scored_server_side")
            ):
                continue
            controls.append(source_id)
        controls.sort(key=_followup_rank)
        if len(controls) < FOLLOWUP_CONTROLS_PER_MATCH:
            raise ValueError(
                f"{match_label} has fewer than "
                f"{FOLLOWUP_CONTROLS_PER_MATCH} visible controls"
            )
        for source_id in controls[:FOLLOWUP_CONTROLS_PER_MATCH]:
            reasons_by_source[source_id].add("correct_control")

    selected_ids = {
        source_id
        for source_id, reasons in reasons_by_source.items()
        if reasons
    }
    if len(selected_ids) != FOLLOWUP_TOTAL:
        raise ValueError(
            f"follow-up cohort must contain {FOLLOWUP_TOTAL} sources, "
            f"found {len(selected_ids)}"
        )

    ordered_ids = sorted(selected_ids, key=_followup_rank)
    selected = []
    for order, source_id in enumerate(ordered_ids, start=1):
        selected.append(
            {
                "source_id": source_id,
                "match_label": str(
                    source_by_id[source_id].get("match_label") or ""
                ),
                "order": order,
                "reasons": sorted(reasons_by_source[source_id]),
            }
        )
    return selected


def build_followup_prefill_updates(
    selected: Sequence[Mapping[str, Any]],
    source_rows: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    selected_by_id = {
        str(item["source_id"]): item for item in selected
    }
    updates = []
    for source in sorted(
        source_rows,
        key=lambda item: str(item.get("id") or ""),
    ):
        source_id = str(source.get("id") or "")
        item = selected_by_id.get(source_id)
        updates.append(
            {
                "id": source_id,
                "prefill": {
                    **dict(source.get("prefill") or {}),
                    "followup_v2": {
                        "included": item is not None,
                        "order": int(item["order"]) if item else None,
                        "reasons": list(item["reasons"]) if item else [],
                    },
                },
            }
        )
    return updates


def _candidate_strength(candidate: Mapping[str, Any]) -> float:
    return (
        min(1.0, max(0.0, float(candidate.get("visual_confidence") or 0.0)))
        + min(
            1.0,
            max(0.0, float(candidate.get("audio_confidence") or 0.0)) / 2.0,
        )
        + (0.4 if candidate.get("kind") == "contact" else 0.0)
    )


def _likely_actions(
    detector: Mapping[str, Any],
    reconstruction: Mapping[str, Any],
) -> list[dict[str, Any]]:
    serve = detector.get("serve") or {}
    actions = []
    named = (
        ("serve_contact", serve.get("contact_t")),
        ("serve_first_bounce", serve.get("first_bounce")),
        ("serve_second_bounce", serve.get("second_bounce")),
    )
    for kind, raw in named:
        source_time = raw.get("t") if isinstance(raw, Mapping) else raw
        if source_time is None:
            continue
        actions.append(
            {
                "id": f"detector-{kind}",
                "suggested_type": kind,
                "source_time_s": round(float(source_time), 4),
                "origin": "detector",
                "confidence": (
                    round(float(raw.get("confidence") or 0.0), 4)
                    if isinstance(raw, Mapping)
                    else round(float(detector.get("confidence") or 0.0), 4)
                ),
            }
        )
    if actions:
        return actions[:4]

    candidates = [
        candidate
        for candidate in reconstruction.get("candidates") or []
        if candidate.get("t") is not None
        and candidate.get("kind") in {"contact", "impact", "bounce"}
    ]
    ranked = sorted(
        candidates,
        key=lambda item: (
            -_candidate_strength(item),
            float(item["t"]),
            str(item.get("id") or ""),
        ),
    )[:4]
    return [
        {
            "id": f"candidate-{item.get('id') or index + 1}",
            "suggested_type": (
                "serve_contact"
                if item.get("kind") in {"contact", "impact"}
                else "serve_first_bounce"
            ),
            "source_time_s": round(float(item["t"]), 4),
            "origin": "placement_candidate",
            "confidence": round(_candidate_strength(item), 4),
        }
        for index, item in enumerate(ranked)
    ]


def build_candidates(
    match: Mapping[str, Any],
    points: Sequence[Mapping[str, Any]],
    *,
    selector: Callable[[Mapping[str, Any]], Mapping[str, Any]] = (
        select_server_hypothesis
    ),
) -> list[Candidate]:
    """Build candidates while passing placement—and only placement—to AI."""

    contexts = point_contexts(match, points)
    output = []
    for point in points:
        placement = point.get("placement")
        if not isinstance(placement, Mapping):
            placement = {}
        detector = dict(selector(placement))
        context = contexts[int(point["idx"])]
        scored_server = context.get("server")
        scored_side = (
            context.get("user_side")
            if scored_server == "user"
            else context.get("opponent_side")
            if scored_server == "opponent"
            else None
        )
        detector_safe = {
            key: detector.get(key)
            for key in (
                "version",
                "status",
                "reason",
                "server_side",
                "confidence",
                "score_margin",
            )
        }
        output.append(
            Candidate(
                match_key=str(match["match_key"]),
                match_id=str(match["id"]),
                match_label=str(match["match_label"]),
                point_id=str(point["id"]),
                point_idx=int(point["idx"]),
                clip_path=str(point.get("clip_path") or ""),
                status=str(detector.get("status") or "unavailable"),
                reason=str(detector.get("reason") or "missing_reason"),
                proposal={
                    "schema_version": 1,
                    "detector": detector_safe,
                    "likely_actions": _likely_actions(detector, placement),
                },
                gold={
                    "scored_server_player": scored_server,
                    "scored_server_side": scored_side,
                    "server_source": context.get("server_source"),
                    "game_number": context.get("game_number"),
                    "score_before": context.get("score_before"),
                },
                clip_start_s=round(float(point.get("clip_start_s") or 0.0), 4),
            )
        )
    return output


def _round_robin_needs_review(
    candidates: Sequence[Candidate],
    count: int,
) -> list[Candidate]:
    groups: dict[str, deque[Candidate]] = {}
    for reason, items in sorted(
        (
            (reason, list(group))
            for reason, group in _group_by_reason(candidates).items()
        ),
        key=lambda item: item[0],
    ):
        groups[reason] = deque(
            sorted(
                items,
                key=lambda item: _stable_score(
                    BATCH_SLUG,
                    item.match_key,
                    item.reason,
                    item.point_id,
                ),
            )
        )
    selected = []
    while len(selected) < count and groups:
        for reason in list(groups):
            queue = groups[reason]
            if queue:
                selected.append(queue.popleft())
                if len(selected) == count:
                    break
            if not queue:
                del groups[reason]
    return selected


def _group_by_reason(
    candidates: Sequence[Candidate],
) -> dict[str, list[Candidate]]:
    groups: dict[str, list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        groups[candidate.reason].append(candidate)
    return groups


def choose_sample(candidates: Sequence[Candidate]) -> list[Candidate]:
    """Choose a reproducible 20-point sample for each configured match."""

    selected = []
    expected_keys = [item[0] for item in MATCH_CONFIG]
    # Unit fixtures use the same five keys but synthetic IDs.
    available_keys = {item.match_key for item in candidates}
    if not set(expected_keys).issubset(available_keys):
        missing = sorted(set(expected_keys) - available_keys)
        raise ValueError(f"missing configured matches: {', '.join(missing)}")
    for match_key in expected_keys:
        eligible = [
            item
            for item in candidates
            if item.match_key == match_key
            and item.status in {"high_confidence", "needs_review"}
            and item.clip_path
        ]
        if len(eligible) < MATCH_QUOTA:
            raise ValueError(
                f"{match_key} has {len(eligible)} eligible points; "
                f"20 eligible points are required"
            )
        high = sorted(
            (
                item
                for item in eligible
                if item.status == "high_confidence"
            ),
            key=lambda item: _stable_score(
                BATCH_SLUG,
                item.match_key,
                "high",
                item.point_id,
            ),
        )[:HIGH_CONFIDENCE_CAP]
        needed = MATCH_QUOTA - len(high)
        review = _round_robin_needs_review(
            [
                item
                for item in eligible
                if item.status == "needs_review"
            ],
            needed,
        )
        if len(review) != needed:
            raise ValueError(
                f"{match_key} cannot fill its needs-review quota"
            )
        selected.extend(high)
        selected.extend(review)

    if len(selected) != TOTAL_SOURCES:
        raise ValueError(f"expected {TOTAL_SOURCES} sources, got {len(selected)}")
    if len({item.point_id for item in selected}) != TOTAL_SOURCES:
        raise ValueError("sample contains duplicate point IDs")
    return sorted(
        selected,
        key=lambda item: _stable_score(
            BATCH_SLUG,
            "assignment",
            item.point_id,
        ),
    )


def _pre_roll_for_match(
    match: Mapping[str, Any],
    options_by_job: Mapping[str, Mapping[str, Any]],
) -> float:
    strictness = str(
        options_by_job.get(str(match.get("job_id") or ""), {}).get(
            "strictness",
            "normal",
        )
    )
    return {"tight": 0.5, "normal": 1.0, "loose": 1.6}.get(
        strictness,
        1.0,
    )


def build_manifest(production: Any) -> dict[str, Any]:
    match_ids = [item[1] for item in MATCH_CONFIG]
    matches = production.rest_get(
        "matches",
        select=(
            "id,job_id,opponent_name,venue,user_side,player_near_name,"
            "player_far_name,first_server,first_server_source"
        ),
        id=f"in.({','.join(match_ids)})",
    )
    matches_by_id = {str(item["id"]): dict(item) for item in matches}
    if set(matches_by_id) != set(match_ids):
        raise RuntimeError("one or more configured matches are unavailable")
    job_ids = [
        str(match["job_id"])
        for match in matches
        if match.get("job_id")
    ]
    jobs = (
        production.rest_get(
            "jobs",
            select="id,options",
            id=f"in.({','.join(job_ids)})",
        )
        if job_ids
        else []
    )
    options_by_job = {
        str(job["id"]): dict(job.get("options") or {}) for job in jobs
    }
    points = production.rest_get(
        "points",
        select=(
            "id,match_id,idx,t0,t1,clip_path,placement,confirmed_winner,"
            "server_override,is_let,game_end_override,deleted,tight_start"
        ),
        match_id=f"in.({','.join(match_ids)})",
        deleted="eq.false",
        order="match_id.asc,idx.asc",
    )
    points_by_match: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for point in points:
        points_by_match[str(point["match_id"])].append(dict(point))

    candidates = []
    manifest_matches = []
    for match_key, match_id, label in MATCH_CONFIG:
        match = matches_by_id[match_id]
        match.update({"match_key": match_key, "match_label": label})
        pre_roll = _pre_roll_for_match(match, options_by_job)
        match_points = points_by_match[match_id]
        for point in match_points:
            point["clip_start_s"] = max(
                0.0,
                float(point.get("t0") or 0.0)
                - (min(pre_roll, 0.3) if point.get("tight_start") else pre_roll),
            )
        candidates.extend(build_candidates(match, match_points))
        manifest_matches.append(
            {
                "match_key": match_key,
                "match_id": match_id,
                "match_label": label,
                "eligible_points": len(match_points),
            }
        )

    selected = choose_sample(candidates)
    manifest = {
        "schema_version": 1,
        "batch_slug": BATCH_SLUG,
        "matches": manifest_matches,
        "selected": [asdict(item) for item in selected],
        "summary": {
            "total": len(selected),
            "by_match": dict(
                sorted(Counter(item.match_key for item in selected).items())
            ),
            "by_status": dict(
                sorted(Counter(item.status for item in selected).items())
            ),
            "by_reason": dict(
                sorted(Counter(item.reason for item in selected).items())
            ),
        },
    }
    manifest["manifest_sha256"] = canonical_hash(manifest)
    return manifest


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probe_video(path: Path) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=avg_frame_rate,nb_frames:format=duration",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(completed.stdout)
    stream = payload["streams"][0]
    numerator, denominator = str(
        stream.get("avg_frame_rate") or "0/1"
    ).split("/", maxsplit=1)
    fps = float(numerator) / max(1.0, float(denominator))
    duration = float(payload["format"]["duration"])
    frame_count = int(stream.get("nb_frames") or round(duration * fps))
    if duration <= 0 or fps <= 0 or frame_count <= 0:
        raise RuntimeError(f"invalid video metadata for {path.name}")
    return {
        "duration_s": round(duration, 4),
        "fps": round(fps, 4),
        "frame_count": frame_count,
    }


def _admin_user(production: Any) -> dict[str, Any]:
    import requests

    response = requests.get(
        f"{production.supabase_url}/auth/v1/admin/users",
        headers=production.headers,
        params={"page": 1, "per_page": 1000},
        timeout=60,
    )
    response.raise_for_status()
    user = next(
        (
            item
            for item in response.json().get("users", [])
            if (item.get("email") or "").lower() == ADMIN_EMAIL
        ),
        None,
    )
    if not user:
        raise RuntimeError(f"admin account {ADMIN_EMAIL} not found")
    return user


def _verified_manifest(payload: Mapping[str, Any]) -> dict[str, Any]:
    manifest = dict(payload)
    supplied_hash = str(manifest.pop("manifest_sha256", ""))
    if supplied_hash != canonical_hash(manifest):
        raise ValueError("manifest hash does not match its contents")
    if manifest.get("batch_slug") != BATCH_SLUG:
        raise ValueError("manifest belongs to another batch")
    selected = manifest.get("selected") or []
    if len(selected) != TOTAL_SOURCES:
        raise ValueError("manifest must contain exactly 100 sources")
    if Counter(item["match_key"] for item in selected) != Counter(
        {item[0]: MATCH_QUOTA for item in MATCH_CONFIG}
    ):
        raise ValueError("manifest match quotas are invalid")
    manifest["manifest_sha256"] = supplied_hash
    return manifest


def _review_proposal(
    item: Mapping[str, Any],
    video: Mapping[str, Any],
) -> dict[str, Any]:
    duration = float(video["duration_s"])
    clip_start = float(item.get("clip_start_s") or 0.0)
    actions = []
    for action in (item.get("proposal") or {}).get("likely_actions") or []:
        relative = float(action["source_time_s"]) - clip_start
        if relative < 0 or relative > duration:
            continue
        actions.append(
            {
                "id": str(action["id"]),
                "suggested_type": str(action["suggested_type"]),
                "time_s": round(relative, 4),
                "origin": str(action["origin"]),
                "confidence": action.get("confidence"),
            }
        )
    return {
        "schema_version": 1,
        "detector": dict((item.get("proposal") or {}).get("detector") or {}),
        "likely_actions": actions[:4],
        "video": dict(video),
        "scored_server": {
            "player": (item.get("gold") or {}).get("scored_server_player"),
            "side": (item.get("gold") or {}).get("scored_server_side"),
            "source": (item.get("gold") or {}).get("server_source"),
        },
    }


def apply_migration(production: Any) -> None:
    import psycopg2

    sql = (
        ROOT / "supabase/migrations/056_serve_detection_research.sql"
    ).read_text()
    connection = psycopg2.connect(production.db_url)
    connection.autocommit = False
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def seed(production: Any, payload: Mapping[str, Any]) -> dict[str, Any]:
    manifest = _verified_manifest(payload)
    selected = manifest["selected"]
    point_ids = [str(item["point_id"]) for item in selected]
    points = production.rest_get(
        "points",
        select="id,clip_path",
        id=f"in.({','.join(point_ids)})",
    )
    point_by_id = {str(point["id"]): point for point in points}
    if set(point_ids) != set(point_by_id):
        raise RuntimeError("one or more sealed source points are unavailable")

    admin = _admin_user(production)
    reviewer_id = str(admin["id"])
    batch_id = stable_uuid("research-batch", BATCH_SLUG)
    production.upsert(
        "research_batches",
        {
            "id": batch_id,
            "slug": BATCH_SLUG,
            "title": BATCH_TITLE,
            "schema_version": 1,
            "status": "draft",
        },
        "slug",
    )
    production.upsert(
        "research_reviewers",
        {
            "user_id": reviewer_id,
            "role": "admin",
            "active": True,
            "added_by": reviewer_id,
        },
        "user_id",
    )
    existing = production.rest_get(
        "research_sources",
        select="id,source_point_id,media_sha256,manifest_sha256",
        batch_id=f"eq.{batch_id}",
    )
    existing_by_point = {
        str(item["source_point_id"]): item for item in existing
    }
    source_rows = []
    source_id_by_point: dict[str, str] = {}
    gold_rows = []
    with tempfile.TemporaryDirectory(
        prefix="ponglens-serve-research-"
    ) as directory:
        temp_dir = Path(directory)
        for number, item in enumerate(selected, start=1):
            point_id = str(item["point_id"])
            source_id = stable_uuid(BATCH_SLUG, "source", point_id)
            source_id_by_point[point_id] = source_id
            source_uri = str(point_by_id[point_id]["clip_path"] or "")
            if source_uri != str(item["clip_path"]):
                raise RuntimeError(
                    f"source clip changed for {item['match_key']} "
                    f"point {item['point_idx']}"
                )
            bucket, key = parse_r2_uri(source_uri)
            local_path = temp_dir / f"{source_id}.mp4"
            production.r2.download_file(bucket, key, str(local_path))
            if not local_path.is_file() or local_path.stat().st_size == 0:
                raise RuntimeError(f"empty source clip for {point_id}")
            video = probe_video(local_path)
            proposal = _review_proposal(item, video)
            media_hash = _sha256_file(local_path)
            source_manifest_hash = canonical_hash(
                {
                    "proposal": proposal,
                    "gold": item["gold"],
                    "media_sha256": media_hash,
                }
            )
            prior = existing_by_point.get(point_id)
            if prior:
                if (
                    prior["media_sha256"] != media_hash
                    or prior["manifest_sha256"] != source_manifest_hash
                ):
                    raise RuntimeError(
                        f"frozen source changed for {point_id}"
                    )
            else:
                destination_key = (
                    f"{DESTINATION_PREFIX}/{source_id}.mp4"
                )
                production.r2.upload_file(
                    str(local_path),
                    MEDIA_BUCKET,
                    destination_key,
                    ExtraArgs={
                        "ContentType": "video/mp4",
                        "Metadata": {
                            "source-sha256": media_hash,
                            "manifest-sha256": source_manifest_hash,
                        },
                    },
                )
                source_rows.append(
                    {
                        "id": source_id,
                        "batch_id": batch_id,
                        "source_match_id": item["match_id"],
                        "source_point_id": point_id,
                        "source_point_idx": item["point_idx"],
                        "match_label": item["match_label"],
                        "player_near_name": None,
                        "player_far_name": None,
                        "venue_label": None,
                        "media_key": destination_key,
                        "media_sha256": media_hash,
                        "manifest_sha256": source_manifest_hash,
                        "duration_s": video["duration_s"],
                        "proposal": proposal,
                        "prefill": {
                            "match_key": item["match_key"],
                            "detector_status": item["status"],
                        },
                    }
                )
            gold_rows.append(
                {
                    "source_id": source_id,
                    "gold_label": item["gold"],
                    "provenance": (
                        "Owner-confirmed first server and PongLens ITTF "
                        "score rotation"
                    ),
                    "adjudicated_by": reviewer_id,
                }
            )
            print(f"[{number}/{TOTAL_SOURCES}] frozen {item['match_key']}")

    if source_rows:
        production.upsert(
            "research_sources",
            source_rows,
            "batch_id,source_point_id",
        )
    production.upsert("research_gold_labels", gold_rows, "source_id")

    sources = production.rest_get(
        "research_sources",
        select="id,source_point_id",
        batch_id=f"eq.{batch_id}",
    )
    source_id_by_point.update(
        {
            str(source["source_point_id"]): str(source["id"])
            for source in sources
        }
    )
    if len(source_id_by_point) != TOTAL_SOURCES:
        raise RuntimeError("research source count is not 100")
    existing_assignments = production.rest_get(
        "research_assignments",
        select="id,sequence",
        batch_id=f"eq.{batch_id}",
        reviewer_id=f"eq.{reviewer_id}",
    )
    if not existing_assignments:
        assignments = []
        for sequence, item in enumerate(selected, start=1):
            source_id = source_id_by_point[str(item["point_id"])]
            assignments.append(
                {
                    "id": stable_uuid(
                        BATCH_SLUG,
                        reviewer_id,
                        sequence,
                        source_id,
                    ),
                    "batch_id": batch_id,
                    "source_id": source_id,
                    "reviewer_id": reviewer_id,
                    "sequence": sequence,
                    "duplicate_group": None,
                    "is_repeat": False,
                }
            )
        production.upsert(
            "research_assignments",
            assignments,
            "batch_id,reviewer_id,sequence",
        )
    elif len(existing_assignments) != TOTAL_SOURCES:
        raise RuntimeError("existing owner assignment count is not 100")

    production.upsert(
        "research_batches",
        {
            "id": batch_id,
            "slug": BATCH_SLUG,
            "title": BATCH_TITLE,
            "schema_version": 1,
            "status": "active",
        },
        "slug",
    )
    return audit(production)


def mark_followup_sources(
    production: Any,
    export_payload: Mapping[str, Any],
) -> dict[str, Any]:
    """Mark the existing second-pass cohort without touching assignments."""

    import requests

    batches = production.rest_get(
        "research_batches",
        select="id,slug",
        slug=f"eq.{BATCH_SLUG}",
    )
    if len(batches) != 1:
        raise RuntimeError("serve research batch is missing")
    batch_id = str(batches[0]["id"])
    if str((export_payload.get("batch") or {}).get("id") or "") != batch_id:
        raise RuntimeError("export belongs to a different research batch")

    sources = production.rest_get(
        "research_sources",
        select="id,match_label,proposal,prefill",
        batch_id=f"eq.{batch_id}",
    )
    selected = choose_followup_sample(export_payload, sources)
    updates = build_followup_prefill_updates(selected, sources)
    for update in updates:
        response = requests.patch(
            f"{production.supabase_url}/rest/v1/research_sources",
            headers={
                **production.headers,
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            params={"id": f"eq.{update['id']}"},
            json={"prefill": update["prefill"]},
            timeout=60,
        )
        response.raise_for_status()

    audited_sources = production.rest_get(
        "research_sources",
        select="id,match_label,prefill",
        batch_id=f"eq.{batch_id}",
    )
    marked = [
        source
        for source in audited_sources
        if (source.get("prefill") or {})
        .get("followup_v2", {})
        .get("included")
        is True
    ]
    if len(marked) != FOLLOWUP_TOTAL:
        raise RuntimeError("production follow-up count is not 42")
    orders = sorted(
        int(source["prefill"]["followup_v2"]["order"])
        for source in marked
    )
    if orders != list(range(1, FOLLOWUP_TOTAL + 1)):
        raise RuntimeError("production follow-up order is invalid")
    reason_counts = Counter(
        reason
        for source in marked
        for reason in source["prefill"]["followup_v2"]["reasons"]
    )
    control_by_match = Counter(
        str(source.get("match_label") or "")
        for source in marked
        if "correct_control"
        in source["prefill"]["followup_v2"]["reasons"]
    )
    expected_controls = Counter(
        {
            match_label: FOLLOWUP_CONTROLS_PER_MATCH
            for _, _, match_label in MATCH_CONFIG
        }
    )
    if control_by_match != expected_controls:
        raise RuntimeError("production follow-up control strata are invalid")
    return {
        "batch_id": batch_id,
        "included": len(marked),
        "reason_counts": dict(sorted(reason_counts.items())),
        "controls_by_match": dict(sorted(control_by_match.items())),
    }


def audit(production: Any) -> dict[str, Any]:
    batches = production.rest_get(
        "research_batches",
        select="id,slug,status",
        slug=f"eq.{BATCH_SLUG}",
    )
    if len(batches) != 1:
        raise RuntimeError("serve research batch is missing")
    batch = batches[0]
    sources = production.rest_get(
        "research_sources",
        select="id,match_label,media_key,prefill",
        batch_id=f"eq.{batch['id']}",
    )
    assignments = production.rest_get(
        "research_assignments",
        select="id,reviewer_id,sequence",
        batch_id=f"eq.{batch['id']}",
        order="reviewer_id.asc,sequence.asc",
    )
    gold = production.rest_get(
        "research_gold_labels",
        select="source_id",
        source_id=f"in.({','.join(str(item['id']) for item in sources)})",
    )
    if len(sources) != TOTAL_SOURCES or len(gold) != TOTAL_SOURCES:
        raise RuntimeError("production research source/gold count is invalid")
    owner_counts = Counter(item["reviewer_id"] for item in assignments)
    if TOTAL_SOURCES not in owner_counts.values():
        raise RuntimeError("no reviewer has a complete 100-point queue")
    for source in sources:
        production.r2.head_object(
            Bucket=MEDIA_BUCKET,
            Key=str(source["media_key"]),
        )
    by_match = Counter(
        str((source.get("prefill") or {}).get("match_key"))
        for source in sources
    )
    if by_match != Counter({item[0]: MATCH_QUOTA for item in MATCH_CONFIG}):
        raise RuntimeError("production match quotas are invalid")
    return {
        "batch_id": str(batch["id"]),
        "status": str(batch["status"]),
        "sources": len(sources),
        "gold_labels": len(gold),
        "reviewer_queues": dict(owner_counts),
        "by_match": dict(sorted(by_match.items())),
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build-manifest")
    build.add_argument("--output", type=Path, required=True)
    subparsers.add_parser("apply-migration")
    seed_parser = subparsers.add_parser("seed")
    seed_parser.add_argument("--manifest", type=Path, required=True)
    followup = subparsers.add_parser("mark-followup")
    followup.add_argument("--export", type=Path, required=True)
    subparsers.add_parser("audit")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    from worker.build_research_pilot import Production

    production = Production()
    if args.command == "build-manifest":
        manifest = build_manifest(production)
        args.output.write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps(manifest["summary"], indent=2, sort_keys=True))
        return 0
    if args.command == "apply-migration":
        apply_migration(production)
        print("applied serve detection research migration 056")
        return 0
    if args.command == "seed":
        result = seed(
            production,
            json.loads(args.manifest.read_text()),
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    if args.command == "mark-followup":
        result = mark_followup_sources(
            production,
            json.loads(args.export.read_text()),
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    if args.command == "audit":
        print(json.dumps(audit(production), indent=2, sort_keys=True))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
