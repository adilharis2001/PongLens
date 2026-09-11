"""Evidence-only recovery for historical automatic highlights.

The normal points pipeline replaces point rows, so it is the wrong tool for a
scored match. This module reconstructs the version-2 receipt from the retained
per-card diagnostic and updates only ``points.highlight_evidence``.
"""

from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import psycopg2.extras

try:
    from .highlights import points_revision, qualifies
    from .points_pipeline import build_highlight_evidence
except ImportError:
    from highlights import points_revision, qualifies
    from points_pipeline import build_highlight_evidence


TABLE_LENGTH_M = 2.74


def highlight_points_are_updating(points: list[dict[str, Any]]) -> bool:
    return any(
        not point.get("deleted") and point.get("edited")
        for point in points
    )


def highlight_evidence_refresh_needed(points: list[dict[str, Any]]) -> bool:
    return any(
        not point.get("deleted")
        and not point.get("edited")
        and not point.get("is_let")
        and point.get("confirmed_winner") in ("user", "opponent")
        and bool(point.get("clip_path"))
        and not (
            isinstance(point.get("highlight_evidence"), dict)
            and point["highlight_evidence"].get("v") == 2
        )
        for point in points
    )


def highlight_revision_is_current(
    expected_revision: str,
    points: list[dict[str, Any]],
    *,
    scored_only: bool = False,
) -> bool:
    return (
        not highlight_points_are_updating(points)
        and points_revision(points, scored_only=scored_only) == expected_revision
    )


def protected_point_snapshot(point: dict[str, Any]) -> dict[str, Any]:
    """Return every point field except the one this backfill may change."""
    return copy.deepcopy({
        key: value for key, value in point.items()
        if key != "highlight_evidence"
    })


def _matching_cards(
    point: dict[str, Any], cards: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    start, end = float(point["t0"]), float(point["t1"])
    candidates = []
    for card in cards:
        try:
            card_start, card_end = float(card["t0"]), float(card["t1"])
        except (KeyError, TypeError, ValueError):
            continue
        overlap = max(0.0, min(end, card_end) - max(start, card_start))
        if overlap > 0:
            candidates.append((card_start, card_end, card))
    return [item[2] for item in sorted(candidates, key=lambda item: item[:2])]


def _source_rally_end(point: dict[str, Any]) -> tuple[float | None, str | None]:
    cut_start = point.get("cut_t0")
    tapped = point.get("scored_at_cut_s")
    has_tap = isinstance(tapped, (int, float, Decimal))
    cut_end = tapped if has_tap else point.get("rally_end_cut_s")
    if not isinstance(cut_start, (int, float, Decimal)) or not isinstance(
        cut_end, (int, float, Decimal)
    ):
        return None, None
    result = float(point["t0"]) + float(cut_end) - float(cut_start)
    if not float(point["t0"]) <= result <= float(point["t1"]):
        return None, None
    return result, "tap" if has_tap else "observed"


def _unique_times(values: list[float], tolerance: float = 0.02) -> list[float]:
    answer: list[float] = []
    for value in sorted(values):
        if not answer or value - answer[-1] > tolerance:
            answer.append(value)
    return answer


def _unavailable(point: dict[str, Any], reason: str) -> dict[str, Any]:
    observed_end, end_source = _source_rally_end(point)
    return {
        "v": 2,
        "status": "unavailable",
        "route": None,
        "n_hits": None,
        "connected_crossings": None,
        "table_bounces": None,
        "alternating_table_landings": None,
        "first_crossing_s": None,
        "last_crossing_s": None,
        "max_crossing_gap_s": None,
        "observed_end_s": observed_end,
        "end_source": end_source,
        "reasons": [reason],
    }


def build_receipts_from_diagnostic(
    points: list[dict[str, Any]], diagnostic: dict[str, Any], *,
    diagnostic_clock: str = "source",
) -> dict[str, dict[str, Any]]:
    """Map a retained ``serves.json`` diagnostic onto stable point IDs."""
    cards = diagnostic.get("cards")
    if not isinstance(cards, list):
        cards = []
    meta = diagnostic.get("meta")
    route = meta.get("route") if isinstance(meta, dict) else None
    receipts: dict[str, dict[str, Any]] = {}
    source_points = points
    if diagnostic_clock == "cut":
        points = []
        for source in source_points:
            cut_start = source.get("cut_t0")
            if not isinstance(cut_start, (int, float, Decimal)):
                points.append(source)
                continue
            shadow = dict(source)
            shadow["t0"] = float(cut_start)
            shadow["t1"] = float(cut_start) + float(source["t1"]) - float(source["t0"])
            points.append(shadow)
    for point, source_point in zip(points, source_points):
        point_id = str(point["id"])
        matching_cards = _matching_cards(point, cards)
        if not matching_cards:
            receipts[point_id] = _unavailable(
                point, "no_matching_diagnostic_card"
            )
            continue

        crossings = _unique_times([
            float(value)
            for card in matching_cards
            for value in card.get("crossings", [])
            if isinstance(value, (int, float))
        ])
        bounce_rows = []
        for card in matching_cards:
            for bounce in card.get("bounces", []):
                if not isinstance(bounce, dict) or not bounce.get("onSurface"):
                    continue
                timestamp = bounce.get("t")
                if isinstance(timestamp, (int, float)):
                    bounce_rows.append((float(timestamp), bounce.get("v")))
        deduped_bounces = []
        for timestamp, position in sorted(bounce_rows, key=lambda row: row[0]):
            if not deduped_bounces or timestamp - deduped_bounces[-1][0] > 0.02:
                deduped_bounces.append((timestamp, position))
        table_bounces = [timestamp for timestamp, _position in deduped_bounces]
        landings = []
        for timestamp, position in deduped_bounces:
            if isinstance(position, (int, float)):
                side = "far" if float(position) < TABLE_LENGTH_M / 2 else "near"
                landings.append((timestamp, side))

        suggestion = point.get("suggestion")
        hits = suggestion.get("n_hits") if isinstance(suggestion, dict) else None
        observed_end, end_source = _source_rally_end(point)
        measured_card = {
            "t0": float(point["t0"]),
            "t1": float(point["t1"]),
            "end_evidence_s": observed_end,
        }
        evidence = SimpleNamespace(
            cross=crossings,
            bt_table=table_bounces,
            bt_table_landings=landings,
        )
        receipt = build_highlight_evidence(
            measured_card, evidence, hits, route
        )
        if end_source is not None:
            receipt["end_source"] = end_source
        if diagnostic_clock == "cut" and point is not source_point:
            offset = float(source_point["t0"]) - float(point["t0"])
            for field in ("first_crossing_s", "last_crossing_s", "observed_end_s"):
                if receipt[field] is not None:
                    receipt[field] = round(float(receipt[field]) + offset, 2)
        receipts[point_id] = receipt
    return receipts


@dataclass(frozen=True)
class HighlightBackfillResult:
    match_id: str
    point_count: int
    ready: int
    unavailable: int
    qualifying: int


def _load_points(conn, match_id: str, *, processing_version_id: str, for_update: bool = False):
    lock = " for update" if for_update else ""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select * from public.points where match_id = %s and processing_version_id = %s "
            f"order by t0, idx{lock}",
            (match_id, processing_version_id),
        )
        return [dict(row) for row in cur.fetchall()]


def _diagnostic_from_video(production_worker, conn, record, video, workdir):
    blurball = production_worker.run_blurball_only(video, workdir)
    outdir = os.path.join(workdir, "points_out")
    dump = os.path.join(workdir, "evidence.json")
    strictness = (record.get("job_options") or {}).get("strictness", "normal")
    command = [
        production_worker.VENV_PY, production_worker.POINTS_PIPELINE, "points",
        "--blurball", str(blurball), "--video", str(video),
        "--outdir", outdir, "--strictness", strictness,
        "--pipeline", "v2", "--endon-fallback", "--no-clips",
        "--evidence-dump", dump,
    ]
    pad, merge = production_worker.serve_motif_settings(conn)
    command += ["--serve-surface-pad", str(pad), "--serve-merge-s", str(merge)]
    subprocess.run(command, check=True, cwd=workdir, timeout=6 * 3600)
    if not os.path.exists(dump):
        return {"cards": [], "meta": {"route": None}}
    with open(dump) as handle:
        blob = json.load(handle)
    blob.setdefault("match_id", str(record["match_id"]))
    try:
        from .research_serve_misses import build
    except ImportError:
        from research_serve_misses import build
    return build(blob, include_all=True)


def _prepare_diagnostic(
    conn, match_id: str, *, processing_version_id: str | None = None
):
    try:
        from . import worker as production_worker
    except ImportError:
        import worker as production_worker

    with conn.cursor() as cur:
        cur.execute(
            "select m.user_id::text, m.cut_path, coalesce(m.raw_path,j.input_path), j.options, "
            "m.active_processing_version_id::text, m.match_json_path "
            "from public.matches m left join public.jobs j on j.id = m.job_id "
            "where m.id = %s and m.status = 'ready'",
            (match_id,),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"highlight backfill match {match_id} is not ready")
    user_id, cut_path, input_path, job_options, version_id, match_json_path = row
    if processing_version_id is not None and version_id != str(processing_version_id):
        raise production_worker.MatchVersionChanged("match processing version changed")
    record = {"match_id": match_id, "job_options": job_options or {}}
    workdir = tempfile.mkdtemp(prefix=f"ponglens-highlight-v2-{match_id[:8]}-")
    try:
        path = os.path.join(workdir, "serves.json")
        # Candidate diagnostics live beside their version's match.json, not
        # in the original unversioned prefix left by the first processing run.
        location = production_worker.parse_r2_path(match_json_path or "")
        bucket = location[0] if location else production_worker.R2_MEDIA_BUCKET
        key = (f"{location[1].rsplit('/', 1)[0]}/serves.json" if location and '/' in location[1]
               else f"points/{user_id}/{match_id}/serves.json")
        clock = "source"
        try:
            production_worker.r2().download_file(
                bucket, key, path
            )
            with open(path) as handle:
                diagnostic = json.load(handle)
        except Exception as diagnostic_error:
            source = os.path.join(workdir, "source.mp4")
            try:
                if not input_path:
                    raise diagnostic_error
                production_worker._download_backfill_object(input_path, source)
                source = production_worker.apply_source_trim(
                    source, workdir, job_options
                )
                diagnostic = _diagnostic_from_video(
                    production_worker, conn, record, source, workdir
                )
            except Exception as source_error:
                if not cut_path:
                    raise source_error
                destination = production_worker.parse_r2_path(cut_path)
                if not destination:
                    raise RuntimeError("highlight cut fallback must be in R2")
                cut = os.path.join(workdir, "cut.mp4")
                production_worker.r2().download_file(*destination, cut)
                diagnostic = _diagnostic_from_video(
                    production_worker, conn, record, cut, workdir
                )
                clock = "cut"

        original = _load_points(conn, match_id, processing_version_id=version_id)
        receipts = build_receipts_from_diagnostic(
            original, diagnostic, diagnostic_clock=clock
        )
        return production_worker, original, receipts, version_id
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _result(match_id: str, points, receipts) -> HighlightBackfillResult:
    ready = sum(value["status"] == "ready" for value in receipts.values())
    qualifying = sum(
        qualifies({**point, "highlight_evidence": receipts[str(point["id"])]})
        for point in points
    )
    return HighlightBackfillResult(
        match_id=match_id,
        point_count=len(points),
        ready=ready,
        unavailable=len(points) - ready,
        qualifying=qualifying,
    )


def analyze_match_from_diagnostic(conn, match_id: str) -> HighlightBackfillResult:
    """Perform every recovery read and calculation without a database write."""
    _worker, points, receipts, _version = _prepare_diagnostic(conn, match_id)
    return _result(match_id, points, receipts)


def _write_match_receipts(
    conn, match_id: str, *, delete_reel: bool,
    processing_version_id: str | None = None,
) -> HighlightBackfillResult:
    production_worker, original, receipts, version_id = _prepare_diagnostic(
        conn, match_id, processing_version_id=processing_version_id
    )
    before = [protected_point_snapshot(point) for point in original]

    old_autocommit = conn.autocommit
    try:
        conn.autocommit = False
        # Lock order agrees with publish/restore: match first, then points.
        with production_worker.locked_match_version(conn, match_id, version_id):
            locked = _load_points(conn, match_id, processing_version_id=version_id, for_update=True)
        if [protected_point_snapshot(point) for point in locked] != before:
            raise production_worker.BackfillConsistencyError(
                f"match {match_id} changed before highlight evidence write"
            )
        with conn.cursor() as cur:
            for point_id, receipt in receipts.items():
                cur.execute(
                    "update public.points set highlight_evidence = %s::jsonb "
                    "where id = %s and match_id = %s and processing_version_id = %s",
                    (json.dumps(receipt), point_id, match_id, version_id),
                )
            if delete_reel:
                # The administrative backfill predates explicit refresh:
                # removing the reel keeps its existing recovery contract.
                cur.execute(
                    "delete from public.match_reels "
                    "where match_id = %s and scope = 'highlights'",
                    (match_id,),
                )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = old_autocommit

    stored = _load_points(conn, match_id, processing_version_id=version_id)
    if [protected_point_snapshot(point) for point in stored] != before:
        raise production_worker.BackfillConsistencyError(
            f"match {match_id} non-highlight point fields changed"
        )
    stored_receipts = {
        str(point["id"]): point.get("highlight_evidence") for point in stored
    }
    if stored_receipts != receipts:
        raise production_worker.BackfillConsistencyError(
            f"match {match_id} highlight evidence verification failed"
        )
    return _result(match_id, original, receipts)


def backfill_match_from_diagnostic(conn, match_id: str) -> HighlightBackfillResult:
    """Download one diagnostic and atomically update only its receipts."""
    return _write_match_receipts(conn, match_id, delete_reel=True)


def refresh_match_evidence_for_render(
    conn, match_id: str, *, processing_version_id: str
) -> HighlightBackfillResult:
    """Refresh edited rally receipts without deleting the queued reel row."""
    return _write_match_receipts(
        conn, match_id, delete_reel=False,
        processing_version_id=processing_version_id,
    )
