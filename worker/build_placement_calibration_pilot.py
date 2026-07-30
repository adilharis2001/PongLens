#!/usr/bin/env python3
"""Freeze the authenticated cross-venue placement calibration pilot."""

from __future__ import annotations

import hashlib
import argparse
import json
from pathlib import Path
import subprocess
import uuid
from collections import defaultdict
from typing import Any, Iterable, Mapping, Sequence

import psycopg2
import requests

from worker.build_research_pilot import (
    ADMIN_EMAIL,
    MEDIA_BUCKET,
    Production,
    canonical_hash,
    parse_r2_uri,
)


BATCH_SLUG = "placement-calibration-cross-venue-v1"
BATCH_TITLE = "Cross-venue placement calibration"
PRIMARY_EVENT_COUNT = 42
REPEAT_COUNT = 6
MATCH_COUNT = 6
PER_MATCH_COUNT = PRIMARY_EVENT_COUNT // MATCH_COUNT
COMPARISON_CLASSES = (
    "disagreement",
    "agreement",
    "one_arm_abstention",
)
DESTINATION_PREFIX = "research/placement-calibration/v1/sources"
ROOT = Path(__file__).resolve().parents[1]


def _point_contexts(prepared: Mapping[str, Any]) -> dict[int, dict]:
    """Resolve scored server rotation and the user's physical end per point."""
    truth = prepared.get("truth") or {}
    first_server = str(truth.get("first_server") or "")
    current_server = (
        first_server if first_server in {"user", "opponent"} else None
    )
    game_first = current_server
    user_side = str(truth.get("user_side") or "")
    current_user_side = user_side if user_side in {"near", "far"} else None
    serves_in_block = 0
    game_number = 1
    score_user = 0
    score_opponent = 0
    held_open = False
    contexts: dict[int, dict] = {}

    def other_player(player: str | None) -> str | None:
        if player == "user":
            return "opponent"
        if player == "opponent":
            return "user"
        return None

    def other_side(side: str | None) -> str | None:
        if side == "near":
            return "far"
        if side == "far":
            return "near"
        return None

    points = sorted(
        prepared.get("points") or [],
        key=lambda point: (
            float(point["t0"])
            if point.get("t0") is not None
            else float(point.get("idx") or 0),
            int(point.get("idx") or 0),
        ),
    )
    for point in points:
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
                game_first = other_player(game_first)
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
            "opponent_side": other_side(current_user_side),
            "game_number": game_number,
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
                current_server = other_player(current_server)
                serves_in_block = 0

        if ended:
            score_user = 0
            score_opponent = 0
            held_open = False
            serves_in_block = 0
            game_number += 1
            game_first = other_player(game_first)
            current_server = game_first
            current_user_side = other_side(current_user_side)

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


def _candidate_key(candidate: Mapping[str, Any]) -> tuple[Any, ...]:
    return (
        int(candidate["match_index"]),
        int(candidate["point_idx"]),
        int(candidate["shot_seq"]),
        str(candidate["phase"]),
        str(candidate["event_id"]),
    )


def _ordered(candidates: Iterable[Mapping[str, Any]]) -> list[dict]:
    return sorted(
        (dict(candidate) for candidate in candidates),
        key=lambda item: (
            _stable_score(BATCH_SLUG, *_candidate_key(item)),
            _candidate_key(item),
        ),
    )


def _take(
    selected: list[dict],
    remaining: list[dict],
    predicate,
    count: int = 1,
) -> None:
    if count <= 0:
        return
    existing_points = {
        (int(item["match_index"]), int(item["point_idx"]))
        for item in selected
    }
    for candidate in list(remaining):
        point_key = (
            int(candidate["match_index"]),
            int(candidate["point_idx"]),
        )
        if point_key in existing_points or not predicate(candidate):
            continue
        selected.append(candidate)
        remaining.remove(candidate)
        existing_points.add(point_key)
        count -= 1
        if count == 0:
            return


def select_pilot_events(
    candidates: Sequence[Mapping[str, Any]],
) -> list[dict]:
    """Select a frozen balanced set without consulting human labels."""
    eligible = [
        dict(candidate)
        for candidate in candidates
        if candidate.get("scored_server") is True
        and str(candidate.get("phase")) in {"serve", "return", "rally"}
        and str(candidate.get("comparison_class")) in COMPARISON_CLASSES
    ]
    by_match: dict[int, list[dict]] = defaultdict(list)
    for candidate in eligible:
        by_match[int(candidate["match_index"])].append(candidate)
    if sorted(by_match) != list(range(1, MATCH_COUNT + 1)):
        raise ValueError("pilot requires exactly six numbered match strata")

    selected: list[dict] = []
    for match_index in range(1, MATCH_COUNT + 1):
        remaining = _ordered(by_match[match_index])
        match_selected: list[dict] = []
        for comparison_class in COMPARISON_CLASSES:
            _take(
                match_selected,
                remaining,
                lambda item, wanted=comparison_class: (
                    item["comparison_class"] == wanted
                ),
            )
        for phase in ("serve", "return"):
            needed = 2 - sum(
                item["phase"] == phase for item in match_selected
            )
            if needed > 0:
                _take(
                    match_selected,
                    remaining,
                    lambda item, wanted=phase: item["phase"] == wanted,
                    needed,
                )
        _take(
            match_selected,
            remaining,
            lambda _item: True,
            PER_MATCH_COUNT - len(match_selected),
        )
        if len(match_selected) != PER_MATCH_COUNT:
            raise ValueError(
                f"match stratum {match_index} cannot supply seven events"
            )
        if sum(item["phase"] == "serve" for item in match_selected) < 2:
            raise ValueError(f"match stratum {match_index} lacks serve events")
        if sum(item["phase"] == "return" for item in match_selected) < 2:
            raise ValueError(f"match stratum {match_index} lacks return events")
        selected.extend(match_selected)

    near_count = sum(item.get("user_side") == "near" for item in selected)
    far_count = sum(item.get("user_side") == "far" for item in selected)
    if min(near_count, far_count) < 15:
        raise ValueError(
            "selected events do not cover at least 15 user-near and 15 user-far"
        )
    return sorted(selected, key=_candidate_key)


def build_assignment_order(
    selected: Sequence[Mapping[str, Any]],
) -> list[dict]:
    """Add six deterministic hidden repeats and obscure their sequence."""
    canonical = sorted(
        (dict(item) for item in selected),
        key=_candidate_key,
    )
    if len(canonical) != PRIMARY_EVENT_COUNT:
        raise ValueError("assignment order requires 42 primary events")
    repeat_sources = sorted(
        canonical,
        key=lambda item: _stable_score(
            BATCH_SLUG,
            "repeat",
            item["event_id"],
        ),
    )[:REPEAT_COUNT]
    jobs = [
        {
            "source_event_id": str(item["event_id"]),
            "is_repeat": False,
            "duplicate_group": None,
        }
        for item in canonical
    ]
    jobs.extend(
        {
            "source_event_id": str(item["event_id"]),
            "is_repeat": True,
            "duplicate_group": stable_uuid(
                BATCH_SLUG,
                "duplicate",
                item["event_id"],
            ),
        }
        for item in repeat_sources
    )
    jobs.sort(
        key=lambda item: _stable_score(
            BATCH_SLUG,
            "assignment",
            item["source_event_id"],
            int(item["is_repeat"]),
        )
    )
    for sequence, job in enumerate(jobs, start=1):
        job["sequence"] = sequence
    return jobs


def _other_side(side: str) -> str:
    if side == "near":
        return "far"
    if side == "far":
        return "near"
    raise ValueError(f"invalid physical side: {side}")


def _prediction_for_proposal(
    prediction: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    if prediction is None:
        return None
    return {
        "u": float(prediction["u"]),
        "v": float(prediction["v"]),
        "confidence": (
            float(prediction["confidence"])
            if prediction.get("confidence") is not None
            else None
        ),
        "zone": prediction.get("zone"),
    }


def build_manifest(
    cases_payload: Mapping[str, Any],
    comparison_payload: Mapping[str, Any],
) -> dict[str, Any]:
    """Build the sealed candidate and selection manifest."""
    prepared_by_id = {
        str(case["match_id"]): case
        for case in cases_payload.get("cases") or []
    }
    comparison_by_id = {
        str(case["match_id"]): case
        for case in comparison_payload.get("cases") or []
    }
    if set(prepared_by_id) != set(comparison_by_id):
        raise ValueError("prepared and comparison match sets differ")

    candidates = []
    for match_index, prepared in enumerate(
        cases_payload.get("cases") or [],
        start=1,
    ):
        match_id = str(prepared["match_id"])
        compared = comparison_by_id[match_id]
        contexts = _point_contexts(prepared)
        points = {
            int(point["idx"]): point
            for point in prepared.get("points") or []
        }
        for event in compared.get("event_candidates") or []:
            identity = event.get("identity") or {}
            point_idx = int(identity["point_idx"])
            context = contexts.get(point_idx) or {}
            user_side = context.get("user_side")
            opponent_side = context.get("opponent_side")
            server_side = str(identity.get("server_side") or "")
            if server_side == user_side:
                hypothesis_server = "user"
            elif server_side == opponent_side:
                hypothesis_server = "opponent"
            else:
                hypothesis_server = None
            scored_server = context.get("server")
            hitter_side = str(identity.get("hitter_side") or "")
            if (
                hypothesis_server is None
                or scored_server not in {"user", "opponent"}
                or user_side not in {"near", "far"}
                or hitter_side not in {"near", "far"}
            ):
                eligible = False
            else:
                eligible = hypothesis_server == scored_server
            phase = str(identity.get("phase") or "")
            shot_seq = int(identity.get("shot_seq") or 0)
            point = points.get(point_idx) or {}
            event_absolute = event.get("event_time_s")
            event_relative = (
                round(float(event_absolute) - float(point.get("t0") or 0) + 1.0, 4)
                if event_absolute is not None
                else round(
                    max(
                        0.0,
                        min(
                            float(point.get("t1") or 0)
                            - float(point.get("t0") or 0),
                            1.5,
                        ),
                    ),
                    4,
                )
            )
            source_event_id = stable_uuid(
                BATCH_SLUG,
                match_index,
                point_idx,
                shot_seq,
                phase,
            )
            candidates.append(
                {
                    "event_id": source_event_id,
                    "match_index": match_index,
                    "match_id": match_id,
                    "point_id": str(point.get("id") or ""),
                    "point_idx": point_idx,
                    "clip": (
                        f"{prepared['root']}/clips/point-{point_idx:03d}.mp4"
                    ),
                    "phase": phase,
                    "shot_seq": shot_seq,
                    "event_time_s": event_relative,
                    "event_absolute_s": event_absolute,
                    "server_side": server_side,
                    "scored_server_name": scored_server,
                    "scored_server": eligible,
                    "server_source": context.get("server_source"),
                    "hitter_side": hitter_side,
                    "receiver_side": _other_side(hitter_side),
                    "user_side": user_side,
                    "comparison_class": event["comparison_class"],
                    "legacy_current": event.get("legacy_current"),
                    "canonical_current": event.get("canonical_current"),
                    "openai": event.get("openai"),
                }
            )
    selected = select_pilot_events(candidates)
    manifest = {
        "version": 1,
        "batch_slug": BATCH_SLUG,
        "cases_sha256": canonical_hash(dict(cases_payload)),
        "comparison_sha256": canonical_hash(dict(comparison_payload)),
        "matches": [
            {
                "match_index": index,
                "match_id": str(case["match_id"]),
                "root": str(case["root"]),
                "truth": case.get("truth") or {},
            }
            for index, case in enumerate(
                cases_payload.get("cases") or [],
                start=1,
            )
        ],
        "selected": selected,
        "assignments": build_assignment_order(selected),
    }
    manifest["manifest_sha256"] = canonical_hash(manifest)
    return manifest


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _probe_duration(path: Path) -> float:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return round(float(completed.stdout.strip()), 4)


def _admin_user(production: Production) -> dict:
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


def apply_migration(production: Production) -> None:
    sql = (
        ROOT / "supabase/migrations/055_placement_calibration_research.sql"
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


def seed(
    production: Production,
    manifest: Mapping[str, Any],
    experiment_root: Path,
) -> dict[str, Any]:
    """Idempotently seed only research tables and the placement media prefix."""
    if manifest.get("batch_slug") != BATCH_SLUG:
        raise ValueError("manifest belongs to a different research batch")
    if len(manifest.get("selected") or []) != PRIMARY_EVENT_COUNT:
        raise ValueError("sealed manifest must contain 42 selected events")
    experiment_root = experiment_root.resolve()
    match_ids = [str(item["match_id"]) for item in manifest["matches"]]
    matches = production.rest_get(
        "matches",
        select=(
            "id,opponent_name,venue,user_side,player_near_name,"
            "player_far_name"
        ),
        id=f"in.({','.join(match_ids)})",
    )
    match_by_id = {str(item["id"]): item for item in matches}
    if set(match_ids) != set(match_by_id):
        raise RuntimeError("one or more sealed matches are no longer available")
    point_ids = [str(item["point_id"]) for item in manifest["selected"]]
    points = production.rest_get(
        "points",
        select="id,clip_path",
        id=f"in.({','.join(point_ids)})",
    )
    clip_uri_by_point = {
        str(item["id"]): str(item.get("clip_path") or "")
        for item in points
    }
    if set(point_ids) != set(clip_uri_by_point):
        raise RuntimeError("one or more sealed point clips are unavailable")

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
    source_id_by_event = {}
    for event in manifest["selected"]:
        point_id = str(event["point_id"])
        source_id = stable_uuid(BATCH_SLUG, "source", event["event_id"])
        source_id_by_event[str(event["event_id"])] = source_id
        clip = (experiment_root / str(event["clip"])).resolve()
        if not clip.is_relative_to(experiment_root):
            raise RuntimeError(f"sealed clip escapes root: {event['event_id']}")
        if not clip.is_file():
            source_uri = clip_uri_by_point[point_id]
            bucket, key = parse_r2_uri(source_uri)
            clip = (
                experiment_root
                / "selected-clips"
                / f"{source_id}.mp4"
            )
            clip.parent.mkdir(parents=True, exist_ok=True)
            production.r2.download_file(bucket, key, str(clip))
        if not clip.is_file() or clip.stat().st_size == 0:
            raise RuntimeError(f"sealed clip is unavailable: {event['event_id']}")
        media_hash = _sha256_file(clip)
        destination_key = f"{DESTINATION_PREFIX}/{source_id}.mp4"
        match = match_by_id[str(event["match_id"])]
        opponent = match.get("opponent_name") or "Opponent"
        user_side = str(event["user_side"])
        near_name = "Adil" if user_side == "near" else opponent
        far_name = "Adil" if user_side == "far" else opponent
        scored_server = str(event["scored_server_name"])
        phase = str(event["phase"])
        event_description = (
            "Serve second bounce"
            if phase == "serve"
            else "Return table bounce"
            if phase == "return"
            else f"Shot {event['shot_seq']} table bounce"
        )
        proposal = {
            "schema_version": 1,
            "event_id": str(event["event_id"]),
            "event_time_s": float(event["event_time_s"]),
            "event_description": event_description,
            "phase": phase,
            "shot_seq": int(event["shot_seq"]),
            "scored_server": scored_server,
            "hitter_side": str(event["hitter_side"]),
            "receiver_side": str(event["receiver_side"]),
            "user_side": user_side,
            "predictions": {
                "legacy_current": _prediction_for_proposal(
                    event.get("legacy_current")
                ),
                "canonical_current": _prediction_for_proposal(
                    event.get("canonical_current")
                ),
                "openai": _prediction_for_proposal(event.get("openai")),
            },
        }
        source_manifest_hash = canonical_hash(
            {
                "event": event,
                "proposal": proposal,
                "media_sha256": media_hash,
            }
        )
        if point_id in existing_by_point:
            old = existing_by_point[point_id]
            if (
                old["media_sha256"] != media_hash
                or old["manifest_sha256"] != source_manifest_hash
            ):
                raise RuntimeError(
                    f"frozen source changed for point {event['point_idx']}"
                )
            continue
        production.r2.upload_file(
            str(clip),
            MEDIA_BUCKET,
            destination_key,
            ExtraArgs={"ContentType": "video/mp4"},
        )
        source_rows.append(
            {
                "id": source_id,
                "batch_id": batch_id,
                "source_match_id": str(event["match_id"]),
                "source_point_id": point_id,
                "source_point_idx": int(event["point_idx"]),
                "match_label": f"Adil–{opponent}",
                "player_near_name": near_name,
                "player_far_name": far_name,
                "venue_label": match.get("venue"),
                "media_key": destination_key,
                "media_sha256": media_hash,
                "manifest_sha256": source_manifest_hash,
                "duration_s": _probe_duration(clip),
                "proposal": proposal,
                "prefill": {
                    "comparison_class": event["comparison_class"],
                    "server_source": event.get("server_source"),
                    "match_index": int(event["match_index"]),
                },
            }
        )
    if source_rows:
        production.upsert(
            "research_sources",
            source_rows,
            "batch_id,source_point_id",
        )

    sources = production.rest_get(
        "research_sources",
        select="id,source_point_id,proposal",
        batch_id=f"eq.{batch_id}",
    )
    for source in sources:
        event_id = str((source.get("proposal") or {}).get("event_id") or "")
        if event_id:
            source_id_by_event[event_id] = str(source["id"])
    if len(source_id_by_event) != PRIMARY_EVENT_COUNT:
        raise RuntimeError("research source count does not match sealed manifest")

    current_assignments = production.rest_get(
        "research_assignments",
        select="id",
        batch_id=f"eq.{batch_id}",
        reviewer_id=f"eq.{reviewer_id}",
    )
    if not current_assignments:
        rows = []
        for job in manifest["assignments"]:
            source_id = source_id_by_event[str(job["source_event_id"])]
            rows.append(
                {
                    "id": stable_uuid(
                        BATCH_SLUG,
                        reviewer_id,
                        job["sequence"],
                        source_id,
                        job["is_repeat"],
                    ),
                    "batch_id": batch_id,
                    "source_id": source_id,
                    "reviewer_id": reviewer_id,
                    "sequence": int(job["sequence"]),
                    "duplicate_group": job.get("duplicate_group"),
                    "is_repeat": bool(job["is_repeat"]),
                }
            )
        production.upsert(
            "research_assignments",
            rows,
            "batch_id,reviewer_id,sequence",
        )
    elif len(current_assignments) != PRIMARY_EVENT_COUNT + REPEAT_COUNT:
        raise RuntimeError("existing assignment count is not 48")

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
    return {
        "batch_id": batch_id,
        "unique_sources": PRIMARY_EVENT_COUNT,
        "assignments": PRIMARY_EVENT_COUNT + REPEAT_COUNT,
        "hidden_repeats": REPEAT_COUNT,
        "matches": MATCH_COUNT,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build-manifest")
    build.add_argument("--cases", type=Path, required=True)
    build.add_argument("--comparison", type=Path, required=True)
    build.add_argument("--output", type=Path, required=True)
    migrate = subparsers.add_parser("apply-migration")
    seed_parser = subparsers.add_parser("seed")
    seed_parser.add_argument("--manifest", type=Path, required=True)
    seed_parser.add_argument("--experiment-root", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "build-manifest":
        manifest = build_manifest(
            json.loads(args.cases.read_text()),
            json.loads(args.comparison.read_text()),
        )
        args.output.write_text(json.dumps(manifest, indent=2) + "\n")
        print(
            f"selected {len(manifest['selected'])} events and "
            f"{len(manifest['assignments'])} assignments"
        )
        return 0
    production = Production()
    if args.command == "apply-migration":
        apply_migration(production)
        print("applied placement research migration 055")
        return 0
    if args.command == "seed":
        result = seed(
            production,
            json.loads(args.manifest.read_text()),
            args.experiment_root,
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
