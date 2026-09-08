#!/usr/bin/env python3
"""Canary-gated, evidence-only historical highlight recovery.

Dry-run is the default. Pass ``--write`` explicitly to update receipts after
the named canary. The command never replaces point rows or match metadata.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Any, Callable, Sequence

import psycopg2.extras

try:
    from . import worker as production_worker
    from .highlight_backfill import (
        analyze_match_from_diagnostic,
        backfill_match_from_diagnostic,
    )
except ImportError:
    import worker as production_worker
    from highlight_backfill import (
        analyze_match_from_diagnostic,
        backfill_match_from_diagnostic,
    )


@dataclass(frozen=True)
class RolloutSummary:
    matches: int
    points: int
    succeeded: int
    qualifying: int
    failed_match_ids: tuple[str, ...]


def list_eligible_matches(
    conn, user_ids: Sequence[str], since_days: int | None = None
) -> list[dict[str, Any]]:
    if not user_ids:
        raise ValueError("at least one user id is required")
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select m.id::text as match_id, count(p.id)::int as point_count "
            "from public.matches m join public.points p on p.match_id = m.id "
            "where m.status = 'ready' and m.user_id = any(%s::uuid[]) "
            "and (%s::int is null or m.created_at >= "
            "now() - (%s::int * interval '1 day')) "
            "and coalesce(m.cut_source, 'auto') <> 'manual' "
            "and exists (select 1 from public.points scored "
            "where scored.match_id = m.id "
            "and scored.confirmed_winner is not null) "
            "group by m.id, m.created_at order by m.created_at, m.id",
            (list(user_ids), since_days, since_days),
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
            raise RuntimeError(f"highlight backfill match {match_id} disappeared")
        cur.execute(
            "select to_jsonb(p) - 'highlight_evidence' as point "
            "from public.points p where p.match_id = %s order by p.t0, p.idx",
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
    backfill: Callable[[Any, str], Any] = backfill_match_from_diagnostic,
    analyzer: Callable[[Any, str], Any] = analyze_match_from_diagnostic,
    eligible: list[dict[str, Any]],
    snapshotter: Callable[[Any, str], dict[str, Any]] = snapshot_match,
) -> RolloutSummary:
    if all_matches and target_match_ids:
        raise ValueError("all_matches and target_match_ids are mutually exclusive")
    by_id = {str(item["match_id"]): item for item in eligible}
    if canary_match_id not in by_id:
        raise RuntimeError(f"canary match {canary_match_id} is not eligible")
    selected = [canary_match_id]
    candidates = (
        [str(item["match_id"]) for item in eligible]
        if all_matches else [str(value) for value in target_match_ids]
    )
    for match_id in candidates:
        if match_id not in by_id:
            raise RuntimeError(f"target match {match_id} is not eligible")
        if match_id not in selected:
            selected.append(match_id)
    point_count = sum(int(by_id[value]["point_count"]) for value in selected)
    if dry_run:
        qualifying = sum(
            int(analyzer(conn, match_id).qualifying) for match_id in selected
        )
        return RolloutSummary(
            len(selected), point_count, 0, qualifying, ()
        )

    succeeded = 0
    qualifying = 0
    failed = []
    for position, match_id in enumerate(selected):
        before = snapshotter(conn, match_id)
        try:
            result = backfill(conn, match_id)
            if position == 0 and int(result.qualifying) <= 0:
                raise RuntimeError(
                    f"canary produced no qualifying rallies: {match_id}"
                )
            after = snapshotter(conn, match_id)
            if before != after:
                raise production_worker.BackfillConsistencyError(
                    f"match {match_id} protected fields changed"
                )
        except production_worker.BackfillConsistencyError:
            raise
        except Exception:
            if position == 0:
                raise
            failed.append(match_id)
            continue
        succeeded += 1
        qualifying += int(result.qualifying)
    return RolloutSummary(
        len(selected), point_count, succeeded, qualifying, tuple(failed)
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", action="append", required=True)
    parser.add_argument("--canary-match-id", required=True)
    parser.add_argument("--since-days", type=int)
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--all-after-canary", action="store_true")
    scope.add_argument("--match-id", action="append", default=[])
    parser.add_argument(
        "--write", action="store_true",
        help="perform receipt updates; omission is a zero-write dry run",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    conn = production_worker.connect()
    try:
        eligible = list_eligible_matches(conn, args.user_id, args.since_days)
        summary = run_rollout(
            conn,
            args.canary_match_id,
            args.all_after_canary,
            target_match_ids=args.match_id,
            dry_run=not args.write,
            eligible=eligible,
        )
    finally:
        conn.close()
    mode = "rollout" if args.write else "dry run"
    print(
        f"highlight v2 {mode}: {summary.matches} matches, {summary.points} points, "
        f"{summary.succeeded} succeeded, {summary.qualifying} qualifying rallies"
    )
    if summary.failed_match_ids:
        print("failed matches: " + ", ".join(summary.failed_match_ids))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
