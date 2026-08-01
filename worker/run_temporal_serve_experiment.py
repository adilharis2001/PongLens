#!/usr/bin/env python3
"""Run a blinded, resumable temporal serve-detection experiment."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import tempfile
from typing import Any, Callable, Mapping, Sequence

import numpy as np
import torch

from worker.first_server_decoder import decode_first_server_soft
from worker.service_motion_chains import enumerate_serve_chains
from worker.temporal_serve_features import (
    extract_feature_record,
    load_feature_record,
    save_feature_record,
)
from worker.temporal_serve_fusion import fuse_temporal_evidence
from worker.temporal_serve_manifest import (
    build_manifest,
    validate_manifest,
    write_manifest_atomic,
)
from worker.temporal_serve_model import PairedServeGRU, decode_point_likelihood
from worker.train_temporal_serve import train_model


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _calibration_from_match_payload(
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    calibration = dict(payload.get("calibration") or {})
    if not calibration.get("ok") or not calibration.get("table_corners_px"):
        raise RuntimeError("match lacks table calibration")
    if not calibration.get("size"):
        source = payload.get("source") or {}
        width = float(source.get("width") or 0.0)
        height = float(source.get("height") or 0.0)
        if width <= 0 or height <= 0:
            raise RuntimeError("match calibration lacks source video size")
        calibration["size"] = [width, height]
    return calibration


def _json_safe(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _json_safe(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(child) for child in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    return value


def _atomic_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(_json_safe(value), handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _iter_points(manifest: Mapping[str, Any]):
    for split in ("train", "development", "holdout"):
        for match in manifest["splits"][split]:
            for point in match.get("points") or []:
                yield split, match, point


def _invoke_extractor(
    extractor: Any,
    point: Mapping[str, Any],
    production: Any | None,
) -> Mapping[str, Any]:
    materialized = (
        production.materialize_temporal_point(point)
        if production is not None
        else None
    )
    if hasattr(extractor, "extract"):
        return extractor.extract(point, materialized=materialized)
    try:
        return extractor(point, materialized=materialized)
    except TypeError as error:
        # Small test/research adapters may accept only the blinded point.
        if "materialized" not in str(error):
            raise
        return extractor(point)


def _extract_features(
    manifest: Mapping[str, Any],
    *,
    extractor: Any,
    production: Any | None,
    output_dir: Path,
    progress: bool = False,
) -> dict[str, dict[str, Any]]:
    cache_dir = output_dir / "features"
    index_path = output_dir / "feature-index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {
        "schema_version": 1,
        "manifest_sha256": manifest.get("manifest_sha256"),
        "features": {},
        "failures": {},
    }
    if index.get("manifest_sha256") != manifest.get("manifest_sha256"):
        raise RuntimeError("feature index belongs to another sealed manifest")

    records: dict[str, dict[str, Any]] = {}
    points = list(_iter_points(manifest))
    for ordinal, (_, _, point) in enumerate(points, start=1):
        model_input = dict(point["model_input"])
        source_id = str(model_input["source_id"])
        existing = index["features"].get(source_id)
        if existing:
            metadata_path = cache_dir / str(existing)
            if metadata_path.exists():
                records[source_id] = load_feature_record(metadata_path)
                if progress and (ordinal == len(points) or ordinal % 25 == 0):
                    print(
                        f"[features {ordinal}/{len(points)}] cached {source_id}",
                        flush=True,
                    )
                continue
        try:
            record = dict(
                _invoke_extractor(extractor, model_input, production)
            )
            metadata_path = save_feature_record(cache_dir, record)
            index["features"][source_id] = metadata_path.name
            index["failures"].pop(source_id, None)
            records[source_id] = load_feature_record(metadata_path)
            if progress:
                elapsed = float((record.get("compute") or {}).get("elapsed_s") or 0.0)
                print(
                    f"[features {ordinal}/{len(points)}] extracted {source_id} "
                    f"({elapsed:.2f}s pose)",
                    flush=True,
                )
        except Exception as error:
            index["failures"][source_id] = {
                "type": type(error).__name__,
                "message": str(error),
                "recorded_at": _now(),
            }
            _atomic_json(index_path, index)
            raise
        _atomic_json(index_path, index)
    _atomic_json(index_path, index)
    return records


def _training_dataset(
    manifest: Mapping[str, Any],
    records: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    dataset: dict[str, Any] = {
        "train": [],
        "development": [],
        "holdout": [],
        "metadata": {
            "manifest_sha256": manifest.get("manifest_sha256"),
        },
    }
    first_record = next(iter(records.values()))
    dataset["metadata"].update(
        {
            "extractor_version": first_record.get("extractor_version"),
            "rtmpose_checkpoint_sha256": first_record.get("model_sha256"),
        }
    )
    for split, match, point in _iter_points(manifest):
        source_id = str(point["source_id"])
        record = records[source_id]
        row = {
            "source_id": source_id,
            "match_id": str(match["match_id"]),
            "features": _json_safe(record["features"]),
            "mask": _json_safe(record["mask"]),
        }
        # Holdout identity is retained only for split-leakage validation.  Its
        # target stays outside the trainer until final scoring.
        if split != "holdout":
            row["target_side"] = (
                point.get("evaluation") or {}
            )["expected_server_side"]
        dataset[split].append(row)
    return dataset


class DefaultTrainer:
    def __init__(self, *, seed: int = 731, epochs: int = 40, patience: int = 6):
        self.seed = seed
        self.epochs = epochs
        self.patience = patience

    def fit(self, dataset: Mapping[str, Any], output_dir: Path | None = None):
        if output_dir is not None and (output_dir / "checkpoint.pt").exists():
            payload = torch.load(
                output_dir / "checkpoint.pt",
                map_location="cpu",
                weights_only=True,
            )
            metadata = dataset.get("metadata") or {}
            provenance = json.loads((output_dir / "provenance.json").read_text())
            if provenance.get("manifest_sha256") != metadata.get("manifest_sha256"):
                raise RuntimeError("checkpoint belongs to another sealed manifest")
            model = PairedServeGRU(
                int(payload["feature_width"]),
                symmetric_pairs=bool(payload.get("symmetric_pairs", False)),
            )
            model.load_state_dict(payload["model_state_dict"])
            metrics = json.loads((output_dir / "training.json").read_text())
            return {**metrics, "provenance": provenance, "_model": model}
        return train_model(
            dataset,
            seed=self.seed,
            epochs=self.epochs,
            patience=self.patience,
            output_dir=output_dir,
        )

    def infer(
        self, training: Mapping[str, Any], feature: Mapping[str, Any]
    ) -> dict[str, Any]:
        model = training["_model"]
        model.eval()
        features = torch.as_tensor(feature["features"], dtype=torch.float32).unsqueeze(0)
        mask = torch.as_tensor(feature["mask"], dtype=torch.bool).unsqueeze(0)
        with torch.no_grad():
            output = model(features, mask)
        decoded = decode_point_likelihood(output, feature["times_s"])
        peak = int(decoded["peak_index"])
        return {
            "near": float(decoded["likelihoods"]["near"][peak]),
            "far": float(decoded["likelihoods"]["far"][peak]),
            "onset_t": float(decoded["onset_t"]),
            "predicted_side": decoded["predicted_side"],
            "likelihoods": decoded["likelihoods"],
            "attention": decoded["attention"],
        }


def _fit(trainer: Any, dataset: Mapping[str, Any], output_dir: Path):
    if hasattr(trainer, "fit"):
        try:
            return trainer.fit(dataset, output_dir=output_dir)
        except TypeError as error:
            if "output_dir" not in str(error):
                raise
            return trainer.fit(dataset)
    return trainer(dataset, output_dir=output_dir)


def _infer(trainer: Any, training: Mapping[str, Any], feature: Mapping[str, Any]):
    if hasattr(trainer, "infer"):
        return trainer.infer(training, feature)
    raise TypeError("trainer must expose infer(training, feature)")


def _compute_totals(records: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    compute = [record.get("compute") or {} for record in records.values()]
    return {
        "points": len(records),
        "decoded_frames": sum(int(row.get("decoded_frames") or 0) for row in compute),
        "posed_frames": sum(int(row.get("posed_frames") or 0) for row in compute),
        "inference_s": round(sum(float(row.get("inference_s") or 0.0) for row in compute), 6),
        "elapsed_s": round(sum(float(row.get("elapsed_s") or 0.0) for row in compute), 6),
        "peak_rss_mb": max((float(row.get("peak_rss_mb") or 0.0) for row in compute), default=0.0),
    }


def run_experiment(
    manifest: Mapping[str, Any],
    *,
    extractor: Any,
    trainer: Any,
    output_dir: Path | str,
    production: Any | None = None,
    baseline: Callable[[Mapping[str, Any], Mapping[str, Any]], Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Extract, fit, infer, and persist one sealed research run."""

    validate_manifest(manifest)
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    records = _extract_features(
        manifest,
        extractor=extractor,
        production=production,
        output_dir=destination,
    )
    dataset = _training_dataset(manifest, records)
    training = _fit(trainer, dataset, destination / "training")

    previous_path = destination / "results.json"
    previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
    holdout_opened_at = previous.get("holdout_opened_at") or _now()
    predictions: dict[str, list[dict[str, Any]]] = {
        "train": [],
        "development": [],
        "holdout": [],
    }
    soft_calls: dict[str, list[dict[str, Any]]] = {}
    for split, match, point in _iter_points(manifest):
        source_id = str(point["source_id"])
        feature = records[source_id]
        temporal = dict(_infer(trainer, training, feature))
        model_input = point["model_input"]
        chains = enumerate_serve_chains(model_input.get("placement") or {})
        call = fuse_temporal_evidence(
            temporal,
            chains,
            feature.get("audio_events") or [],
        )
        baseline_call = (
            dict(baseline(model_input, feature)) if baseline is not None else None
        )
        row = {
            "source_id": source_id,
            "match_id": str(match["match_id"]),
            "source_point_idx": int(point.get("source_point_idx") or 0),
            "temporal": temporal,
            "fused": call,
            "baseline": baseline_call,
            "evaluation": dict(point.get("evaluation") or {}),
        }
        predictions[split].append(row)
        soft_calls.setdefault(str(match["match_id"]), []).append(
            {
                "idx": int(point.get("source_point_idx") or 0),
                "near": float(temporal["near"]),
                "far": float(temporal["far"]),
            }
        )

    match_predictions = {
        match_id: decode_first_server_soft(
            sorted(calls, key=lambda call: int(call.get("idx") or 0))[:5]
        )
        for match_id, calls in soft_calls.items()
    }
    match_truth: dict[str, str] = {}
    for split in ("train", "development", "holdout"):
        for match in manifest["splits"][split]:
            ordered_points = sorted(
                match.get("points") or [],
                key=lambda point: int(point.get("source_point_idx") or 0),
            )
            if ordered_points:
                expected = (
                    ordered_points[0].get("evaluation") or {}
                ).get("expected_server_side")
                if expected in {"near", "far"}:
                    match_truth[str(match["match_id"])] = str(expected)
    public_training = {
        key: _json_safe(value)
        for key, value in training.items()
        if not key.startswith("_") and key != "provenance"
    }
    result = {
        "schema_version": 1,
        "experiment": "temporal-serve-scale-v1",
        "manifest_sha256": manifest.get("manifest_sha256"),
        "manifest_status": manifest.get("status"),
        "holdout_canaries": list(manifest.get("holdout_canaries") or []),
        "created_at": previous.get("created_at") or _now(),
        "completed_at": _now(),
        "holdout_opened_at": holdout_opened_at,
        "training": public_training,
        "predictions": predictions,
        "match_predictions": match_predictions,
        "match_truth": match_truth,
        "compute": _compute_totals(records),
        "ablation_names": [
            "temporal_only",
            "temporal_plus_audio",
            "temporal_plus_ball",
            "temporal_plus_ball_audio",
            "frozen_baseline",
        ],
    }
    _atomic_json(previous_path, result)
    return result


class TemporalServeProduction:
    """Read-only production adapter for manifest discovery and clip materialization."""

    def __init__(self, production: Any, cache_dir: Path):
        from worker.run_service_motion_experiment import ResearchProduction

        self.production = production
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.research = ResearchProduction(production, cache_dir)
        self._matches: dict[str, dict[str, Any]] = {}

    def _calibration(self, match_id: str, match_json_path: str) -> dict[str, Any]:
        # The shared adapter validates and materializes the match JSON.  This
        # experiment also preserves the source dimensions because point clips
        # are downscaled and table coordinates must be transformed with them.
        self.research._calibration(match_id, match_json_path)
        payload = json.loads(
            (self.cache_dir / f"match-{match_id}.json").read_text()
        )
        return _calibration_from_match_payload(payload)

    def _match(self, match_id: str) -> dict[str, Any]:
        if match_id in self._matches:
            return self._matches[match_id]
        rows = self.production.rest_get(
            "matches",
            select=(
                "id,job_id,match_json_path,opponent_name,created_at,played_at,"
                "first_server,first_server_source,user_side"
            ),
            id=f"eq.{match_id}",
        )
        if len(rows) != 1:
            raise RuntimeError(f"match unavailable: {match_id}")
        self._matches[match_id] = dict(rows[0])
        return self._matches[match_id]

    def _object_fingerprint(self, uri: str) -> str:
        from worker.build_serve_detection_research import parse_r2_uri

        bucket, key = parse_r2_uri(uri)
        head = self.production.r2.head_object(Bucket=bucket, Key=key)
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

    def list_temporal_serve_matches(self) -> list[dict[str, Any]]:
        rows = self.production.rest_get(
            "matches",
            select=(
                "id,job_id,match_json_path,opponent_name,created_at,played_at,"
                "first_server,first_server_source,user_side"
            ),
            first_server_source="eq.user",
            first_server="not.is.null",
            user_side="not.is.null",
            match_json_path="not.is.null",
            order="created_at.asc,id.asc",
            limit="5000",
        )
        output: list[dict[str, Any]] = []
        for raw_match in rows:
            match = dict(raw_match)
            match_id = str(match["id"])
            self._matches[match_id] = match
            points = self.production.rest_get(
                "points",
                select=(
                    "id,match_id,idx,t0,t1,tight_start,clip_path,placement,"
                    "confirmed_winner,server_override,is_let,"
                    "game_end_override,deleted"
                ),
                match_id=f"eq.{match_id}",
                deleted="eq.false",
                order="idx.asc",
                limit="5000",
            )
            candidates = [
                point
                for point in points
                if point.get("confirmed_winner") in {"user", "opponent"}
                and not bool(point.get("is_let"))
                and point.get("clip_path")
            ]
            if len(candidates) < 5:
                continue
            try:
                calibration = self._calibration(
                    match_id, str(match["match_json_path"])
                )
                fingerprints = {
                    str(point["id"]): self._object_fingerprint(str(point["clip_path"]))
                    for point in candidates
                }
            except Exception:
                continue
            for point in points:
                point["clip_sha256"] = fingerprints.get(str(point["id"]))
            output.append(
                {
                    **match,
                    "label": str(match.get("opponent_name") or match_id),
                    "calibration": calibration,
                    "points": points,
                }
            )
        return output

    def materialize_temporal_point(
        self, point: Mapping[str, Any]
    ) -> dict[str, Any]:
        from worker.build_serve_detection_research import (
            _pre_roll_for_match,
            parse_r2_uri,
        )
        from worker.build_winner_constrained_ending_research import (
            align_placement_to_clip,
        )
        from worker.run_service_motion_experiment import (
            _align_hypothesis_times,
            _scaled_corners,
            _video_metadata,
        )

        source_id = str(point["source_id"])
        match_id = str(point["source_match_id"])
        point_id = str(point["source_point_id"])
        rows = self.production.rest_get(
            "points",
            select="id,t0,t1,tight_start,clip_path,placement",
            id=f"eq.{point_id}",
        )
        if len(rows) != 1:
            raise RuntimeError(f"point unavailable: {point_id}")
        source = dict(rows[0])
        if str(source.get("clip_path") or "") != str(point.get("clip_uri") or ""):
            raise RuntimeError(f"sealed clip path changed for {source_id}")
        bucket, key = parse_r2_uri(str(source["clip_path"]))
        clip = self.cache_dir / "media" / f"{hashlib.sha256(source_id.encode()).hexdigest()}.mp4"
        clip.parent.mkdir(parents=True, exist_ok=True)
        if not clip.exists():
            self.production.r2.download_file(bucket, key, str(clip))
        video = _video_metadata(clip)
        match = self._match(match_id)
        jobs = (
            self.production.rest_get(
                "jobs", select="id,options", id=f"eq.{match['job_id']}"
            )
            if match.get("job_id")
            else []
        )
        pre_roll = _pre_roll_for_match(
            match,
            {str(job["id"]): dict(job.get("options") or {}) for job in jobs},
        )
        clip_start = max(
            0.0,
            float(source.get("t0") or 0.0)
            - (min(pre_roll, 0.3) if source.get("tight_start") else pre_roll),
        )
        placement = _align_hypothesis_times(
            align_placement_to_clip(
                source.get("placement") or {},
                clip_start_s=clip_start,
                duration_s=float(video["duration_s"]),
            )
        )
        calibration = dict(point.get("calibration") or {})
        calibration["table_corners_px"] = _scaled_corners(
            calibration, int(video["width"]), int(video["height"])
        )
        return {
            "media_path": clip,
            "video": video,
            "placement": placement,
            "calibration": calibration,
            "audio_candidates": self.research._audio(source_id, clip),
        }


class PlacementCandidateBallRunner:
    """Reuse the BlurBall-derived event coordinates already sealed in placement."""

    def __call__(
        self, detector_input: Mapping[str, Any]
    ) -> dict[int, tuple[float, float]]:
        detections: dict[int, tuple[float, float]] = {}
        placement = detector_input.get("placement") or {}
        for candidate in placement.get("candidates") or []:
            if not isinstance(candidate, Mapping):
                continue
            frame = candidate.get("frame")
            x = candidate.get("x")
            y = candidate.get("y")
            if frame is None or x is None or y is None:
                continue
            position = (float(x), float(y))
            # The feature sampler is 15 fps while production placement usually
            # records 30 fps frames.  A one-frame spread retains the same event
            # for the nearest sampled frame without inventing a trajectory.
            for nearby in range(max(0, int(frame) - 1), int(frame) + 2):
                detections[nearby] = position
        return detections


class TemporalFeatureExtractor:
    """Production adapter around bounded RTMPose and cached BlurBall detections."""

    def __init__(
        self,
        *,
        pose_model: Any,
        blurball: Any,
        model_sha256: str,
        ball_source: str = "custom_ball_detections",
    ):
        self.pose_model = pose_model
        self.blurball = blurball
        self.model_sha256 = model_sha256
        self.ball_source = ball_source

    def __call__(
        self,
        point: Mapping[str, Any],
        *,
        materialized: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        if materialized is None:
            raise ValueError("production temporal extraction requires materialized media")
        sanitized = {
            **dict(point),
            "placement": dict(materialized.get("placement") or {}),
            "calibration": dict(materialized.get("calibration") or {}),
        }
        blurball_input = {
            **sanitized,
            "media_path": materialized["media_path"],
            "video": materialized.get("video") or {},
        }
        record = extract_feature_record(
            point=sanitized,
            media_path=Path(materialized["media_path"]),
            pose_model=self.pose_model,
            blurball=lambda _: self.blurball(blurball_input),
            audio=materialized.get("audio_candidates") or [],
            model_sha256=self.model_sha256,
        )
        record["extractor_version"] = (
            f"{record['extractor_version']}+{self.ball_source}"
        )
        record["ball_source"] = self.ball_source
        return record


def _load_feature_records(output_dir: Path) -> dict[str, dict[str, Any]]:
    index_path = output_dir / "feature-index.json"
    if not index_path.exists():
        raise RuntimeError("feature stage has not completed")
    index = json.loads(index_path.read_text())
    cache = output_dir / "features"
    return {
        source_id: load_feature_record(cache / metadata)
        for source_id, metadata in (index.get("features") or {}).items()
    }


def _production_components(output_dir: Path, runtime_root: Path):
    from worker.build_research_pilot import Production
    from worker.extract_service_motion_rtmpose import create_pose_model

    production = TemporalServeProduction(Production(), output_dir / "cache")
    config = (
        runtime_root
        / "source/mmpose-1.3.2/configs/body_2d_keypoint/rtmpose/coco/"
        "rtmpose-m_8xb256-420e_coco-256x192.py"
    )
    checkpoint = runtime_root / "model.pth"
    pose_model = create_pose_model(config, checkpoint, device="mps")
    blurball = PlacementCandidateBallRunner()
    extractor = TemporalFeatureExtractor(
        pose_model=pose_model,
        blurball=blurball,
        model_sha256=hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
        ball_source="production_blurball_placement_events_v1",
    )
    return production, extractor


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("manifest", "features", "train", "infer", "all"))
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--target-points", type=int, default=1000)
    parser.add_argument("--minimum-matches", type=int, default=30)
    parser.add_argument("--chris-date", default="2026-07-30")
    parser.add_argument("--canary-timezone", default="America/New_York")
    parser.add_argument("--seed", type=int, default=731)
    parser.add_argument(
        "--runtime-root",
        type=Path,
        default=Path(
            "/Users/adil/Library/Caches/PongLens/service-motion-rtmpose"
        ),
    )
    args = parser.parse_args(argv)
    args.output.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output / "manifest.json"

    if args.stage in {"manifest", "all"} and not manifest_path.exists():
        from worker.build_research_pilot import Production

        production = TemporalServeProduction(
            Production(), args.output / "cache"
        )
        manifest = build_manifest(
            production,
            target_points=args.target_points,
            minimum_matches=args.minimum_matches,
            chris_date=args.chris_date,
            canary_timezone=args.canary_timezone,
        )
        write_manifest_atomic(manifest_path, manifest)
    elif not manifest_path.exists():
        raise SystemExit(f"sealed manifest is missing: {manifest_path}")

    manifest = json.loads(manifest_path.read_text())
    validate_manifest(manifest)
    if args.stage == "manifest":
        print(manifest_path)
        return 0

    trainer = DefaultTrainer(seed=args.seed)
    if args.stage in {"features", "all"}:
        production, extractor = _production_components(
            args.output, args.runtime_root
        )
        if args.stage == "features":
            records = _extract_features(
                manifest,
                extractor=extractor,
                production=production,
                output_dir=args.output,
                progress=True,
            )
            print(f"cached {len(records)} feature records")
            return 0
        result = run_experiment(
            manifest,
            extractor=extractor,
            trainer=trainer,
            output_dir=args.output,
            production=production,
        )
        print(args.output / "results.json")
        return 0

    records = _load_feature_records(args.output)
    if len(records) != int(manifest["counts"]["points"]):
        raise SystemExit(
            "feature stage is incomplete: "
            f"{len(records)}/{manifest['counts']['points']} records"
        )
    if args.stage == "train":
        training = trainer.fit(
            _training_dataset(manifest, records),
            output_dir=args.output / "training",
        )
        print(
            json.dumps(
                {
                    "best_epoch": training["best_epoch"],
                    "development_loss": training["development_loss"],
                    "checkpoint_sha256": training["checkpoint_sha256"],
                },
                sort_keys=True,
            )
        )
        return 0

    def missing_extractor(*_args, **_kwargs):
        raise RuntimeError("feature cache is incomplete")

    run_experiment(
        manifest,
        extractor=missing_extractor,
        trainer=trainer,
        output_dir=args.output,
    )
    print(args.output / "results.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "DefaultTrainer",
    "TemporalFeatureExtractor",
    "TemporalServeProduction",
    "run_experiment",
]
