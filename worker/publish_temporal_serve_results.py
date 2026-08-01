#!/usr/bin/env python3
"""Publish a protected, read-only review of temporal serve results."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import tempfile
from typing import Any, Mapping, Sequence

from worker.build_serve_detection_research import (
    _admin_user,
    _pre_roll_for_match,
    _sha256_file,
    canonical_hash,
    parse_r2_uri,
    probe_video,
    stable_uuid,
)
from worker.build_research_pilot import MEDIA_BUCKET
from worker.service_motion_chains import enumerate_serve_chains


EXPERIMENT = "temporal-serve-scale-v1"
OUTCOMES = ("correct", "wrong", "withheld")
BATCH_SLUG = "serve-detection-temporal-results-v1"
BATCH_TITLE = "Temporal serve detection — held-out results"
DESTINATION_PREFIX = "research/serve-detection/v4/sources"
GOLD_PROVENANCE = (
    "PongLens score rotation; not an independent visual adjudication"
)


def sealed_object_fingerprint(
    bucket: str,
    key: str,
    head: Mapping[str, Any],
) -> str:
    """Match the R2 identity hash sealed by the experiment manifest."""

    identity = {
        "bucket": bucket,
        "key": key,
        "etag": str(head.get("ETag") or "").strip('"'),
        "content_length": int(head.get("ContentLength") or 0),
        "version_id": str(head.get("VersionId") or ""),
    }
    return hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def source_publication_action(
    prior: Mapping[str, Any], expected: Mapping[str, Any]
) -> str:
    """Allow proposal corrections while preserving source identity and media."""

    if (
        str(prior.get("id")) != str(expected.get("id"))
        or str(prior.get("media_sha256"))
        != str(expected.get("media_sha256"))
    ):
        return "reject"
    return (
        "skip"
        if str(prior.get("manifest_sha256"))
        == str(expected.get("manifest_sha256"))
        else "upsert"
    )


def validate_experiment(
    manifest: Mapping[str, Any], results: Mapping[str, Any]
) -> None:
    if manifest.get("experiment") != EXPERIMENT or results.get("experiment") != EXPERIMENT:
        raise ValueError("results or manifest belong to another experiment")
    manifest_hash = str(manifest.get("manifest_sha256") or "")
    if not manifest_hash or manifest_hash != str(results.get("manifest_sha256") or ""):
        raise ValueError("results and manifest hash do not match")


def classify_prediction(row: Mapping[str, Any]) -> str:
    truth = (row.get("evaluation") or {}).get("expected_server_side")
    call = row.get("fused") or {}
    predicted = call.get("side")
    if (
        truth in {"near", "far"}
        and call.get("status") == "high_confidence"
        and predicted in {"near", "far"}
    ):
        return "correct" if predicted == truth else "wrong"
    return "withheld"


def _sealed_holdout_points(manifest: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for match in (manifest.get("splits") or {}).get("holdout") or []:
        for raw in match.get("points") or []:
            point = dict(raw)
            point["_match_label"] = str(
                match.get("match_label") or match.get("match_id") or "Match"
            )
            source_id = str(point.get("source_id") or "")
            if not source_id or source_id in output:
                raise ValueError("sealed holdout contains a missing or duplicate source")
            output[source_id] = point
    return output


def _rank_key(item: Mapping[str, Any]) -> tuple[float, float, str]:
    return (
        -float(item.get("fused_confidence") or 0.0),
        -float(item.get("temporal_margin") or 0.0),
        str(item.get("source_id") or ""),
    )


def _result_item(
    row: Mapping[str, Any], point: Mapping[str, Any]
) -> dict[str, Any]:
    temporal = row.get("temporal") or {}
    fused = row.get("fused") or {}
    near = float(temporal.get("near") or 0.0)
    far = float(temporal.get("far") or 0.0)
    model_input = point.get("model_input") or {}
    chains = enumerate_serve_chains(model_input.get("placement") or {})
    best_chain = chains[0] if chains else {}
    return {
        "source_id": str(row["source_id"]),
        "match_id": str(row.get("match_id") or ""),
        "match_label": str(point.get("_match_label") or row.get("match_id") or "Match"),
        "point_id": str(point.get("source_point_id") or ""),
        "point_idx": int(point.get("source_point_idx") or 0),
        "clip_uri": str(model_input.get("clip_uri") or ""),
        "media_sha256": str(model_input.get("media_sha256") or ""),
        "outcome": classify_prediction(row),
        "expected_side": (row.get("evaluation") or {}).get("expected_server_side"),
        "predicted_side": fused.get("side"),
        "fused_status": str(fused.get("status") or "withheld"),
        "fused_confidence": float(fused.get("confidence") or 0.0),
        "fused_reason": str(fused.get("reason") or "unknown"),
        "temporal_near": near,
        "temporal_far": far,
        "temporal_margin": abs(near - far),
        "model_onset_s": temporal.get("onset_t"),
        "first_bounce_s": (best_chain.get("first_bounce") or {}).get("t"),
        "second_bounce_s": (best_chain.get("second_bounce") or {}).get("t"),
        "chain_rank": best_chain.get("rank"),
        "server_source": (row.get("evaluation") or {}).get("server_source"),
    }


def _take_with_match_cap(
    ranked: Sequence[dict[str, Any]], count: int, per_match_cap: int
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    per_match: Counter[str] = Counter()
    for item in ranked:
        match_id = str(item["match_id"])
        if per_match[match_id] >= per_match_cap:
            continue
        selected.append(item)
        per_match[match_id] += 1
        if len(selected) == count:
            return selected
    for item in ranked:
        if item in selected:
            continue
        selected.append(item)
        if len(selected) == count:
            return selected
    return selected


def build_result_proposal(
    item: Mapping[str, Any],
    video: Mapping[str, Any],
    results: Mapping[str, Any],
) -> dict[str, Any]:
    training = results.get("training") or {}
    has_bounce = any(
        item.get(key) is not None
        for key in ("first_bounce_s", "second_bounce_s")
    )
    if has_bounce and "clip_start_s" not in item:
        raise ValueError("bounce publication requires explicit clip_start_s")
    clip_start_s = float(item.get("clip_start_s") or 0.0)

    def clip_time(value: Any) -> float | None:
        if value is None:
            return None
        return round(float(value) - clip_start_s, 4)

    return {
        "schema_version": 1,
        "video": {
            "duration_s": float(video["duration_s"]),
            "fps": float(video["fps"]),
            "frame_count": int(video["frame_count"]),
        },
        "temporal_result": {
            "experiment": EXPERIMENT,
            "manifest_sha256": str(results.get("manifest_sha256") or ""),
            "checkpoint_sha256": str(training.get("checkpoint_sha256") or ""),
            "checkpoint_file_sha256": str(
                training.get("checkpoint_file_sha256") or ""
            ),
            "outcome": str(item["outcome"]),
            "expected_side": item.get("expected_side"),
            "predicted_side": item.get("predicted_side"),
            "fused": {
                "status": str(item.get("fused_status") or "withheld"),
                "confidence": float(item.get("fused_confidence") or 0.0),
                "reason": str(item.get("fused_reason") or "unknown"),
            },
            "temporal": {
                "near": float(item.get("temporal_near") or 0.0),
                "far": float(item.get("temporal_far") or 0.0),
                "margin": float(item.get("temporal_margin") or 0.0),
                "onset_s": item.get("model_onset_s"),
            },
            "placement": {
                "timebase": "point_clip",
                "first_bounce_s": clip_time(item.get("first_bounce_s")),
                "second_bounce_s": clip_time(item.get("second_bounce_s")),
                "chain_rank": item.get("chain_rank"),
            },
            "truth_provenance": GOLD_PROVENANCE,
        },
    }


def build_seed_rows(
    selected: Sequence[Mapping[str, Any]],
    results: Mapping[str, Any],
    videos: Mapping[str, Mapping[str, Any]],
    reviewer_ids: Sequence[str],
) -> dict[str, Any]:
    if len(selected) != 24 or len({str(item["point_id"]) for item in selected}) != 24:
        raise ValueError("result publication requires 24 unique points")
    if not reviewer_ids:
        raise ValueError("result publication requires at least one reviewer")
    batch_id = stable_uuid("research-batch", BATCH_SLUG)
    sources = []
    gold = []
    source_ids: dict[str, str] = {}
    for item in selected:
        source_id = stable_uuid(BATCH_SLUG, "source", item["point_id"])
        source_ids[str(item["source_id"])] = source_id
        video = videos[str(item["source_id"])]
        clip_start_s = video.get("clip_start_s")
        if clip_start_s is None and video.get("point_t0_s") is not None:
            pre_roll_s = float(video.get("pre_roll_s") or 0.0)
            effective_pre_roll_s = (
                min(pre_roll_s, 0.3)
                if bool(video.get("tight_start"))
                else pre_roll_s
            )
            clip_start_s = max(
                0.0,
                float(video["point_t0_s"]) - effective_pre_roll_s,
            )
        proposal_item = dict(item)
        if clip_start_s is not None:
            proposal_item["clip_start_s"] = float(clip_start_s)
        proposal = build_result_proposal(proposal_item, video, results)
        gold_label = {
            "expected_server_side": item.get("expected_side"),
            "server_source": item.get("server_source") or "rotation",
        }
        source_manifest_sha = canonical_hash(
            {
                "proposal": proposal,
                "gold_label": gold_label,
                "media_sha256": str(video["media_sha256"]),
            }
        )
        sources.append(
            {
                "id": source_id,
                "batch_id": batch_id,
                "source_match_id": str(item["match_id"]),
                "source_point_id": str(item["point_id"]),
                "source_point_idx": int(item["point_idx"]),
                "match_label": str(item.get("match_label") or item["match_id"]),
                "player_near_name": None,
                "player_far_name": None,
                "venue_label": None,
                "media_key": f"{DESTINATION_PREFIX}/{source_id}.mp4",
                "media_sha256": str(video["media_sha256"]),
                "manifest_sha256": source_manifest_sha,
                "duration_s": float(video["duration_s"]),
                "proposal": proposal,
                "prefill": {
                    "read_only": True,
                    "result_order": int(item["order"]),
                    "result_outcome": str(item["outcome"]),
                    "experiment_manifest_sha256": str(
                        results.get("manifest_sha256") or ""
                    ),
                },
            }
        )
        gold.append(
            {
                "source_id": source_id,
                "gold_label": gold_label,
                "provenance": GOLD_PROVENANCE,
            }
        )
    assignments = []
    for reviewer_id in sorted(set(str(value) for value in reviewer_ids)):
        for item in selected:
            source_id = source_ids[str(item["source_id"])]
            assignments.append(
                {
                    "id": stable_uuid(
                        BATCH_SLUG,
                        reviewer_id,
                        int(item["order"]),
                        source_id,
                    ),
                    "batch_id": batch_id,
                    "source_id": source_id,
                    "reviewer_id": reviewer_id,
                    "sequence": int(item["order"]),
                    "duplicate_group": None,
                    "is_repeat": False,
                    "status": "not_started",
                }
            )
    return {
        "batch": {
            "id": batch_id,
            "slug": BATCH_SLUG,
            "title": BATCH_TITLE,
            "schema_version": 1,
            "status": "draft",
        },
        "sources": sources,
        "gold": gold,
        "assignments": assignments,
    }


def validate_audit_snapshot(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    sources = list(snapshot.get("sources") or [])
    if len(sources) != 24:
        raise RuntimeError("temporal result batch must contain exactly 24 sources")
    point_ids = {str(row.get("source_point_id") or "") for row in sources}
    if len(point_ids) != 24 or "" in point_ids:
        raise RuntimeError("temporal result batch must contain 24 unique points")
    outcomes = Counter(str(row.get("outcome") or "") for row in sources)
    expected_outcomes = Counter({outcome: 8 for outcome in OUTCOMES})
    if outcomes != expected_outcomes:
        raise RuntimeError("temporal result batch outcome strata are invalid")
    source_ids = {str(row.get("id") or "") for row in sources}
    gold_ids = {str(value) for value in snapshot.get("gold_source_ids") or []}
    if source_ids != gold_ids:
        raise RuntimeError("temporal result batch gold labels are incomplete")
    assignment_counts = {
        str(key): int(value)
        for key, value in (snapshot.get("assignment_counts") or {}).items()
    }
    if not assignment_counts or any(value != 24 for value in assignment_counts.values()):
        raise RuntimeError("temporal result reviewer queues are incomplete")
    if snapshot.get("batch_status") not in {"draft", "active"}:
        raise RuntimeError("temporal result batch status is invalid")
    for source in sources:
        duration_s = float(source.get("duration_s") or 0.0)
        placement = (
            ((source.get("proposal") or {}).get("temporal_result") or {}).get(
                "placement"
            )
            or {}
        )
        if placement.get("timebase") != "point_clip":
            raise RuntimeError("temporal result bounces must use point-clip timebase")
        for key in ("first_bounce_s", "second_bounce_s"):
            value = placement.get(key)
            if value is not None and not (0.0 <= float(value) <= duration_s):
                raise RuntimeError(
                    f"temporal result {key} falls outside its point clip"
                )
    return {
        "status": str(snapshot["batch_status"]),
        "sources": len(sources),
        "gold_labels": len(gold_ids),
        "outcomes": dict(sorted(outcomes.items())),
        "reviewer_queues": dict(sorted(assignment_counts.items())),
    }


def _result_reviewer_ids(production: Any) -> list[str]:
    batches = production.rest_get(
        "research_batches",
        select="id",
        slug="eq.serve-detection-cross-match-v1",
    )
    if len(batches) != 1:
        raise RuntimeError("original serve research batch is unavailable")
    assignments = production.rest_get(
        "research_assignments",
        select="reviewer_id",
        batch_id=f"eq.{batches[0]['id']}",
    )
    active = production.rest_get(
        "research_reviewers",
        select="user_id",
        active="eq.true",
    )
    active_ids = {str(row["user_id"]) for row in active}
    reviewer_ids = sorted(
        {
            str(row["reviewer_id"])
            for row in assignments
            if str(row["reviewer_id"]) in active_ids
        }
    )
    if not reviewer_ids:
        raise RuntimeError("no active serve research reviewers are available")
    return reviewer_ids


def audit_results(production: Any) -> dict[str, Any]:
    batches = production.rest_get(
        "research_batches",
        select="id,status",
        slug=f"eq.{BATCH_SLUG}",
    )
    if len(batches) != 1:
        raise RuntimeError("temporal result research batch is unavailable")
    batch = batches[0]
    sources = production.rest_get(
        "research_sources",
        select="id,source_point_id,media_key,duration_s,proposal,prefill",
        batch_id=f"eq.{batch['id']}",
    )
    source_ids = [str(row["id"]) for row in sources]
    gold = (
        production.rest_get(
            "research_gold_labels",
            select="source_id",
            source_id=f"in.({','.join(source_ids)})",
        )
        if source_ids
        else []
    )
    assignments = production.rest_get(
        "research_assignments",
        select="reviewer_id",
        batch_id=f"eq.{batch['id']}",
    )
    counts = Counter(str(row["reviewer_id"]) for row in assignments)
    normalized_sources = [
        {
            "id": row["id"],
            "source_point_id": row["source_point_id"],
            "outcome": (row.get("prefill") or {}).get("result_outcome"),
            "duration_s": row.get("duration_s"),
            "proposal": row.get("proposal"),
        }
        for row in sources
    ]
    summary = validate_audit_snapshot(
        {
            "batch_status": batch["status"],
            "sources": normalized_sources,
            "gold_source_ids": [row["source_id"] for row in gold],
            "assignment_counts": counts,
        }
    )
    for source in sources:
        production.r2.head_object(
            Bucket=MEDIA_BUCKET,
            Key=str(source["media_key"]),
        )
    return {"batch_id": str(batch["id"]), **summary}


def seed_results(
    production: Any,
    manifest: Mapping[str, Any],
    results: Mapping[str, Any],
) -> dict[str, Any]:
    selected = select_review_sample(manifest, results)
    point_ids = [str(item["point_id"]) for item in selected]
    points = production.rest_get(
        "points",
        select="id,match_id,t0,tight_start,clip_path",
        id=f"in.({','.join(point_ids)})",
    )
    point_by_id = {str(row["id"]): row for row in points}
    if set(point_ids) != set(point_by_id):
        raise RuntimeError("one or more sealed result points are unavailable")
    match_ids = sorted({str(item["match_id"]) for item in selected})
    matches = production.rest_get(
        "matches",
        select="id,job_id",
        id=f"in.({','.join(match_ids)})",
    )
    match_by_id = {str(row["id"]): dict(row) for row in matches}
    if set(match_ids) != set(match_by_id):
        raise RuntimeError("one or more sealed result matches are unavailable")
    job_ids = sorted(
        {
            str(match["job_id"])
            for match in matches
            if match.get("job_id")
        }
    )
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
        str(row["id"]): dict(row.get("options") or {}) for row in jobs
    }
    reviewer_ids = _result_reviewer_ids(production)
    videos: dict[str, dict[str, Any]] = {}
    local_paths: dict[str, Path] = {}
    with tempfile.TemporaryDirectory(prefix="ponglens-temporal-results-") as directory:
        temp_dir = Path(directory)
        for number, item in enumerate(selected, start=1):
            point_id = str(item["point_id"])
            current_uri = str(point_by_id[point_id].get("clip_path") or "")
            if current_uri != str(item["clip_uri"]):
                raise RuntimeError(f"sealed clip path changed for point {point_id}")
            bucket, key = parse_r2_uri(current_uri)
            object_head = production.r2.head_object(Bucket=bucket, Key=key)
            object_fingerprint = sealed_object_fingerprint(
                bucket, key, object_head
            )
            if object_fingerprint != str(item["media_sha256"]):
                raise RuntimeError(
                    f"sealed object identity changed for point {point_id}"
                )
            local_path = temp_dir / f"{point_id}.mp4"
            production.r2.download_file(bucket, key, str(local_path))
            media_sha = _sha256_file(local_path)
            videos[str(item["source_id"])] = {
                **probe_video(local_path),
                "media_sha256": media_sha,
                "point_t0_s": float(point_by_id[point_id].get("t0") or 0.0),
                "tight_start": bool(point_by_id[point_id].get("tight_start")),
                "pre_roll_s": _pre_roll_for_match(
                    match_by_id[str(item["match_id"])],
                    options_by_job,
                ),
            }
            local_paths[str(item["source_id"])] = local_path
            print(f"[{number}/24] verified {item['match_label']} point {item['point_idx']}")

        rows = build_seed_rows(selected, results, videos, reviewer_ids)
        production.upsert("research_batches", rows["batch"], "slug")
        existing = production.rest_get(
            "research_sources",
            select="id,source_point_id,media_sha256,manifest_sha256",
            batch_id=f"eq.{rows['batch']['id']}",
        )
        existing_by_point = {str(row["source_point_id"]): row for row in existing}
        sources_to_upsert = []
        for item, source in zip(selected, rows["sources"], strict=True):
            prior = existing_by_point.get(str(source["source_point_id"]))
            if prior:
                action = source_publication_action(prior, source)
                if action == "reject":
                    raise RuntimeError(
                        f"published result changed for point {source['source_point_id']}"
                    )
                if action == "upsert":
                    sources_to_upsert.append(source)
                continue
            production.r2.upload_file(
                str(local_paths[str(item["source_id"])]),
                MEDIA_BUCKET,
                str(source["media_key"]),
                ExtraArgs={
                    "ContentType": "video/mp4",
                    "Metadata": {
                        "source-sha256": str(source["media_sha256"]),
                        "manifest-sha256": str(source["manifest_sha256"]),
                    },
                },
            )
            sources_to_upsert.append(source)
        if sources_to_upsert:
            production.upsert(
                "research_sources",
                sources_to_upsert,
                "batch_id,source_point_id",
            )
        admin = _admin_user(production)
        gold_rows = [
            {**row, "adjudicated_by": str(admin["id"])} for row in rows["gold"]
        ]
        production.upsert("research_gold_labels", gold_rows, "source_id")
        production.upsert(
            "research_assignments",
            rows["assignments"],
            "batch_id,reviewer_id,sequence",
        )
        draft_audit = audit_results(production)
        production.upsert(
            "research_batches",
            {**rows["batch"], "status": "active"},
            "slug",
        )
    return {**audit_results(production), "draft_audit": draft_audit}


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    sample = commands.add_parser("build-sample")
    sample.add_argument("--manifest", type=Path, required=True)
    sample.add_argument("--results", type=Path, required=True)
    sample.add_argument("--output", type=Path, required=True)
    seed = commands.add_parser("seed")
    seed.add_argument("--manifest", type=Path, required=True)
    seed.add_argument("--results", type=Path, required=True)
    commands.add_parser("audit")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "build-sample":
        selected = select_review_sample(_load(args.manifest), _load(args.results))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({"selected": selected}, indent=2) + "\n")
        print(json.dumps(Counter(item["outcome"] for item in selected), indent=2))
        return 0
    from worker.build_research_pilot import Production

    production = Production()
    if args.command == "seed":
        result = seed_results(production, _load(args.manifest), _load(args.results))
    else:
        result = audit_results(production)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def select_review_sample(
    manifest: Mapping[str, Any],
    results: Mapping[str, Any],
    *,
    total: int = 24,
    per_stratum: int = 8,
    per_match_cap: int = 3,
) -> list[dict[str, Any]]:
    validate_experiment(manifest, results)
    sealed = _sealed_holdout_points(manifest)
    rows = list((results.get("predictions") or {}).get("holdout") or [])
    if len({str(row.get("source_id") or "") for row in rows}) != len(rows):
        raise ValueError("holdout predictions contain duplicate sources")
    items = []
    for row in rows:
        source_id = str(row.get("source_id") or "")
        point = sealed.get(source_id)
        if point is None:
            raise ValueError(f"prediction {source_id} is missing from sealed holdout")
        items.append(_result_item(row, point))

    by_outcome = {
        outcome: sorted(
            (item for item in items if item["outcome"] == outcome),
            key=_rank_key,
        )
        for outcome in OUTCOMES
    }
    selected: list[dict[str, Any]] = []
    for outcome in OUTCOMES:
        selected.extend(
            _take_with_match_cap(
                by_outcome[outcome], per_stratum, per_match_cap
            )
        )
    if len(selected) < total:
        leftovers = {
            outcome: [item for item in by_outcome[outcome] if item not in selected]
            for outcome in OUTCOMES
        }
        while len(selected) < total and any(leftovers.values()):
            for outcome in OUTCOMES:
                if leftovers[outcome] and len(selected) < total:
                    selected.append(leftovers[outcome].pop(0))
    if len(selected) != total:
        raise ValueError(f"could not assemble {total} unique held-out result items")
    for order, item in enumerate(selected, start=1):
        item["order"] = order
    return selected


__all__ = [
    "EXPERIMENT",
    "BATCH_SLUG",
    "DESTINATION_PREFIX",
    "GOLD_PROVENANCE",
    "OUTCOMES",
    "build_result_proposal",
    "build_seed_rows",
    "audit_results",
    "seed_results",
    "sealed_object_fingerprint",
    "validate_audit_snapshot",
    "classify_prediction",
    "select_review_sample",
    "validate_experiment",
]


if __name__ == "__main__":
    raise SystemExit(main())
