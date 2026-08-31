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


# Two rules filter the track on BlurBall's per-detection confidence: the
# net read at 1.0, and the flight reader at SEG_MIN_CONF, which is 4. The
# assembler drops confidence long before the evidence dump is written, so a
# track built from the dump alone can only stamp every sample with one
# value — and MEASURED on the 23-point corpus the rules were written
# against, no stamp works. At 1.0 the flight reader sees nothing and the
# repair layer goes silently quiet; at 25 it sees samples it would have
# rejected and two of the 23 points change verdict. Both are worse than no
# track at all, because a page that answers wrongly is read exactly like a
# page that answers.
#
# So the confidence has to be real, which means reading what BlurBall wrote
# rather than what survived the assembler. That file is on disk during
# processing and costs nothing. When it is not there the artifact says so,
# and the reader leaves the track alone rather than trusting a number
# nobody measured.
CONF_MEASURED = "measured"
CONF_STAMPED = "stamped"
STAMP = 1.0


def blurball_confidence(path):
    """Frame -> confidence, straight from BlurBall's own output."""
    conf = {}
    with open(path) as fh:
        for line in fh:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("x") is None:
                continue
            conf[int(r["f"])] = float(r.get("conf", 0.0))
    return conf


def point_tracks(blob, blurball=None):
    """Full-rate ball track per card, for the winner rules to read.

    A SECOND artifact rather than more of serves.json, and the reason is
    who reads it. serves.json goes to the browser, which is why its track
    is thinned to every third frame. This one is read on the server and is
    undecimated. The admin trail may receive its time/x/y rows, but the
    confidence column and winner-rule work stay on the server.

    Times are SOURCE seconds, the same clock the placement candidates use,
    so the reader hands the rules a clip origin of zero and nothing converts
    anywhere. Measured on the same corpus: moving the track onto the source
    clock changes no verdict on any of the 23 points.

    Keyed by the card's own t0, because point ids do not exist yet when the
    worker writes this, and the portal already matches cards to points by
    their start.
    """
    track = [(float(t), float(x), float(y)) for t, x, y in blob["track"]]
    w, h = float(blob["w"]), float(blob["h"])
    fps = float(blob["fps"])
    conf = blurball_confidence(blurball) if blurball else None
    out = []
    i = 0
    for card in blob["cards"]:
        t0, t1 = float(card[0]), float(card[1])
        while i < len(track) and track[i][0] < t0:
            i += 1
        j = i
        rows = []
        while j < len(track) and track[j][0] <= t1:
            t, x, y = track[j]
            c = STAMP if conf is None else conf.get(int(round(t * fps)), 0.0)
            rows.append([round(t, 3), round(x / w, 4), round(y / h, 4),
                         round(c, 2)])
            j += 1
        out.append({"t0": round(t0, 2), "track": rows})
    return {"v": 2, "clock": "source", "w": w, "h": h,
            "conf": CONF_STAMPED if conf is None else CONF_MEASURED,
            "cards": out}


def write_point_tracks(blob, workdir, blurball=None):
    """Build the track artifact beside the diagnosis. Returns its path."""
    dest = os.path.join(workdir, "tracks.json")
    with open(dest, "w") as fh:
        json.dump(point_tracks(blob, blurball), fh, separators=(",", ":"))
    return dest


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
            # NEVER stamp over measured confidences. This script has no
            # blurball.jsonl to read, so anything it builds here would be
            # stamped — and the reader ignores a stamped track, so
            # re-publishing after a rule change would silently switch two of
            # the three winner rules off on every match that had them.
            # Rebuild the track only where there is nothing better already.
            existing = os.path.join(os.path.dirname(dest), "tracks.json")
            measured = False
            if os.path.exists(existing):
                try:
                    with open(existing) as fh:
                        measured = json.load(fh).get("conf") == CONF_MEASURED
                except ValueError:
                    measured = False
            tracks = existing if measured else write_point_tracks(
                blob, os.path.dirname(dest))
            if s3:
                prefix = f"points/{owner_of(conn, name)}/{name}"
                s3.upload_file(dest, MEDIA_BUCKET, f"{prefix}/serves.json",
                               ExtraArgs={"ContentType": "application/json"})
                if not measured:
                    s3.upload_file(tracks, MEDIA_BUCKET,
                                   f"{prefix}/tracks.json",
                                   ExtraArgs={"ContentType": "application/json"})
            print(f"{name[:8]}  {len(page['cards']):3d} cards, "
                  f"{anchored:3d} with a serve, "
                  f"{len(page['cards']) - anchored:3d} without "
                  f"({size_kb:.0f} KB, track "
                  f"{'kept measured' if measured else 'rebuilt stamped'})")
            done += 1

    print(f"\n{done} published, {failed} skipped")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
