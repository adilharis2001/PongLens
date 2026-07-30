#!/usr/bin/env python3
"""Materialize read-only local inputs for the table-calibration experiment."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Callable, Sequence

import cv2

if __package__:
    from ..vision_table_calibration import (
        select_generic_representative_frames,
    )
else:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from vision_table_calibration import (  # type: ignore
        select_generic_representative_frames,
    )


EXPERIMENT_MATCH_IDS = (
    "5721edd0-a80e-4eb8-a605-a6d3c8dbe41f",
    "cb0e7027-c41d-41d3-8984-7e15fddbeb88",
)
SCORING_FIELDS = (
    "idx",
    "id",
    "t0",
    "t1",
    "confirmed_winner",
    "is_let",
    "game_end_override",
    "server_override",
)
PRICE_UNITS = ("input_token", "cached_input_token", "output_token")
DEFAULT_MODEL = "gpt-5.6-sol"


def _json_value(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def choose_control_match(
    conn,
    excluded_ids: Sequence[str],
) -> str:
    """Choose a recent retained match whose structure pass already succeeded."""
    with conn.cursor() as cursor:
        cursor.execute(
            "select m.id::text "
            "from public.matches m "
            "join public.jobs j on j.id = m.job_id "
            "where m.id::text <> all(%s) "
            "and m.status = 'ready' "
            "and m.match_structure->>'status' = 'ready' "
            "and j.input_path is not null "
            "and j.created_at >= now() - interval '7 days' "
            "order by j.created_at desc limit 1",
            (list(excluded_ids),),
        )
        row = cursor.fetchone()
    if not row:
        raise RuntimeError("no recent retained RTMPose-ready control match")
    return str(row[0] if not isinstance(row, dict) else row["id"])


def validate_control_case(cases: list[dict], control_match_id: str) -> None:
    """Require a known-good control with a distinct prepared frame set."""
    control = next(
        (
            case
            for case in cases
            if str(case.get("match_id")) == str(control_match_id)
        ),
        None,
    )
    if control is None:
        raise RuntimeError("prepared control match is missing")
    existing = (control.get("truth") or {}).get("existing_structure") or {}
    if existing.get("status") != "ready":
        raise RuntimeError("control match is not RTMPose-ready")
    signature = tuple(
        str(image.get("sha256") or "")
        for image in control.get("images") or []
    )
    for case in cases:
        if str(case.get("match_id")) == str(control_match_id):
            continue
        other = tuple(
            str(image.get("sha256") or "")
            for image in case.get("images") or []
        )
        if signature and signature == other:
            raise RuntimeError(
                "control frames must be visually distinct from target samples"
            )


def load_pricing_snapshot(conn, model: str) -> dict:
    """Read the complete active OpenAI token-rate snapshot."""
    with conn.cursor() as cursor:
        cursor.execute(
            "select unit, price_per_unit_usd, effective_from, "
            "source_url, source_label "
            "from public.cost_rates "
            "where provider = 'OpenAI' and service = 'AI' and sku = %s "
            "and unit = any(%s) "
            "and effective_from <= now() "
            "and (effective_to is null or effective_to > now()) "
            "order by unit, effective_from desc",
            (model, list(PRICE_UNITS)),
        )
        rows = cursor.fetchall()
    rates = {}
    for row in rows:
        if isinstance(row, dict):
            unit = row["unit"]
            values = (
                row["price_per_unit_usd"],
                row["effective_from"],
                row["source_url"],
                row["source_label"],
            )
        else:
            unit, *values = row
        if unit in rates:
            continue
        price, effective_from, source_url, source_label = values
        rates[str(unit)] = {
            "price": float(price),
            "effective_from": str(_json_value(effective_from)),
            "source_url": str(source_url),
            "source_label": str(source_label),
        }
    missing = set(PRICE_UNITS) - set(rates)
    if missing:
        raise RuntimeError(
            "incomplete OpenAI pricing snapshot: " + ", ".join(sorted(missing))
        )
    return {"model": model, "rates": rates}


def load_match_truth(conn, match_id: str) -> dict:
    """Read only the resolved structure fields needed for comparison."""
    with conn.cursor() as cursor:
        cursor.execute(
            "select first_server, first_server_source, user_side, "
            "match_structure "
            "from public.matches where id = %s",
            (match_id,),
        )
        row = cursor.fetchone()
    if not row:
        raise RuntimeError(f"match truth is unavailable: {match_id}")
    if isinstance(row, dict):
        values = (
            row.get("first_server"),
            row.get("first_server_source"),
            row.get("user_side"),
            row.get("match_structure"),
        )
    else:
        values = row
    first_server, first_server_source, user_side, structure = values
    return {
        "first_server": first_server,
        "first_server_source": first_server_source,
        "user_side": user_side,
        "existing_structure": structure,
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _select_clip_frames(
    clip_paths: Sequence[Path],
    output_dir: Path,
) -> list[Path]:
    """Fallback frame set when the retained full source has expired."""
    if len(clip_paths) < 3:
        raise RuntimeError("clip fallback requires at least three point clips")
    output_dir.mkdir(parents=True, exist_ok=True)
    indices = (0, len(clip_paths) // 2, len(clip_paths) - 1)
    outputs = []
    for output_index, clip_index in enumerate(indices):
        capture = cv2.VideoCapture(str(clip_paths[clip_index]))
        try:
            frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, frames // 2))
            ok, frame = capture.read()
        finally:
            capture.release()
        if not ok or frame is None:
            raise RuntimeError("could not read representative point clip")
        destination = output_dir / f"clip-fallback-{output_index + 1}.jpg"
        if not cv2.imwrite(str(destination), frame):
            raise RuntimeError("could not write clip fallback frame")
        outputs.append(destination)
    return outputs


def _default_runtime():
    try:
        from .. import worker as runtime
    except ImportError:
        import worker as runtime  # type: ignore
    return runtime


def _default_download_object(uri: str, destination: Path) -> None:
    runtime = _default_runtime()
    location = runtime.parse_r2_path(uri)
    if not location:
        raise RuntimeError("experiment point clip must be stored in R2")
    runtime.r2().download_file(location[0], location[1], str(destination))
    if not destination.is_file() or destination.stat().st_size == 0:
        raise RuntimeError(f"downloaded point clip is empty: {destination.name}")


def materialize_case(
    conn,
    match_id: str,
    output_dir: Path,
    *,
    load_record: Callable | None = None,
    download_inputs: Callable | None = None,
    download_object: Callable | None = None,
    blurball_runner: Callable | None = None,
    frame_selector: Callable | None = None,
    truth_loader: Callable | None = None,
    skip_blurball: bool = False,
    allow_clip_frame_fallback: bool = False,
    force_clip_frames: bool = False,
) -> dict:
    """Download one match into a caller-owned directory without any writes."""
    runtime = None
    if load_record is None or download_inputs is None or blurball_runner is None:
        runtime = _default_runtime()
    load_record = load_record or runtime.load_backfill_record
    download_inputs = download_inputs or runtime.download_backfill_inputs
    blurball_runner = blurball_runner or runtime.run_blurball_only
    download_object = download_object or _default_download_object
    frame_selector = frame_selector or select_generic_representative_frames
    truth_loader = truth_loader or load_match_truth

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    record = load_record(conn, match_id)
    truth = truth_loader(conn, match_id)
    source_path = None
    match_path = output_dir / "match.json"
    try:
        if force_clip_frames:
            raise FileNotFoundError("full source intentionally skipped")
        source_path, match_path = download_inputs(record, output_dir)
    except Exception:
        if not (allow_clip_frame_fallback or force_clip_frames):
            raise
        download_object(record["match_json_path"], match_path)
    match = json.loads(Path(match_path).read_text())
    source = match.get("source") or {}
    width = int(source.get("width") or 0)
    height = int(source.get("height") or 0)
    if width <= 0 or height <= 0:
        raise RuntimeError("prepared match JSON has invalid source dimensions")

    clips_dir = output_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    safe_points = []
    point_records = list(record["points"])
    fallback_indices = {
        0,
        len(point_records) // 2,
        len(point_records) - 1,
    }
    for point_position, point in enumerate(point_records):
        idx = int(point["idx"])
        clip_uri = point.get("clip_path")
        if not isinstance(clip_uri, str) or not clip_uri:
            raise RuntimeError(f"point {idx} has no retained clip")
        if source_path is not None or point_position in fallback_indices:
            download_object(clip_uri, clips_dir / f"point-{idx:03d}.mp4")
        safe_points.append(
            {field: _json_value(point.get(field)) for field in SCORING_FIELDS}
        )

    if skip_blurball:
        blurball_path = output_dir / "blurball.skipped.jsonl"
        blurball_path.write_text("")
    else:
        blurball_path = Path(blurball_runner(source_path, output_dir))
    images_dir = output_dir / "images"
    if source_path is None:
        image_paths = _select_clip_frames(
            sorted(clips_dir.glob("point-*.mp4")),
            images_dir,
        )
    else:
        image_paths = [
            Path(path) for path in frame_selector(Path(source_path), images_dir)
        ]
    if len(image_paths) != 3:
        raise RuntimeError("experiment requires exactly three images per case")
    first_image = cv2.imread(str(image_paths[0]))
    if first_image is None:
        raise RuntimeError("prepared background image is unreadable")
    image_height, image_width = first_image.shape[:2]
    images = [
        {
            "path": str(path.relative_to(output_dir)),
            "sha256": _sha256(path),
        }
        for path in image_paths
    ]
    manifest = {
        "match_id": match_id,
        "source_size": [width, height],
        "image_size": [image_width, image_height],
        "source": {
            "path": (
                str(Path(source_path).relative_to(output_dir))
                if source_path is not None
                else None
            ),
            "fps": float(source.get("fps") or 0),
            "frame_source": (
                "retained_source"
                if source_path is not None
                else "retained_point_clips"
            ),
        },
        "match_json": str(Path(match_path).relative_to(output_dir)),
        "blurball": str(blurball_path.relative_to(output_dir)),
        "clips": str(clips_dir.relative_to(output_dir)),
        "images": images,
        "points": safe_points,
        "truth": truth,
    }
    (output_dir / "case.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    return manifest


def prepare_cases(
    output_dir: Path,
    *,
    control_match_id: str | None = None,
    model: str = DEFAULT_MODEL,
) -> dict:
    runtime = _default_runtime()
    conn = runtime.connect()
    root = Path(output_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    try:
        control = control_match_id or choose_control_match(
            conn,
            EXPERIMENT_MATCH_IDS,
        )
        match_ids = [*EXPERIMENT_MATCH_IDS, control]
        pricing = load_pricing_snapshot(conn, model)
        cases = []
        for match_id in match_ids:
            case_root = root / "cases" / match_id
            case = materialize_case(conn, match_id, case_root)
            cases.append(
                {
                    **case,
                    "root": str(case_root.relative_to(root)),
                    "role": (
                        "control" if match_id == control else "failed_sample"
                    ),
                }
            )
        validate_control_case(cases, control)
        payload = {
            "version": 1,
            "model": model,
            "pricing": pricing,
            "control_match_id": control,
            "cases": cases,
        }
        (root / "cases.json").write_text(
            json.dumps(payload, indent=2) + "\n"
        )
        references = {
            "version": 1,
            "cases": [
                {
                    "match_id": case["match_id"],
                    "size": case["image_size"],
                    "image_sha256": [
                        image["sha256"] for image in case["images"]
                    ],
                    "corners": None,
                }
                for case in cases
            ],
        }
        (root / "references.template.json").write_text(
            json.dumps(references, indent=2) + "\n"
        )
        return payload
    finally:
        conn.close()


def prepare_explicit_cases(
    output_dir: Path,
    match_ids: Sequence[str],
    *,
    model: str = DEFAULT_MODEL,
    skip_blurball: bool = False,
    allow_clip_frame_fallback: bool = False,
    force_clip_frames: bool = False,
) -> dict:
    """Prepare a caller-selected, ordered match set without choosing a control."""
    ordered_ids = list(
        dict.fromkeys(str(value) for value in match_ids if str(value))
    )
    if not ordered_ids:
        raise ValueError("at least one explicit match ID is required")

    runtime = _default_runtime()
    conn = runtime.connect()
    root = Path(output_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    try:
        cases = []
        for match_id in ordered_ids:
            case_root = root / "cases" / match_id
            materialize_kwargs = (
                {"skip_blurball": True} if skip_blurball else {}
            )
            if allow_clip_frame_fallback:
                materialize_kwargs["allow_clip_frame_fallback"] = True
            if force_clip_frames:
                materialize_kwargs["force_clip_frames"] = True
            case = materialize_case(
                conn,
                match_id,
                case_root,
                **materialize_kwargs,
            )
            cases.append(
                {
                    **case,
                    "root": str(case_root.relative_to(root)),
                    "role": "paired_target",
                }
            )
        payload = {
            "version": 1,
            "model": model,
            "pricing": load_pricing_snapshot(conn, model),
            "selection": "explicit",
            "cases": cases,
        }
        (root / "cases.json").write_text(
            json.dumps(payload, indent=2) + "\n"
        )
        return payload
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--output-dir", type=Path, required=True)
    prepare.add_argument("--control-match-id")
    prepare.add_argument("--model", default=DEFAULT_MODEL)
    prepare.add_argument("--match-id", action="append", default=[])
    prepare.add_argument("--skip-blurball", action="store_true")
    prepare.add_argument("--allow-clip-frame-fallback", action="store_true")
    prepare.add_argument("--force-clip-frames", action="store_true")
    args = parser.parse_args()
    if args.command == "prepare":
        if args.match_id:
            if args.control_match_id:
                raise SystemExit(
                    "--control-match-id cannot be combined with --match-id"
                )
            payload = prepare_explicit_cases(
                args.output_dir,
                args.match_id,
                model=args.model,
                skip_blurball=args.skip_blurball,
                allow_clip_frame_fallback=args.allow_clip_frame_fallback,
                force_clip_frames=args.force_clip_frames,
            )
        else:
            payload = prepare_cases(
                args.output_dir,
                control_match_id=args.control_match_id,
                model=args.model,
            )
        print(
            f"prepared {len(payload['cases'])} cases; "
            + (
                "ready for unreferenced comparison trials"
                if args.match_id
                else "record references.json before running any API trials"
            )
        )
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
