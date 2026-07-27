#!/usr/bin/env python3
"""Backfill matches.thumb_path (migration 033) for matches processed before
poster thumbnails existed.

For every ready match with a NULL thumb_path: download its first surviving
(non-deleted) point clip from R2, extract the rally-midpoint frame with
worker.extract_thumb(), upload points/<uid>/<matchId>/thumb.jpg, and set
thumb_path. Idempotent — a match with a thumb is never re-selected, and a
match whose clip is gone from R2 is skipped and reported, not failed.

Run from worker/:
    venv/bin/python backfill_thumbs.py [--dry-run] [--limit N]
"""

from __future__ import annotations

import argparse
import os
import tempfile

import psycopg2.extras

try:
    from . import worker
except ImportError:  # Direct execution from worker/.
    import worker


def list_eligible(conn, limit: int | None) -> list[dict]:
    """Ready matches without a thumb, each with its first surviving clip.
    Matches whose points are all soft-deleted simply don't appear (they
    keep the plain card style)."""
    sql = (
        "select m.id::text as match_id, m.user_id::text as user_id, "
        "       p.clip_path, p.t0, p.t1 "
        "from public.matches m "
        "join lateral ("
        "  select clip_path, t0, t1 from public.points "
        "  where match_id = m.id and not deleted "
        "  order by idx limit 1"
        ") p on true "
        "where m.status = 'ready' and m.thumb_path is null "
        "order by m.created_at"
    )
    if limit:
        sql += f" limit {int(limit)}"
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql)
        return [dict(r) for r in cur.fetchall()]


def backfill_one(conn, row: dict, dry_run: bool) -> bool:
    match_id = row["match_id"]
    loc = worker.parse_r2_path(row["clip_path"] or "")
    if not loc:
        print(f"  skip {match_id}: clip_path not an r2:// URI")
        return False
    bucket, key = loc
    key_prefix = f"points/{row['user_id']}/{match_id}"
    thumb_key = f"{key_prefix}/thumb.jpg"
    thumb_uri = f"r2://{worker.R2_MEDIA_BUCKET}/{thumb_key}"

    if dry_run:
        print(f"  would thumb {match_id} from {key}")
        return True

    with tempfile.TemporaryDirectory(prefix="ponglens-thumbs-") as tmp:
        clip_local = os.path.join(tmp, "clip.mp4")
        try:
            worker.r2().download_file(bucket, key, clip_local)
        except Exception as e:
            print(f"  skip {match_id}: clip gone from R2 ({e})")
            return False
        seek = max(0.0, (float(row["t1"]) - float(row["t0"])) / 2)
        thumb_local = os.path.join(tmp, "thumb.jpg")
        if not worker.extract_thumb(clip_local, thumb_local, seek):
            print(f"  skip {match_id}: frame extraction failed")
            return False
        worker.r2().upload_file(
            thumb_local, worker.R2_MEDIA_BUCKET, thumb_key,
            ExtraArgs={"ContentType": "image/jpeg"},
        )
        num_bytes = os.path.getsize(thumb_local)

    with conn.cursor() as cur:
        cur.execute(
            "update public.matches set thumb_path = %s "
            "where id = %s and thumb_path is null",
            (thumb_uri, match_id),
        )
    worker.ledger_append(conn, row["user_id"], "other", num_bytes,
                         thumb_uri, match_id)
    print(f"  ok   {match_id} ({num_bytes // 1024} KB)")
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    conn = worker.connect()
    rows = list_eligible(conn, args.limit)
    print(f"{len(rows)} match(es) need thumbs")
    done = sum(1 for r in rows if backfill_one(conn, r, args.dry_run))
    print(f"done: {done}/{len(rows)}")


if __name__ == "__main__":
    main()
