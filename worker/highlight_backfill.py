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
    from .highlights import qualifies
    from .points_pipeline import build_highlight_evidence
except ImportError:
    from highlights import qualifies
    from points_pipeline import build_highlight_evidence


TABLE_LENGTH_M = 2.74


def protected_point_snapshot(point: dict[str, Any]) -> dict[str, Any]:
    """Return every point field except the one this backfill may change."""
    return copy.deepcopy({
        key: value for key, value in point.items()
        if key != "highlight_evidence"
    })


def _matching_card(point: dict[str, Any], cards: list[dict[str, Any]]):
    start, end = float(point["t0"]), float(point["t1"])
    candidates = []
    for card in cards:
        try:
            card_start, card_end = float(card["t0"]), float(card["t1"])
        except (KeyError, TypeError, ValueError):
            continue
        overlap = max(0.0, min(end, card_end) - max(start, card_start))
        if overlap > 0:
            candidates.append((overlap, -abs(start - card_start), card))
    return max(candidates, key=lambda item: item[:2])[2] if candidates else None


def _source_rally_end(point: dict[str, Any]) -> float | None:
    cut_start = point.get("cut_t0")
    cut_end = point.get("rally_end_cut_s")
    if not isinstance(cut_start, (int, float, Decimal)) or not isinstance(
        cut_end, (int, float, Decimal)
    ):
        return None
    result = float(point["t0"]) + float(cut_end) - float(cut_start)
    return result if float(point["t0"]) <= result <= float(point["t1"]) else None


def _unavailable(point: dict[str, Any], reason: str) -> dict[str, Any]:
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
        "observed_end_s": _source_rally_end(point),
        "end_source": "observed" if _source_rally_end(point) is not None else None,
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
        card = _matching_card(point, cards)
        if card is None:
            receipts[point_id] = _unavailable(
                point, "no_matching_diagnostic_card"
            )
            continue

        crossings = [
            float(value) for value in card.get("crossings", [])
            if isinstance(value, (int, float))
        ]
        table_bounces = []
        landings = []
        for bounce in card.get("bounces", []):
            if not isinstance(bounce, dict) or not bounce.get("onSurface"):
                continue
            timestamp = bounce.get("t")
            position = bounce.get("v")
            if not isinstance(timestamp, (int, float)):
                continue
            table_bounces.append(float(timestamp))
            if isinstance(position, (int, float)):
                side = "far" if float(position) < TABLE_LENGTH_M / 2 else "near"
                landings.append((float(timestamp), side))

        suggestion = point.get("suggestion")
        hits = suggestion.get("n_hits") if isinstance(suggestion, dict) else None
        measured_card = {
            "t0": float(point["t0"]),
            "t1": float(point["t1"]),
            "end_evidence_s": _source_rally_end(point),
        }
        evidence = SimpleNamespace(
            cross=crossings,
            bt_table=table_bounces,
            bt_table_landings=landings,
        )
        receipt = build_highlight_evidence(
            measured_card, evidence, hits, route
        )
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


def _load_points(conn, match_id: str, *, for_update: bool = False):
    lock = " for update" if for_update else ""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select * from public.points where match_id = %s "
            f"order by t0, idx{lock}",
            (match_id,),
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


def _prepare_diagnostic(conn, match_id: str):
    try:
        from . import worker as production_worker
    except ImportError:
        import worker as production_worker

    with conn.cursor() as cur:
        cur.execute(
            "select m.user_id::text, m.cut_path, j.input_path, j.options "
            "from public.matches m left join public.jobs j on j.id = m.job_id "
            "where m.id = %s and m.status = 'ready'",
            (match_id,),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"highlight backfill match {match_id} is not ready")
    user_id, cut_path, input_path, job_options = row
    record = {"match_id": match_id, "job_options": job_options or {}}
    workdir = tempfile.mkdtemp(prefix=f"ponglens-highlight-v2-{match_id[:8]}-")
    try:
        path = os.path.join(workdir, "serves.json")
        key = f"points/{user_id}/{match_id}/serves.json"
        clock = "source"
        try:
            production_worker.r2().download_file(
                production_worker.R2_MEDIA_BUCKET, key, path
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

        original = _load_points(conn, match_id)
        receipts = build_receipts_from_diagnostic(
            original, diagnostic, diagnostic_clock=clock
        )
        return production_worker, original, receipts
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
    _worker, points, receipts = _prepare_diagnostic(conn, match_id)
    return _result(match_id, points, receipts)


def backfill_match_from_diagnostic(conn, match_id: str) -> HighlightBackfillResult:
    """Download one diagnostic and atomically update only its receipts."""
    production_worker, original, receipts = _prepare_diagnostic(conn, match_id)
    before = [protected_point_snapshot(point) for point in original]

    old_autocommit = conn.autocommit
    try:
        conn.autocommit = False
        locked = _load_points(conn, match_id, for_update=True)
        if [protected_point_snapshot(point) for point in locked] != before:
            raise production_worker.BackfillConsistencyError(
                f"match {match_id} changed before highlight evidence write"
            )
        with conn.cursor() as cur:
            for point_id, receipt in receipts.items():
                cur.execute(
                    "update public.points set highlight_evidence = %s::jsonb "
                    "where id = %s and match_id = %s",
                    (json.dumps(receipt), point_id, match_id),
                )
            # The reel is derived data. Removing its state makes the next
            # web/iOS request enqueue a v2 render, including when a v2
            # empty answer was cached before this recovery ran.
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

    stored = _load_points(conn, match_id)
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
