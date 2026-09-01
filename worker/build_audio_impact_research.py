#!/usr/bin/env python3
"""Build, audit, and seed the recent cross-venue audio-impact corpus.

The default command is read-only and prints the deterministic 90-point
manifest. Database and R2 writes require the explicit ``--seed`` flag.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import tempfile
from typing import Any, Mapping, Sequence

import psycopg2
import requests
from botocore.exceptions import ClientError

if __package__:
    from .build_research_pilot import (
        MEDIA_BUCKET,
        Production,
        analyze_audio,
        parse_r2_uri,
        probe_video,
        stable_uuid,
    )
else:
    from build_research_pilot import (
        MEDIA_BUCKET,
        Production,
        analyze_audio,
        parse_r2_uri,
        probe_video,
        stable_uuid,
    )


ROOT = Path(__file__).resolve().parents[1]
BATCH_SLUG = "audio-impact-labeling-recent-v1"
BATCH_TITLE = "Recent cross-venue audio impact labeling"
DESTINATION_PREFIX = "research/audio-impacts/v1/sources"
VENUE_CATEGORIES = ("pingpod", "westchester", "lyttc")
ROUNDS = ("A", "B", "C")
POINTS_PER_RECORDING = 10
TOTAL_RECORDINGS = 9
TOTAL_POINTS = 90


def _admin_user(production: Any) -> dict[str, Any]:
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
            if (item.get("email") or "").lower() == "adilharis2001@gmail.com"
        ),
        None,
    )
    if not user:
        raise RuntimeError("admin account adilharis2001@gmail.com not found")
    return user


def canonical_hash(payload: Mapping[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def stable_score(*parts: object) -> str:
    return hashlib.sha256(":".join(map(str, parts)).encode()).hexdigest()


def venue_category(value: Any) -> str | None:
    normalized = re.sub(r"[^a-z0-9]+", "", str(value or "").lower())
    if "pingpod" in normalized or "pinkpod" in normalized:
        return "pingpod"
    if "westchester" in normalized:
        return "westchester"
    if "lyttc" in normalized:
        return "lyttc"
    return None


def recording_raw_identity(
    match: Mapping[str, Any],
    job: Mapping[str, Any] | None,
) -> str:
    return str(match.get("raw_path") or (job or {}).get("input_path") or "")


def recent_venue_matches(
    matches: Sequence[Mapping[str, Any]],
    *,
    per_venue: int = 12,
) -> list[dict[str, Any]]:
    output = []
    for category in VENUE_CATEGORIES:
        venue_rows = [
            deepcopy(dict(item))
            for item in matches
            if venue_category(item.get("venue")) == category
        ]
        venue_rows.sort(
            key=lambda item: (
                str(item.get("played_at") or ""),
                stable_score(BATCH_SLUG, item.get("id")),
            ),
            reverse=True,
        )
        output.extend(venue_rows[:per_venue])
    return output


def _is_cropped(recording: Mapping[str, Any]) -> bool:
    text = " ".join(
        str(recording.get(key) or "")
        for key in ("opponent_name", "original_name", "match_label")
    ).lower()
    return "cropped" in text or "recut" in text


def _usable_points(recording: Mapping[str, Any]) -> list[dict[str, Any]]:
    points = []
    for raw in recording.get("points") or []:
        if (
            not raw.get("id")
            or not raw.get("clip_path")
            or raw.get("source_time_s") is None
        ):
            continue
        points.append(deepcopy(dict(raw)))
    return points


def choose_recordings(
    recordings: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for raw in recordings:
        item = deepcopy(dict(raw))
        category = str(item.get("venue_category") or venue_category(item.get("venue")) or "")
        points = _usable_points(item)
        if (
            category not in VENUE_CATEGORIES
            or item.get("status") != "ready"
            or not item.get("raw_identity")
            or len(str(item.get("source_sha256") or "")) != 64
            or len(points) < POINTS_PER_RECORDING
            or _is_cropped(item)
        ):
            continue
        item["venue_category"] = category
        item["points"] = points
        candidates[category].append(item)

    selected = []
    seen_hashes: set[str] = set()
    seen_raw: set[str] = set()
    for category in VENUE_CATEGORIES:
        ordered = sorted(
            candidates.get(category, []),
            key=lambda item: (
                str(item.get("played_at") or ""),
                stable_score(BATCH_SLUG, item.get("id")),
            ),
            reverse=True,
        )
        venue_selected = []
        for item in ordered:
            source_hash = str(item["source_sha256"])
            raw_identity = str(item["raw_identity"])
            if source_hash in seen_hashes or raw_identity in seen_raw:
                continue
            venue_selected.append(item)
            seen_hashes.add(source_hash)
            seen_raw.add(raw_identity)
            if len(venue_selected) == 3:
                break
        if len(venue_selected) != 3:
            raise ValueError(
                f"{category} requires exactly three eligible distinct recordings; "
                f"found {len(venue_selected)}"
            )
        for round_name, item in zip(ROUNDS, venue_selected, strict=True):
            item["round"] = round_name
            selected.append(item)

    if len(selected) != TOTAL_RECORDINGS:
        raise ValueError(f"expected {TOTAL_RECORDINGS} recordings, got {len(selected)}")
    return selected


def select_round_points(
    points: Sequence[Mapping[str, Any]],
    *,
    round_name: str,
    seed: str,
) -> list[dict[str, Any]]:
    if round_name not in ROUNDS:
        raise ValueError(f"unknown research round {round_name}")
    ordered = sorted(
        (deepcopy(dict(item)) for item in points),
        key=lambda item: (
            float(item["source_time_s"]),
            int(item.get("idx") or 0),
            str(item["id"]),
        ),
    )
    if len(ordered) < POINTS_PER_RECORDING:
        raise ValueError("recording has fewer than ten usable points")

    if round_name == "B":
        selected = sorted(
            ordered,
            key=lambda item: (
                -float(item.get("acquisition_score") or 0.0),
                stable_score(seed, "round-b", item["id"]),
            ),
        )[:POINTS_PER_RECORDING]
    else:
        selected = []
        for index in range(POINTS_PER_RECORDING):
            start = index * len(ordered) // POINTS_PER_RECORDING
            end = (index + 1) * len(ordered) // POINTS_PER_RECORDING
            bucket = ordered[start:end]
            selected.append(
                min(
                    bucket,
                    key=lambda item: stable_score(
                        seed,
                        round_name,
                        index,
                        item["id"],
                    ),
                )
            )
    return sorted(
        selected,
        key=lambda item: (float(item["source_time_s"]), str(item["id"])),
    )


def build_cohort_manifest(
    recordings: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    chosen = choose_recordings(recordings)
    manifest_recordings = []
    selected_points = []
    for recording in chosen:
        round_name = str(recording["round"])
        chosen_points = select_round_points(
            recording["points"],
            round_name=round_name,
            seed=f"{BATCH_SLUG}:{recording['id']}",
        )
        recording_manifest = {
            "recording_id": str(recording["id"]),
            "match_label": str(
                recording.get("match_label")
                or f"Adil–{recording.get('opponent_name') or 'Opponent'}"
            ),
            "opponent_name": str(recording.get("opponent_name") or "Opponent"),
            "venue": str(recording.get("venue") or ""),
            "venue_category": str(recording["venue_category"]),
            "played_at": str(recording.get("played_at") or ""),
            "round": round_name,
            "raw_identity": str(recording["raw_identity"]),
            "source_sha256": str(recording["source_sha256"]),
        }
        manifest_recordings.append(recording_manifest)
        for point in chosen_points:
            selected_points.append(
                {
                    "point_id": str(point["id"]),
                    "point_idx": int(point.get("idx") or 0),
                    "clip_path": str(point["clip_path"]),
                    "source_time_s": round(float(point["source_time_s"]), 4),
                    "recording_id": recording_manifest["recording_id"],
                    "match_label": recording_manifest["match_label"],
                    "opponent_name": recording_manifest["opponent_name"],
                    "venue": recording_manifest["venue"],
                    "venue_category": recording_manifest["venue_category"],
                    "round": round_name,
                    "split": (
                        "sealed_evaluation"
                        if round_name == "C"
                        else "development"
                    ),
                    "source_sha256": recording_manifest["source_sha256"],
                    "raw_identity": recording_manifest["raw_identity"],
                    "acquisition_score": round(
                        float(point.get("acquisition_score") or 0.0), 6
                    ),
                    "acquisition_model_sha256": point.get(
                        "acquisition_model_sha256"
                    ),
                }
            )

    payload = {
        "schema_version": 1,
        "batch_slug": BATCH_SLUG,
        "detector_version": "dual_band_impact_v1",
        "recordings": manifest_recordings,
        "selected": selected_points,
    }
    payload["manifest_sha256"] = canonical_hash(payload)
    return verified_manifest(payload)


def verified_manifest(payload: Mapping[str, Any]) -> dict[str, Any]:
    manifest = deepcopy(dict(payload))
    supplied_hash = str(manifest.pop("manifest_sha256", ""))
    if supplied_hash != canonical_hash(manifest):
        raise ValueError("manifest hash does not match its contents")
    if manifest.get("batch_slug") != BATCH_SLUG:
        raise ValueError("manifest batch slug is not the audio-impact batch")
    recordings = list(manifest.get("recordings") or [])
    selected = list(manifest.get("selected") or [])
    if len(recordings) != TOTAL_RECORDINGS or len(selected) != TOTAL_POINTS:
        raise ValueError("manifest must contain exactly nine recordings and 90 points")
    if len({str(item.get("source_sha256")) for item in recordings}) != 9:
        raise ValueError("manifest contains duplicate source recordings")
    if len({str(item.get("raw_identity")) for item in recordings}) != 9:
        raise ValueError("manifest contains duplicate raw identities")
    if len({str(item.get("point_id")) for item in selected}) != TOTAL_POINTS:
        raise ValueError("manifest contains duplicate point IDs")
    if Counter(str(item.get("venue_category")) for item in recordings) != Counter(
        {venue: 3 for venue in VENUE_CATEGORIES}
    ):
        raise ValueError("manifest recording venue counts are invalid")
    if Counter(str(item.get("round")) for item in selected) != Counter(
        {round_name: 30 for round_name in ROUNDS}
    ):
        raise ValueError("manifest round counts are invalid")
    if Counter(str(item.get("venue_category")) for item in selected) != Counter(
        {venue: 30 for venue in VENUE_CATEGORIES}
    ):
        raise ValueError("manifest point venue counts are invalid")
    if Counter(str(item.get("recording_id")) for item in selected) != Counter(
        {str(item["recording_id"]): 10 for item in recordings}
    ):
        raise ValueError("each recording must contribute exactly ten points")
    for item in selected:
        if item.get("round") == "C" and item.get("split") != "sealed_evaluation":
            raise ValueError("Round C must remain sealed evaluation")
        if item.get("round") != "C" and item.get("split") != "development":
            raise ValueError("Rounds A and B must remain development data")
    manifest["manifest_sha256"] = supplied_hash
    return manifest


def round_b_acquisition_inputs(manifest: Mapping[str, Any]) -> list[dict[str, Any]]:
    verified = verified_manifest(manifest)
    return [
        deepcopy(dict(item))
        for item in verified["selected"]
        if item.get("round") == "B"
    ]


def validate_existing_seed(
    manifest: Mapping[str, Any],
    existing_sources: Sequence[Mapping[str, Any]],
    existing_assignments: Sequence[Mapping[str, Any]],
) -> str:
    selected_ids = {str(item["point_id"]) for item in manifest.get("selected") or []}
    for assignment in existing_assignments:
        if (
            assignment.get("status") == "submitted"
            and str(assignment.get("source_point_id")) not in selected_ids
        ):
            raise ValueError("refusing to replace a submitted assignment")
    expected_hash = str(manifest.get("manifest_sha256") or "")
    for source in existing_sources:
        stored_hash = str(
            (source.get("prefill") or {}).get("cohort_manifest_sha256") or ""
        )
        if stored_hash != expected_hash:
            raise ValueError("existing source belongs to a different cohort manifest")
    source_ids = {str(item.get("source_point_id")) for item in existing_sources}
    assignment_ids = {
        str(item.get("source_point_id")) for item in existing_assignments
    }
    if source_ids == selected_ids and assignment_ids == selected_ids:
        return "noop"
    return "resume" if source_ids or assignment_ids else "seed"


def _r2_source_fingerprint(production: Production, uri: str) -> str:
    bucket, key = parse_r2_uri(uri)
    head = production.r2.head_object(Bucket=bucket, Key=key)
    metadata = {str(k).lower(): str(v) for k, v in (head.get("Metadata") or {}).items()}
    for name in ("sha256", "source-sha256", "content-sha256"):
        value = metadata.get(name, "")
        if len(value) == 64:
            return value.lower()
    # R2 does not guarantee a SHA-256 metadata field for historical uploads.
    # The immutable object identity, size, and ETag still provide a stable
    # duplicate guard, while the exact copied point bytes are hashed at seed.
    return canonical_hash(
        {
            "bucket": bucket,
            "key": key,
            "etag": str(head.get("ETag") or "").strip('"'),
            "size": int(head.get("ContentLength") or 0),
        }
    )


def available_source_fingerprint(production: Any, uri: str) -> str | None:
    try:
        return _r2_source_fingerprint(production, uri)
    except ClientError as error:
        code = str(error.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise


def rest_get_all(
    production: Any,
    table: str,
    *,
    page_size: int = 1000,
    request_get: Any = None,
    **params: Any,
) -> list[dict[str, Any]]:
    get = request_get or requests.get
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        response = get(
            f"{production.supabase_url}/rest/v1/{table}",
            headers={
                **production.headers,
                "Range": f"{start}-{start + page_size - 1}",
            },
            params=params,
            timeout=60,
        )
        response.raise_for_status()
        page = response.json()
        rows.extend(dict(item) for item in page)
        if len(page) < page_size:
            return rows
        start += page_size


def load_inventory(production: Production) -> tuple[str, list[dict[str, Any]]]:
    reviewer = _admin_user(production)
    reviewer_id = str(reviewer["id"])
    matches = production.rest_get(
        "matches",
        select=(
            "id,user_id,job_id,opponent_name,venue,played_at,status,raw_path,"
            "original_name,player_near_name,player_far_name"
        ),
        user_id=f"eq.{reviewer_id}",
        status="eq.ready",
        order="played_at.desc",
    )
    venue_matches = recent_venue_matches(matches)
    job_ids = [str(item["job_id"]) for item in venue_matches if item.get("job_id")]
    jobs = (
        production.rest_get(
            "jobs",
            select="id,input_path,original_name",
            id=f"in.({','.join(job_ids)})",
        )
        if job_ids
        else []
    )
    jobs_by_id = {str(item["id"]): dict(item) for item in jobs}
    eligible_matches = []
    for match in venue_matches:
        job = jobs_by_id.get(str(match.get("job_id") or ""))
        raw_identity = recording_raw_identity(match, job)
        if not raw_identity:
            continue
        match["resolved_raw_identity"] = raw_identity
        match["original_name"] = match.get("original_name") or (job or {}).get(
            "original_name"
        )
        eligible_matches.append(match)
    match_ids = [str(item["id"]) for item in eligible_matches]
    points = rest_get_all(
        production,
        "points",
        select="id,match_id,idx,t0,clip_path,deleted",
        match_id=f"in.({','.join(match_ids)})",
        deleted="eq.false",
        order="match_id.asc,idx.asc",
    )
    points_by_match: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for raw in points:
        if raw.get("clip_path") and raw.get("t0") is not None:
            item = dict(raw)
            item["source_time_s"] = float(item.pop("t0"))
            item["acquisition_score"] = 0.0
            points_by_match[str(item["match_id"])].append(item)

    inventory = []
    for match in eligible_matches:
        raw_identity = str(match["resolved_raw_identity"])
        source_fingerprint = available_source_fingerprint(
            production,
            raw_identity,
        )
        if source_fingerprint is None:
            continue
        item = dict(match)
        item.update(
            {
                "venue_category": venue_category(match.get("venue")),
                "raw_identity": raw_identity,
                "source_sha256": source_fingerprint,
                "match_label": f"Adil–{match.get('opponent_name') or 'Opponent'}",
                "points": points_by_match.get(str(match["id"]), []),
            }
        )
        inventory.append(item)
    return reviewer_id, inventory


def _apply_migration(production: Production) -> None:
    sql = (ROOT / "supabase/migrations/152_audio_impact_research.sql").read_text()
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


def _media_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def seed_batch(
    production: Production,
    manifest: Mapping[str, Any],
    reviewer_id: str,
) -> dict[str, Any]:
    cohort = verified_manifest(manifest)
    batch_id = stable_uuid("research-batch", BATCH_SLUG)
    batches = production.rest_get(
        "research_batches",
        select="id,status",
        slug=f"eq.{BATCH_SLUG}",
    )
    if batches and str(batches[0]["id"]) != batch_id:
        raise ValueError("existing batch ID does not match the stable audio batch")
    if not batches:
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
    existing_sources = production.rest_get(
        "research_sources",
        select="id,source_point_id,prefill",
        batch_id=f"eq.{batch_id}",
    )
    source_point_by_id = {
        str(item["id"]): str(item["source_point_id"])
        for item in existing_sources
    }
    raw_assignments = production.rest_get(
        "research_assignments",
        select="source_id,status",
        batch_id=f"eq.{batch_id}",
        reviewer_id=f"eq.{reviewer_id}",
    )
    existing_assignments = [
        {
            **dict(item),
            "source_point_id": source_point_by_id.get(str(item["source_id"]), ""),
        }
        for item in raw_assignments
    ]
    state = validate_existing_seed(
        cohort,
        existing_sources,
        existing_assignments,
    )
    if state == "noop":
        return {"status": "noop", "batch_id": batch_id, "sources": 90}

    existing_by_point = {
        str(item["source_point_id"]): dict(item) for item in existing_sources
    }
    source_rows = []
    with tempfile.TemporaryDirectory(prefix="ponglens-audio-impacts-") as directory:
        temp_dir = Path(directory)
        for number, item in enumerate(cohort["selected"], start=1):
            point_id = str(item["point_id"])
            if point_id in existing_by_point:
                continue
            source_id = stable_uuid(BATCH_SLUG, point_id)
            source_bucket, source_key = parse_r2_uri(str(item["clip_path"]))
            local_path = temp_dir / f"{source_id}.mp4"
            production.r2.download_file(source_bucket, source_key, str(local_path))
            video = probe_video(local_path)
            audio = analyze_audio(local_path)
            if int(audio["sample_rate"]) not in {44_100, 48_000}:
                raise ValueError(
                    f"point {point_id} has unsupported {audio['sample_rate']} Hz audio"
                )
            if abs(float(video["duration_s"]) - float(audio["duration_s"])) > 0.05:
                raise ValueError(f"point {point_id} has audio/video duration mismatch")
            proposal = {
                "schema_version": 1,
                "automatic_prediction_withheld": True,
                "video": video,
                "audio": audio,
            }
            media_sha = _media_sha256(local_path)
            proposal_sha = canonical_hash(proposal)
            media_key = f"{DESTINATION_PREFIX}/{source_id}.mp4"
            production.r2.upload_file(
                str(local_path),
                MEDIA_BUCKET,
                media_key,
                ExtraArgs={
                    "ContentType": "video/mp4",
                    "Metadata": {
                        "source-sha256": media_sha,
                        "manifest-sha256": proposal_sha,
                        "source-point-id": point_id,
                        "cohort-sha256": cohort["manifest_sha256"],
                    },
                },
            )
            head = production.r2.head_object(Bucket=MEDIA_BUCKET, Key=media_key)
            if int(head.get("ContentLength") or 0) != local_path.stat().st_size:
                raise RuntimeError(f"frozen upload size mismatch for {point_id}")
            prefill = {
                "venue_category": item["venue_category"],
                "round": item["round"],
                "split": item["split"],
                "source_recording_id": item["recording_id"],
                "source_media_sha256": item["source_sha256"],
                "point_id": point_id,
                "cohort_manifest_sha256": cohort["manifest_sha256"],
                "detector_manifest_sha256": proposal_sha,
                "selection_score": item.get("acquisition_score"),
                "acquisition_model_sha256": item.get("acquisition_model_sha256"),
            }
            source_rows.append(
                {
                    "id": source_id,
                    "batch_id": batch_id,
                    "source_match_id": item["recording_id"],
                    "source_point_id": point_id,
                    "source_point_idx": item["point_idx"],
                    "match_label": item["match_label"],
                    "player_near_name": None,
                    "player_far_name": None,
                    "venue_label": item["venue"],
                    "media_key": media_key,
                    "media_sha256": media_sha,
                    "manifest_sha256": proposal_sha,
                    "duration_s": video["duration_s"],
                    "proposal": proposal,
                    "prefill": prefill,
                }
            )
            print(f"[{number}/{TOTAL_POINTS}] froze {item['match_label']} point {item['point_idx']}")
    if source_rows:
        production.upsert(
            "research_sources",
            source_rows,
            "batch_id,source_point_id",
        )

    sources = production.rest_get(
        "research_sources",
        select="id,source_point_id,prefill",
        batch_id=f"eq.{batch_id}",
    )
    if len(sources) != TOTAL_POINTS:
        raise RuntimeError(f"seed produced {len(sources)} sources, expected 90")
    source_by_point = {str(item["source_point_id"]): item for item in sources}
    existing_assignment_ids = {
        str(item["source_id"])
        for item in production.rest_get(
            "research_assignments",
            select="source_id",
            batch_id=f"eq.{batch_id}",
            reviewer_id=f"eq.{reviewer_id}",
        )
    }
    assignment_rows = []
    for sequence, item in enumerate(cohort["selected"], start=1):
        source_id = str(source_by_point[str(item["point_id"])]["id"])
        if source_id in existing_assignment_ids:
            continue
        assignment_rows.append(
            {
                "id": stable_uuid(BATCH_SLUG, reviewer_id, sequence, source_id),
                "batch_id": batch_id,
                "source_id": source_id,
                "reviewer_id": reviewer_id,
                "sequence": sequence,
            }
        )
    if assignment_rows:
        production.upsert(
            "research_assignments",
            assignment_rows,
            "batch_id,reviewer_id,sequence",
        )
    assignments = production.rest_get(
        "research_assignments",
        select="id",
        batch_id=f"eq.{batch_id}",
        reviewer_id=f"eq.{reviewer_id}",
    )
    if len(assignments) != TOTAL_POINTS:
        raise RuntimeError(
            f"seed produced {len(assignments)} assignments, expected 90"
        )
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
        "status": "active",
        "batch_id": batch_id,
        "sources": len(sources),
        "assignments": len(assignments),
        "manifest_sha256": cohort["manifest_sha256"],
    }


def manifest_summary(manifest: Mapping[str, Any]) -> dict[str, Any]:
    cohort = verified_manifest(manifest)
    return {
        "batch_slug": cohort["batch_slug"],
        "manifest_sha256": cohort["manifest_sha256"],
        "recordings": cohort["recordings"],
        "points_by_round": dict(Counter(item["round"] for item in cohort["selected"])),
        "points_by_venue": dict(
            Counter(item["venue_category"] for item in cohort["selected"])
        ),
        "total_points": len(cohort["selected"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply-migration", action="store_true")
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--manifest-out", type=Path)
    args = parser.parse_args()

    production = Production()
    reviewer_id, inventory = load_inventory(production)
    if args.manifest:
        manifest = verified_manifest(json.loads(args.manifest.read_text()))
    else:
        manifest = build_cohort_manifest(inventory)
    if args.manifest_out:
        args.manifest_out.parent.mkdir(parents=True, exist_ok=True)
        args.manifest_out.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest_summary(manifest), indent=2, sort_keys=True))

    if args.apply_migration:
        _apply_migration(production)
        print("Applied migration 152_audio_impact_research.sql")
    if args.seed:
        print(json.dumps(seed_batch(production, manifest, reviewer_id), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
