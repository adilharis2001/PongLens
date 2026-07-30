#!/usr/bin/env python3
"""Canary-gated administrator runner for the placement-v3 backfill."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Any, Callable, Sequence

import psycopg2.extras

try:
    from . import worker as production_worker
except ImportError:  # Direct execution from worker/.
    import worker as production_worker


@dataclass(frozen=True)
class RolloutSummary:
    eligible: int
    eligible_points: int
    succeeded: int
    updated_points: int
    failed_match_ids: tuple[str, ...]


def list_eligible_matches(conn) -> list[dict[str, Any]]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select m.id::text as match_id, count(p.id)::int as point_count "
            "from public.matches m "
            "join public.jobs j on j.id = m.job_id "
            "join public.points p on p.match_id = m.id "
            "where m.status = 'ready' "
            "and j.input_path is not null "
            "and m.match_json_path is not null "
            "group by m.id, m.created_at order by m.created_at"
        )
        return [dict(row) for row in cur.fetchall()]


def snapshot_match(conn, match_id: str) -> dict[str, Any]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select to_jsonb(m) as match from public.matches m where m.id = %s",
            (match_id,),
        )
        match = cur.fetchone()
        if not match:
            raise RuntimeError(f"placement backfill match {match_id} disappeared")
        cur.execute(
            "select to_jsonb(p) - 'placement' as point "
            "from public.points p where p.match_id = %s order by p.idx",
            (match_id,),
        )
        points = [row["point"] for row in cur.fetchall()]
    return {"match": match["match"], "points": points}


def run_rollout(
    conn,
    canary_match_id: str,
    all_matches: bool,
    *,
    target_match_ids: Sequence[str] = (),
    dry_run: bool = False,
    backfill: Callable[[Any, str], Any] | None = None,
    eligible_loader: Callable[[Any], list[dict[str, Any]]] | None = None,
    snapshotter: Callable[[Any, str], dict[str, Any]] | None = None,
) -> RolloutSummary:
    if all_matches and target_match_ids:
        raise ValueError(
            "all_matches and target_match_ids are mutually exclusive"
        )
    backfill = backfill or production_worker.backfill_placement_for_match
    eligible_loader = eligible_loader or list_eligible_matches
    snapshotter = snapshotter or snapshot_match
    eligible = eligible_loader(conn)
    by_id = {str(item["match_id"]): item for item in eligible}
    if canary_match_id not in by_id:
        raise RuntimeError(
            f"canary match {canary_match_id} is not eligible for backfill"
        )
    ordered_ids = [canary_match_id]
    if all_matches:
        ordered_ids.extend(
            str(item["match_id"])
            for item in eligible
            if str(item["match_id"]) != canary_match_id
        )
    else:
        for match_id in target_match_ids:
            normalized = str(match_id)
            if normalized not in by_id:
                raise RuntimeError(
                    f"target match {normalized} is not eligible for backfill"
                )
            if normalized not in ordered_ids:
                ordered_ids.append(normalized)

    eligible_points = sum(
        int(by_id[match_id]["point_count"])
        for match_id in ordered_ids
    )
    if dry_run:
        return RolloutSummary(
            eligible=len(ordered_ids),
            eligible_points=eligible_points,
            succeeded=0,
            updated_points=0,
            failed_match_ids=(),
        )

    succeeded = 0
    updated_points = 0
    failed: list[str] = []
    for position, match_id in enumerate(ordered_ids):
        is_canary = position == 0
        before = snapshotter(conn, match_id)
        try:
            result = backfill(conn, match_id)
            after = snapshotter(conn, match_id)
            if before != after:
                raise production_worker.BackfillConsistencyError(
                    f"match {match_id} non-placement invariants changed"
                )
        except production_worker.BackfillConsistencyError:
            raise
        except Exception:
            if is_canary:
                raise
            failed.append(match_id)
            continue
        succeeded += 1
        updated_points += int(result.point_count)

    return RolloutSummary(
        eligible=len(ordered_ids),
        eligible_points=eligible_points,
        succeeded=succeeded,
        updated_points=updated_points,
        failed_match_ids=tuple(failed),
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canary-match-id", required=True)
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--all-after-canary", action="store_true")
    scope.add_argument(
        "--match-id",
        action="append",
        default=[],
        help="additional eligible match to run after the canary; repeatable",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    conn = production_worker.connect()
    try:
        summary = run_rollout(
            conn,
            args.canary_match_id,
            args.all_after_canary,
            target_match_ids=args.match_id,
            dry_run=args.dry_run,
        )
    finally:
        conn.close()

    if args.dry_run:
        print(
            f"dry run: {summary.eligible} eligible matches, "
            f"{summary.eligible_points} points, 0 writes"
        )
        return 0
    print(
        f"placement v3 rollout: {summary.succeeded} succeeded, "
        f"{len(summary.failed_match_ids)} failed, "
        f"{summary.updated_points} points updated"
    )
    if summary.failed_match_ids:
        print("failed matches: " + ", ".join(summary.failed_match_ids))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
