#!/usr/bin/env python3
"""Build and seed the hosted winner-constrained point-ending experiment."""

from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from typing import Any, Mapping, Sequence
import uuid

from worker.build_serve_detection_research import (
    _admin_user,
    _pre_roll_for_match,
    parse_r2_uri,
    probe_video,
)
from worker.eval.run_enhanced_terminal_poc import (
    DETECTOR_CONFIG,
    _load_blurball,
    _run_blurball,
)
from worker.winner_constrained_endings import (
    ANALYZER_VERSION,
    analyze_point_ending,
)


ROOT = Path(__file__).resolve().parents[1]
ADMIN_EMAIL = "adilharis2001@gmail.com"
MEDIA_BUCKET = "ponglens-media"
SOURCE_BATCH_SLUG = "serve-detection-cross-match-v1"
BATCH_SLUG = "winner-constrained-endings-cross-match-v1"
BATCH_TITLE = "Winner-constrained point-ending review"
DESTINATION_PREFIX = "research/winner-constrained-endings/v1/sources"
TOTAL_SOURCES = 97
EXPECTED_BY_MATCH = {
    "chris": 20,
    "patrick": 18,
    "gui": 20,
    "vaibhav": 20,
    "faye": 19,
}
DEFAULT_BLURBALL_PYTHON = Path(
    os.environ.get(
        "PONGLENS_BLURBALL_PYTHON",
        "/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python",
    )
)
DEFAULT_BLURBALL_SCRIPT = Path(
    os.environ.get(
        "PONGLENS_BLURBALL_SCRIPT",
        "/Users/adil/Desktop/Projects/TTVid/vendor/blurball_infer.py",
    )
)
DEFAULT_AUDIO_PYTHON = Path(
    os.environ.get(
        "PONGLENS_AUDIO_PYTHON",
        "/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python",
    )
)


def canonical_hash(payload: Mapping[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


def stable_uuid(source_point_id: str, *parts: object) -> str:
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            ":".join(
                [
                    BATCH_SLUG,
                    source_point_id,
                    *(str(part) for part in parts),
                ]
            ),
        )
    )


def _winner(value: Any) -> str | None:
    if isinstance(value, Mapping):
        value = value.get("value")
    return value if value in {"user", "opponent"} else None


def _side_for_player(match: Mapping[str, Any], player: str) -> str:
    user_side = str(match.get("user_side") or "")
    if user_side not in {"near", "far"}:
        raise ValueError("match requires a physical user side")
    if player == "user":
        return user_side
    return "far" if user_side == "near" else "near"


def _player_for_side(match: Mapping[str, Any], side: str) -> str:
    return "user" if _side_for_player(match, "user") == side else "opponent"


def _name_for_side(match: Mapping[str, Any], side: str) -> str:
    raw = match.get(
        "player_near_name" if side == "near" else "player_far_name"
    )
    if raw and str(raw).strip():
        return str(raw).strip()
    player = _player_for_side(match, side)
    if player == "user":
        return "Adil"
    return str(match.get("opponent_name") or "Opponent").strip()


def _participant(
    match: Mapping[str, Any],
    player: str,
) -> dict[str, str]:
    side = _side_for_player(match, player)
    return {
        "player": player,
        "side": side,
        "name": _name_for_side(match, side),
    }


def _serve_boundary(source: Mapping[str, Any]) -> float | None:
    proposal = source.get("proposal") or {}
    detector = proposal.get("detector") or {}
    if detector.get("status") != "high_confidence":
        return None
    actions = [
        action
        for action in proposal.get("likely_actions") or []
        if action.get("suggested_type") == "serve_contact"
        and action.get("time_s") is not None
    ]
    if not actions:
        return None
    return round(min(float(action["time_s"]) for action in actions), 4)


def choose_eligible_sources(
    sources: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Reuse only confirmed, non-let sources and enforce the sealed cohort."""

    eligible = []
    for raw in sources:
        point = raw.get("point") or {}
        match_key = str((raw.get("prefill") or {}).get("match_key") or "")
        if (
            match_key not in EXPECTED_BY_MATCH
            or _winner(point.get("confirmed_winner")) is None
            or bool(point.get("is_let"))
            or not raw.get("source_point_id")
            or not raw.get("media_key")
        ):
            continue
        item = deepcopy(dict(raw))
        item["match_key"] = match_key
        eligible.append(item)
    eligible.sort(
        key=lambda item: stable_uuid(str(item["source_point_id"]), "order")
    )
    counts = Counter(item["match_key"] for item in eligible)
    if len(eligible) != TOTAL_SOURCES or counts != Counter(EXPECTED_BY_MATCH):
        raise ValueError(
            "eligible cohort does not match the sealed 97-point contract: "
            f"total={len(eligible)} by_match={dict(sorted(counts.items()))}"
        )
    point_ids = [str(item["source_point_id"]) for item in eligible]
    if len(point_ids) != len(set(point_ids)):
        raise ValueError("eligible cohort contains duplicate source points")
    return eligible


def align_placement_to_clip(
    placement: Mapping[str, Any],
    *,
    clip_start_s: float,
    duration_s: float,
) -> dict[str, Any]:
    """Translate source-video candidate time to the frozen point clip."""

    aligned = deepcopy(dict(placement))
    candidates = []
    for raw in placement.get("candidates") or []:
        if not isinstance(raw, Mapping) or raw.get("t") is None:
            continue
        relative = round(float(raw["t"]) - float(clip_start_s), 4)
        if relative < 0 or relative > float(duration_s):
            continue
        item = deepcopy(dict(raw))
        item["source_t"] = item["t"]
        item["t"] = relative
        candidates.append(item)
    aligned["candidates"] = sorted(
        candidates,
        key=lambda item: (
            float(item["t"]),
            str(item.get("id") or ""),
        ),
    )
    return aligned


def build_review_proposal(
    source: Mapping[str, Any],
    video: Mapping[str, Any],
) -> dict[str, Any]:
    match = source.get("match") or {}
    point = source.get("point") or {}
    gold = source.get("gold") or {}
    server_player = str(gold.get("scored_server_player") or "")
    winner_player = _winner(point.get("confirmed_winner"))
    if server_player not in {"user", "opponent"} or winner_player is None:
        raise ValueError("review source requires scored server and winner")
    loser_player = "opponent" if winner_player == "user" else "user"
    boundary = _serve_boundary(source)
    return {
        "schema_version": 1,
        "match": {
            "label": str(source.get("match_label") or ""),
            "venue": str(match.get("venue") or "Unknown venue"),
        },
        "scoring": {
            "server": _participant(match, server_player),
            "winner": _participant(match, winner_player),
            "loser": _participant(match, loser_player),
        },
        "detected_serve_boundary": {"available": boundary is not None},
        "automatic_prediction_withheld": True,
        "video": {
            "duration_s": round(float(video["duration_s"]), 4),
            "fps": round(float(video["fps"]), 4),
            "frame_count": int(video["frame_count"]),
        },
    }


def build_gold_label(
    source: Mapping[str, Any],
    without_boundary: Mapping[str, Any],
    with_boundary: Mapping[str, Any] | None,
) -> dict[str, Any]:
    boundary = _serve_boundary(source)
    boundary_variant: dict[str, Any]
    if boundary is None or with_boundary is None:
        boundary_variant = {
            "available": False,
            "reason": "no_high_confidence_serve_boundary",
        }
    else:
        boundary_variant = {
            "available": True,
            "rally_start_s": boundary,
            "result": deepcopy(dict(with_boundary)),
        }
    return {
        "schema_version": 1,
        "source": {
            "serve_research_source_id": str(source["id"]),
            "source_match_id": str(source["source_match_id"]),
            "source_point_id": str(source["source_point_id"]),
            "source_point_idx": int(source["source_point_idx"]),
            "match_key": str(
                source.get("match_key")
                or (source.get("prefill") or {}).get("match_key")
                or ""
            ),
        },
        "known_scoring": {
            "server_player": (source.get("gold") or {}).get(
                "scored_server_player"
            ),
            "server_side": (source.get("gold") or {}).get(
                "scored_server_side"
            ),
            "confirmed_winner": _winner(
                (source.get("point") or {}).get("confirmed_winner")
            ),
        },
        "predictions": {
            "without_serve_boundary": deepcopy(dict(without_boundary)),
            "with_detected_serve_boundary": boundary_variant,
        },
        "versions": {
            "analyzer": ANALYZER_VERSION,
            "blurball": deepcopy(DETECTOR_CONFIG),
            "audio": "hf10k_ema_v1",
            "placement": (source.get("point") or {})
            .get("placement", {})
            .get("v"),
        },
    }


def verified_manifest(payload: Mapping[str, Any]) -> dict[str, Any]:
    manifest = deepcopy(dict(payload))
    supplied = str(manifest.pop("manifest_sha256", ""))
    if supplied != canonical_hash(manifest):
        raise ValueError("manifest hash does not match its contents")
    if manifest.get("batch_slug") != BATCH_SLUG:
        raise ValueError("manifest belongs to another batch")
    selected = manifest.get("selected") or []
    if len(selected) != TOTAL_SOURCES:
        raise ValueError("manifest must contain exactly 97 sources")
    counts = Counter(str(item.get("match_key")) for item in selected)
    if counts != Counter(EXPECTED_BY_MATCH):
        raise ValueError("manifest cohort counts are invalid")
    point_ids = [str(item.get("source_point_id")) for item in selected]
    if len(point_ids) != len(set(point_ids)):
        raise ValueError("manifest contains duplicate source points")
    manifest["manifest_sha256"] = supplied
    return manifest


def _load_source_rows(production: Any) -> list[dict[str, Any]]:
    batches = production.rest_get(
        "research_batches",
        select="id,status",
        slug=f"eq.{SOURCE_BATCH_SLUG}",
    )
    if len(batches) != 1 or batches[0].get("status") != "active":
        raise RuntimeError("active serve-detection source batch is unavailable")
    sources = production.rest_get(
        "research_sources",
        select=(
            "id,source_match_id,source_point_id,source_point_idx,match_label,"
            "media_key,media_sha256,proposal,prefill"
        ),
        batch_id=f"eq.{batches[0]['id']}",
    )
    source_ids = [str(source["id"]) for source in sources]
    gold_rows = production.rest_get(
        "research_gold_labels",
        select="source_id,gold_label",
        source_id=f"in.({','.join(source_ids)})",
    )
    gold_by_source = {
        str(row["source_id"]): dict(row.get("gold_label") or {})
        for row in gold_rows
    }
    point_ids = [str(source["source_point_id"]) for source in sources]
    points = production.rest_get(
        "points",
        select=(
            "id,match_id,idx,t0,t1,placement,confirmed_winner,is_let,"
            "tight_start,deleted"
        ),
        id=f"in.({','.join(point_ids)})",
    )
    point_by_id = {str(point["id"]): dict(point) for point in points}
    match_ids = sorted({str(source["source_match_id"]) for source in sources})
    matches = production.rest_get(
        "matches",
        select=(
            "id,job_id,opponent_name,venue,user_side,player_near_name,"
            "player_far_name,match_json_path"
        ),
        id=f"in.({','.join(match_ids)})",
    )
    match_by_id = {str(match["id"]): dict(match) for match in matches}
    job_ids = [
        str(match["job_id"]) for match in matches if match.get("job_id")
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
    output = []
    for raw in sources:
        item = dict(raw)
        point = point_by_id.get(str(item["source_point_id"]))
        match = match_by_id.get(str(item["source_match_id"]))
        gold = gold_by_source.get(str(item["id"]))
        if point is None or match is None or gold is None:
            raise RuntimeError("serve research source mapping is incomplete")
        pre_roll = _pre_roll_for_match(match, options_by_job)
        point["clip_start_s"] = max(
            0.0,
            float(point.get("t0") or 0.0)
            - (
                min(pre_roll, 0.3)
                if point.get("tight_start")
                else pre_roll
            ),
        )
        item.update({"point": point, "match": match, "gold": gold})
        output.append(item)
    return choose_eligible_sources(output)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_calibration(
    production: Any,
    source: Mapping[str, Any],
    cache_dir: Path,
) -> dict[str, Any]:
    match = source.get("match") or {}
    match_id = str(source["source_match_id"])
    cache_path = cache_dir / f"calibration-{match_id}.json"
    if not cache_path.exists():
        bucket, key = parse_r2_uri(str(match.get("match_json_path") or ""))
        with tempfile.TemporaryDirectory(
            prefix="ponglens-ending-match-"
        ) as directory:
            match_path = Path(directory) / "match.json"
            production.r2.download_file(bucket, key, str(match_path))
            payload = json.loads(match_path.read_text())
        calibration = payload.get("calibration")
        if (
            not isinstance(calibration, Mapping)
            or not calibration.get("ok")
            or not calibration.get("table_corners_px")
        ):
            raise RuntimeError(f"match {match_id} lacks usable calibration")
        cache_path.write_text(json.dumps(calibration, indent=2) + "\n")
    return json.loads(cache_path.read_text())


def _run_audio(
    clip: Path,
    cache_path: Path,
    audio_python: Path,
) -> list[dict[str, Any]]:
    if not cache_path.exists():
        completed = subprocess.run(
            [
                str(audio_python),
                "-m",
                "worker.research_audio_candidates",
                str(clip),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(
                f"audio analysis failed: "
                f"{(completed.stderr or completed.stdout).strip()}"
            )
        cache_path.write_text(completed.stdout)
    payload = json.loads(cache_path.read_text())
    return list(payload.get("candidates") or [])


def _materialize_source(
    production: Any,
    source: Mapping[str, Any],
    *,
    cache_dir: Path,
    blurball_python: Path,
    blurball_script: Path,
    audio_python: Path,
) -> dict[str, Any]:
    source_id = str(source["id"])
    clip = cache_dir / f"{source_id}.mp4"
    if not clip.exists():
        production.r2.download_file(
            MEDIA_BUCKET,
            str(source["media_key"]),
            str(clip),
        )
    media_hash = _sha256_file(clip)
    sealed_hash = str(source.get("media_sha256") or "")
    if sealed_hash and media_hash != sealed_hash:
        raise RuntimeError(f"sealed media hash changed for source {source_id}")
    video = probe_video(clip)
    detections_path = cache_dir / f"{source_id}-blurball.jsonl"
    if not detections_path.exists():
        _run_blurball(
            clip,
            detections_path,
            blurball_python,
            blurball_script,
        )
    audio_path = cache_dir / f"{source_id}-audio.json"
    audio = _run_audio(clip, audio_path, audio_python)
    calibration = _load_calibration(production, source, cache_dir)
    point = deepcopy(dict(source["point"]))
    point["duration_s"] = video["duration_s"]
    point["placement"] = align_placement_to_clip(
        point.get("placement") or {},
        clip_start_s=float(point.get("clip_start_s") or 0.0),
        duration_s=float(video["duration_s"]),
    )
    match = source["match"]
    server_player = str(
        (source.get("gold") or {}).get("scored_server_player") or ""
    )
    server_side = str(
        (source.get("gold") or {}).get("scored_server_side") or ""
    )
    context = {
        "confirmed_winner": _winner(point.get("confirmed_winner")),
        "server": server_player,
        "server_side": server_side,
        "side_to_player": {
            "near": _player_for_side(match, "near"),
            "far": _player_for_side(match, "far"),
        },
        "player_to_side": {
            "user": _side_for_player(match, "user"),
            "opponent": _side_for_player(match, "opponent"),
        },
        "fps": video["fps"],
        "calibration": calibration,
    }
    detections = _load_blurball(detections_path)
    try:
        without = analyze_point_ending(point, detections, audio, context)
    except Exception as error:
        without = {
            "schema_version": 1,
            "analyzer_version": ANALYZER_VERSION,
            "status": "unavailable",
            "ending_family": "unsure",
            "reason": type(error).__name__,
        }
    boundary = _serve_boundary(source)
    with_boundary = None
    if boundary is not None:
        try:
            with_boundary = analyze_point_ending(
                point,
                detections,
                audio,
                {**context, "rally_start_s": boundary},
            )
        except Exception as error:
            with_boundary = {
                "schema_version": 1,
                "analyzer_version": ANALYZER_VERSION,
                "status": "unavailable",
                "ending_family": "unsure",
                "reason": type(error).__name__,
            }
    return {
        "source_research_id": source_id,
        "source_match_id": str(source["source_match_id"]),
        "source_point_id": str(source["source_point_id"]),
        "source_point_idx": int(source["source_point_idx"]),
        "match_key": str(source["match_key"]),
        "match_label": str(source["match_label"]),
        "source_media_key": str(source["media_key"]),
        "media_sha256": media_hash,
        "video": video,
        "proposal": build_review_proposal(source, video),
        "gold": build_gold_label(source, without, with_boundary),
        "display": {
            "player_near_name": match.get("player_near_name"),
            "player_far_name": match.get("player_far_name"),
            "venue_label": match.get("venue"),
        },
    }


def build_manifest(
    production: Any,
    *,
    cache_dir: Path,
    blurball_python: Path = DEFAULT_BLURBALL_PYTHON,
    blurball_script: Path = DEFAULT_BLURBALL_SCRIPT,
    audio_python: Path = DEFAULT_AUDIO_PYTHON,
) -> dict[str, Any]:
    for dependency in (
        blurball_python,
        blurball_script,
        audio_python,
    ):
        if not dependency.exists():
            raise FileNotFoundError(str(dependency))
    cache_dir.mkdir(parents=True, exist_ok=True)
    cohort = _load_source_rows(production)
    selected = []
    for number, source in enumerate(cohort, start=1):
        selected.append(
            _materialize_source(
                production,
                source,
                cache_dir=cache_dir,
                blurball_python=blurball_python,
                blurball_script=blurball_script,
                audio_python=audio_python,
            )
        )
        print(
            f"[{number}/{TOTAL_SOURCES}] analyzed "
            f"{source['match_key']} point {source['source_point_idx']}",
            flush=True,
        )
    manifest = {
        "schema_version": 1,
        "batch_slug": BATCH_SLUG,
        "source_batch_slug": SOURCE_BATCH_SLUG,
        "selected": selected,
        "summary": {
            "total": len(selected),
            "by_match": dict(
                sorted(Counter(item["match_key"] for item in selected).items())
            ),
            "without_boundary_status": dict(
                sorted(
                    Counter(
                        item["gold"]["predictions"][
                            "without_serve_boundary"
                        ].get("status")
                        for item in selected
                    ).items()
                )
            ),
            "with_boundary_available": sum(
                bool(
                    item["gold"]["predictions"][
                        "with_detected_serve_boundary"
                    ]["available"]
                )
                for item in selected
            ),
        },
    }
    manifest["manifest_sha256"] = canonical_hash(manifest)
    return verified_manifest(manifest)


def apply_migration(production: Any) -> None:
    import psycopg2

    sql = (
        ROOT
        / "supabase/migrations/057_winner_constrained_ending_research.sql"
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
    manifest = verified_manifest(payload)
    admin = _admin_user(production)
    reviewer_id = str(admin["id"])
    batch_id = stable_uuid("batch")
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
        str(row["source_point_id"]): row for row in existing
    }
    source_rows = []
    gold_rows = []
    source_id_by_point: dict[str, str] = {}
    with tempfile.TemporaryDirectory(
        prefix="ponglens-ending-seed-"
    ) as directory:
        temp_dir = Path(directory)
        for number, item in enumerate(manifest["selected"], start=1):
            point_id = str(item["source_point_id"])
            source_id = stable_uuid(point_id, "source")
            source_id_by_point[point_id] = source_id
            local_path = temp_dir / f"{source_id}.mp4"
            production.r2.download_file(
                MEDIA_BUCKET,
                str(item["source_media_key"]),
                str(local_path),
            )
            if _sha256_file(local_path) != item["media_sha256"]:
                raise RuntimeError(f"media hash changed for {point_id}")
            destination_key = (
                f"{DESTINATION_PREFIX}/{source_id}.mp4"
            )
            source_manifest_hash = canonical_hash(
                {
                    "proposal": item["proposal"],
                    "gold": item["gold"],
                    "media_sha256": item["media_sha256"],
                }
            )
            prior = existing_by_point.get(point_id)
            if prior:
                if (
                    prior["media_sha256"] != item["media_sha256"]
                    or prior["manifest_sha256"] != source_manifest_hash
                ):
                    raise RuntimeError(f"frozen source changed for {point_id}")
            else:
                production.r2.upload_file(
                    str(local_path),
                    MEDIA_BUCKET,
                    destination_key,
                    ExtraArgs={
                        "ContentType": "video/mp4",
                        "Metadata": {
                            "source-sha256": item["media_sha256"],
                            "manifest-sha256": source_manifest_hash,
                        },
                    },
                )
                display = item.get("display") or {}
                source_rows.append(
                    {
                        "id": source_id,
                        "batch_id": batch_id,
                        "source_match_id": item["source_match_id"],
                        "source_point_id": point_id,
                        "source_point_idx": item["source_point_idx"],
                        "match_label": item["match_label"],
                        "player_near_name": display.get(
                            "player_near_name"
                        ),
                        "player_far_name": display.get("player_far_name"),
                        "venue_label": display.get("venue_label"),
                        "media_key": destination_key,
                        "media_sha256": item["media_sha256"],
                        "manifest_sha256": source_manifest_hash,
                        "duration_s": item["video"]["duration_s"],
                        "proposal": item["proposal"],
                        "prefill": {
                            "match_key": item["match_key"],
                            "automatic_prediction_withheld": True,
                        },
                    }
                )
            gold_rows.append(
                {
                    "source_id": source_id,
                    "gold_label": item["gold"],
                    "provenance": (
                        "Confirmed scoring plus frozen audiovisual "
                        "winner-constrained analysis"
                    ),
                    "adjudicated_by": reviewer_id,
                }
            )
            print(
                f"[{number}/{TOTAL_SOURCES}] froze "
                f"{item['match_key']} point {item['source_point_idx']}",
                flush=True,
            )
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
            str(row["source_point_id"]): str(row["id"])
            for row in sources
        }
    )
    if len(source_id_by_point) != TOTAL_SOURCES:
        raise RuntimeError("research source count is not 97")
    assignments = production.rest_get(
        "research_assignments",
        select="id,sequence",
        batch_id=f"eq.{batch_id}",
        reviewer_id=f"eq.{reviewer_id}",
    )
    if not assignments:
        production.upsert(
            "research_assignments",
            [
                {
                    "id": stable_uuid(
                        str(item["source_point_id"]),
                        reviewer_id,
                        sequence,
                    ),
                    "batch_id": batch_id,
                    "source_id": source_id_by_point[
                        str(item["source_point_id"])
                    ],
                    "reviewer_id": reviewer_id,
                    "sequence": sequence,
                    "duplicate_group": None,
                    "is_repeat": False,
                }
                for sequence, item in enumerate(
                    manifest["selected"],
                    start=1,
                )
            ],
            "batch_id,reviewer_id,sequence",
        )
    elif len(assignments) != TOTAL_SOURCES:
        raise RuntimeError("existing owner assignment count is not 97")
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


def audit(production: Any) -> dict[str, Any]:
    batches = production.rest_get(
        "research_batches",
        select="id,status",
        slug=f"eq.{BATCH_SLUG}",
    )
    if len(batches) != 1:
        raise RuntimeError("winner-constrained research batch is missing")
    batch = batches[0]
    sources = production.rest_get(
        "research_sources",
        select="id,media_key,prefill",
        batch_id=f"eq.{batch['id']}",
    )
    source_ids = [str(row["id"]) for row in sources]
    gold = production.rest_get(
        "research_gold_labels",
        select="source_id",
        source_id=f"in.({','.join(source_ids)})",
    )
    assignments = production.rest_get(
        "research_assignments",
        select="reviewer_id,sequence",
        batch_id=f"eq.{batch['id']}",
    )
    if len(sources) != TOTAL_SOURCES or len(gold) != TOTAL_SOURCES:
        raise RuntimeError("source or gold count is not 97")
    counts = Counter(
        str((source.get("prefill") or {}).get("match_key"))
        for source in sources
    )
    if counts != Counter(EXPECTED_BY_MATCH):
        raise RuntimeError("production cohort counts are invalid")
    queues = Counter(str(row["reviewer_id"]) for row in assignments)
    if TOTAL_SOURCES not in queues.values():
        raise RuntimeError("no reviewer has a complete 97-point queue")
    for source in sources:
        production.r2.head_object(
            Bucket=MEDIA_BUCKET,
            Key=str(source["media_key"]),
        )
    return {
        "batch_id": str(batch["id"]),
        "status": str(batch["status"]),
        "sources": len(sources),
        "gold_labels": len(gold),
        "by_match": dict(sorted(counts.items())),
        "reviewer_queues": dict(sorted(queues.items())),
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build-manifest")
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--cache-dir", type=Path, required=True)
    build.add_argument(
        "--blurball-python",
        type=Path,
        default=DEFAULT_BLURBALL_PYTHON,
    )
    build.add_argument(
        "--blurball-script",
        type=Path,
        default=DEFAULT_BLURBALL_SCRIPT,
    )
    build.add_argument(
        "--audio-python",
        type=Path,
        default=DEFAULT_AUDIO_PYTHON,
    )
    subparsers.add_parser("apply-migration")
    seed_parser = subparsers.add_parser("seed")
    seed_parser.add_argument("--manifest", type=Path, required=True)
    subparsers.add_parser("audit")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    from worker.build_research_pilot import Production

    production = Production()
    if args.command == "build-manifest":
        manifest = build_manifest(
            production,
            cache_dir=args.cache_dir,
            blurball_python=args.blurball_python,
            blurball_script=args.blurball_script,
            audio_python=args.audio_python,
        )
        args.output.write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps(manifest["summary"], indent=2, sort_keys=True))
        return 0
    if args.command == "apply-migration":
        apply_migration(production)
        print("applied winner-constrained research migration 057")
        return 0
    if args.command == "seed":
        result = seed(
            production,
            json.loads(args.manifest.read_text()),
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    if args.command == "audit":
        print(json.dumps(audit(production), indent=2, sort_keys=True))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
