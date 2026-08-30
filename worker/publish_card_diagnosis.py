#!/usr/bin/env python3
"""Publish the per-card diagnosis where the admin portal reads it.

    ./venv/bin/python publish_card_diagnosis.py --workroot <dir> [ids...]

The research page and the admin portal want the same walk over different
populations, so both come from research_serve_misses.build(): the page asks
for the cards with no serve, the portal asks for all of them. The portal's
copy lands beside the match's own match.json —

    points/<user_id>/<match_id>/serves.json

— which is the first place src/app/admin/uploads/[matchId]/page.tsx looks,
and the same key the worker writes during normal processing. The research
prefix is left alone, so publishing for the portal cannot change what the
research page shows.

Reads the evidence dumps a research_reprocess run left in its workroot.
Cheap: seconds a match, no video decoded, so re-running after a rule change
costs nothing next to the reprocess that produced the dumps.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_reprocess import MEDIA_BUCKET, config, s3_client  # noqa: E402
from research_serve_misses import build  # noqa: E402

import psycopg2  # noqa: E402


def owner_of(conn, match_id):
    """The match's user id, which is the middle of its R2 prefix."""
    with conn.cursor() as cur:
        cur.execute("select user_id from public.matches where id = %s",
                    (match_id,))
        row = cur.fetchone()
    if not row:
        raise SystemExit(f"{match_id}: no such match")
    return str(row[0])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workroot", required=True)
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("ids", nargs="*")
    args = ap.parse_args()

    env = config()
    s3 = None if args.no_upload else s3_client(env)
    done = failed = 0

    with psycopg2.connect(env["DATABASE_URL"]) as conn:
        for name in sorted(os.listdir(args.workroot)):
            if args.ids and name not in args.ids:
                continue
            src = os.path.join(args.workroot, name, "evidence.json")
            if not os.path.exists(src):
                continue
            with open(src) as fh:
                blob = json.load(fh)
            blob.setdefault("match_id", name)
            try:
                page = build(blob, include_all=True)
            except ValueError as e:
                print(f"{name[:8]}  skipped: {e}")
                failed += 1
                continue

            dest = os.path.join(args.workroot, name, "serves.json")
            with open(dest, "w") as fh:
                json.dump(page, fh, separators=(",", ":"))

            anchored = sum(1 for c in page["cards"]
                           if c.get("serve_s") is not None)
            size_kb = os.path.getsize(dest) / 1024
            if s3:
                key = f"points/{owner_of(conn, name)}/{name}/serves.json"
                s3.upload_file(dest, MEDIA_BUCKET, key,
                               ExtraArgs={"ContentType": "application/json"})
            print(f"{name[:8]}  {len(page['cards']):3d} cards, "
                  f"{anchored:3d} with a serve, "
                  f"{len(page['cards']) - anchored:3d} without "
                  f"({size_kb:.0f} KB)")
            done += 1

    print(f"\n{done} published, {failed} skipped")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
