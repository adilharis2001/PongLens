#!/usr/bin/env python3
"""Fill matches.raw_path for legacy matches whose original still exists.

matches.raw_path arrived with commerce (096). Matches processed before it
have the column null even though their original upload is still in
ponglens-raw, reached only through the match's source job. The sweep now
protects those raws through the job as well, but the apps draw the
"Original" pill and the raw preview from the column alone (see
src/lib/originalVideo.ts for why), so a legacy match with a surviving raw
shows no way to watch it.

For every match with a null raw_path and a source job whose input_path is
in ponglens-raw: HEAD the object, and set raw_path to it when it exists.
Matches whose raw was swept before commerce are reported and left null,
which is the honest state for them. Idempotent.

Run from worker/:
    venv/bin/python backfill_raw_path.py [--dry-run] [--limit N]
"""

from __future__ import annotations

import argparse

import psycopg2.extras

try:
    from . import worker
except ImportError:  # Direct execution from worker/.
    import worker


def list_candidates(conn, limit: int | None) -> list[dict]:
    sql = (
        "select m.id::text as match_id, m.status, j.input_path "
        "from public.matches m "
        "join public.jobs j on j.id = m.job_id "
        "where m.raw_path is null "
        "and j.input_path like %s "
        "order by m.created_at"
    )
    params = [f"r2://{worker.R2_RAW_BUCKET}/%"]
    if limit:
        sql += " limit %s"
        params.append(int(limit))
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def object_exists(client, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:  # noqa: BLE001 — a 404 is the expected miss
        return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    conn = worker.connect()
    client = worker.r2()
    rows = list_candidates(conn, args.limit)
    print(f"{len(rows)} match(es) with a null raw_path and a raw source job")
    filled = gone = 0
    for row in rows:
        loc = worker.parse_r2_path(row["input_path"])
        if not loc:
            continue
        bucket, key = loc
        if not object_exists(client, bucket, key):
            gone += 1
            print(f"  gone   {row['match_id']} ({row['status']}): {key}")
            continue
        filled += 1
        print(f"  {'would fill' if args.dry_run else 'fill'} "
              f"{row['match_id']} ({row['status']}): {key}")
        if args.dry_run:
            continue
        with conn.cursor() as cur:
            cur.execute(
                "update public.matches set raw_path = %s "
                "where id = %s and raw_path is null",
                (row["input_path"], row["match_id"]),
            )
    print(f"done: {filled} filled, {gone} raw(s) no longer stored"
          + (" (dry run, nothing written)" if args.dry_run else ""))


if __name__ == "__main__":
    main()
