#!/usr/bin/env python3
"""Re-encode existing poster thumbs from the old 720px JPEG to the 560px
WebP the match cards actually need (~42 KB -> ~15 KB each).

560px is sized off the widest consumer: the Matches grid is 3-up inside a
max-w-4xl shell, so a card is ~274 CSS px — 549 device px on a 2x display.
See worker.THUMB_WIDTH.

Deliberately two phases, because a thumbnail is something you look at before
you trust it:

    (default)   encode + upload thumb.webp NEXT TO thumb.jpg, repoint
                matches.thumb_path. The JPEG is untouched, so --revert
                undoes it completely.
    --revert    point thumb_path back at thumb.jpg.
    --cleanup   delete the now-unreferenced thumb.jpg objects and settle the
                storage ledger. Only after the grid has been eyeballed —
                this is the step that can't be undone.

Encoding goes through worker.encode_thumb, so a converted thumb is
byte-identical to what a fresh job would produce at the same source size.

Run from worker/:
    venv/bin/python backfill_thumb_webp.py [--dry-run] [--limit N]
    venv/bin/python backfill_thumb_webp.py --cleanup [--dry-run]
    venv/bin/python backfill_thumb_webp.py --revert [--dry-run]
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


def list_rows(conn, suffix: str, limit: int | None) -> list[dict]:
    sql = (
        "select id::text as match_id, user_id::text as user_id, thumb_path "
        "from public.matches "
        "where thumb_path like %s "
        "order by created_at"
    )
    if limit:
        sql += f" limit {int(limit)}"
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, (f"%{suffix}",))
        return [dict(r) for r in cur.fetchall()]


def convert_one(conn, row: dict, dry_run: bool) -> bool:
    match_id, jpg_uri = row["match_id"], row["thumb_path"]
    loc = worker.parse_r2_path(jpg_uri or "")
    if not loc:
        print(f"  skip {match_id}: thumb_path not an r2:// URI")
        return False
    bucket, jpg_key = loc
    webp_key = jpg_key[: -len(".jpg")] + ".webp"
    webp_uri = f"r2://{bucket}/{webp_key}"

    if dry_run:
        print(f"  would convert {match_id}: {jpg_key} -> {webp_key}")
        return True

    with tempfile.TemporaryDirectory(prefix="ponglens-webp-") as tmp:
        src = os.path.join(tmp, "thumb.jpg")
        out = os.path.join(tmp, "thumb.webp")
        try:
            worker.r2().download_file(bucket, jpg_key, src)
        except Exception as e:
            print(f"  skip {match_id}: thumb gone from R2 ({e})")
            return False
        if not worker.encode_thumb(src, out):
            print(f"  skip {match_id}: encode failed")
            return False
        before, after = os.path.getsize(src), os.path.getsize(out)
        worker.r2().upload_file(
            out, bucket, webp_key,
            ExtraArgs={"ContentType": "image/webp"},
        )

    # Repoint only if the row still holds the JPEG we just converted, so a
    # concurrent reprocess that already wrote a fresh thumb wins.
    with conn.cursor() as cur:
        cur.execute(
            "update public.matches set thumb_path = %s "
            "where id = %s and thumb_path = %s",
            (webp_uri, match_id, jpg_uri),
        )
        repointed = cur.rowcount
    if not repointed:
        print(f"  skip {match_id}: thumb_path moved under us, left as-is")
        return False
    worker.ledger_append(conn, row["user_id"], "other", after,
                         webp_uri, match_id)
    print(f"  ok   {match_id}  {before // 1024} KB -> {after // 1024} KB "
          f"({after * 100 // before}%)")
    return True


def revert_one(conn, row: dict, dry_run: bool) -> bool:
    match_id, webp_uri = row["match_id"], row["thumb_path"]
    jpg_uri = webp_uri[: -len(".webp")] + ".jpg"
    loc = worker.parse_r2_path(jpg_uri)
    if not loc:
        print(f"  skip {match_id}: thumb_path not an r2:// URI")
        return False
    if dry_run:
        print(f"  would revert {match_id} -> {jpg_uri}")
        return True
    try:
        worker.r2().head_object(Bucket=loc[0], Key=loc[1])
    except Exception:
        print(f"  skip {match_id}: no JPEG to revert to (already cleaned up)")
        return False
    with conn.cursor() as cur:
        cur.execute(
            "update public.matches set thumb_path = %s "
            "where id = %s and thumb_path = %s",
            (jpg_uri, match_id, webp_uri),
        )
    worker.ledger_negate_keys(conn, [webp_uri])
    print(f"  ok   {match_id} reverted")
    return True


def cleanup_one(conn, row: dict, dry_run: bool) -> bool:
    """Delete the superseded JPEG. Irreversible — the frame would have to be
    re-extracted from the point clip to get it back."""
    match_id, webp_uri = row["match_id"], row["thumb_path"]
    jpg_uri = webp_uri[: -len(".webp")] + ".jpg"
    loc = worker.parse_r2_path(jpg_uri)
    if not loc:
        print(f"  skip {match_id}: thumb_path not an r2:// URI")
        return False
    bucket, jpg_key = loc
    if dry_run:
        print(f"  would delete {jpg_key}")
        return True
    try:
        worker.r2().delete_object(Bucket=bucket, Key=jpg_key)
    except Exception as e:
        print(f"  skip {match_id}: delete failed ({e})")
        return False
    worker.ledger_negate_keys(conn, [jpg_uri])
    print(f"  ok   {match_id} jpeg removed")
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--revert", action="store_true")
    mode.add_argument("--cleanup", action="store_true")
    args = ap.parse_args()

    conn = worker.connect()
    if args.revert:
        rows = list_rows(conn, "thumb.webp", args.limit)
        print(f"{len(rows)} webp thumb(s) to revert")
        run = revert_one
    elif args.cleanup:
        rows = list_rows(conn, "thumb.webp", args.limit)
        print(f"{len(rows)} superseded jpeg(s) to delete")
        run = cleanup_one
    else:
        rows = list_rows(conn, "thumb.jpg", args.limit)
        print(f"{len(rows)} jpeg thumb(s) to convert")
        run = convert_one

    done = sum(1 for r in rows if run(conn, r, args.dry_run))
    print(f"done: {done}/{len(rows)}")


if __name__ == "__main__":
    main()
