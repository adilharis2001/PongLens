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
from research_serve_misses import apply_shipped_settings, build  # noqa: E402

import psycopg2  # noqa: E402


# The trail fades over half a second, so it needs about five points to read
# as a line. The dump carries every detected frame — 30 a second — which on
# a 128-card match is half a megabyte of JSON the phone has to download to
# draw the same picture. Every third frame and four decimals (a thousandth
# of the frame, well under a pixel) is visually identical and about a third
# the size.
TRACK_STRIDE = 3
COORD_DP = 4


def trim_for_transport(page):
    """Shrink the payload without changing what it draws."""
    for card in page.get("cards", []):
        track = card.get("track") or []
        # Keep the last point whatever the stride, so the trail always ends
        # where the ball actually was rather than up to two frames short.
        kept = track[::TRACK_STRIDE]
        if track and kept and kept[-1] is not track[-1]:
            kept.append(track[-1])
        card["track"] = [
            [round(t, 2), round(x, COORD_DP), round(y, COORD_DP)]
            for t, x, y in kept
        ]
        for b in card.get("bounces") or []:
            b["x"] = round(b["x"], COORD_DP)
            b["y"] = round(b["y"], COORD_DP)
    return page


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
    # The serve rule's two tunable constants come from app_config per job.
    # Building at the module defaults instead is how the research page
    # silently drifted from production once already.
    pad, merge = apply_shipped_settings(env)
    print(f"serve rule at the shipped settings: surface pad {pad} m, "
          f"merge {merge} s")
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

            # Explain the cards the PLAYER has, not the ones this re-run
            # happened to draw. A reprocess runs today's constants over the
            # same video and lands on different boundaries — 154 cards where
            # production shipped 128 on the first match backfilled — so
            # diagnosing its own cards would key every overlay to a rally
            # the library does not contain. research_reprocess already
            # carries the production spans; use them and the walk lines up
            # with the points table by construction.
            prod = blob.get("prod_cards")
            if prod:
                blob["cards"] = prod
            try:
                page = trim_for_transport(build(blob, include_all=True))
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
