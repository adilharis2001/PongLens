"""Turn an evidence dump into the shape the review page already reads.

  ./venv/bin/python research_shape.py --workroot <dir> [--no-upload]

`--evidence-dump` writes what the assembler saw, in the assembler's own
terms. `/research/fullmatch` reads a slightly different document, because it
grew up beside the lab: the ball track carries an in-prism flag per sample,
bounces carry their image position, and the two card lanes are named for
what they were when the page was built — `cards` is what production ships
today and `newcards` is the candidate being judged against it.

Rather than fork nine hundred lines of a working renderer, this converts.
Everything here is derivable from the dump alone, so it can be re-run
without touching video: the in-prism flag is a point-in-polygon test
against the prism the dump already carries, and a bounce takes the position
of the nearest tracked sample.

The two card lanes are deliberately crossed over:

    cards     <- prod_cards, the point rows the owner has now
    newcards  <- cards, what the pipeline would produce today

so the blue lane on the page stays "what he already has" and the purple one
stays "what is being proposed", which is what the page's legend says and
what his eye is trained on from the Koko, Terry and Tripp pass.
"""
import argparse
import bisect
import json
import os
import sys

import boto3

import psycopg2

from research_reprocess import MEDIA_BUCKET, PREFIX, config, s3_client

CORNER_ORDER = ("A_near_1", "B_near_2", "C_far_2", "D_far_1")


def winner_taps(conn, match_id):
    """When the owner called each point, on the SOURCE clock.

    `scored_at_cut_s` is where the playhead was in the CUT video at the
    moment the winner was tapped, so it means nothing until it is put back
    on the clock the cards live on. Each point carries its own offset in
    `cut_t0`, and the two only line up per point: a match's clips overlap,
    so there is no single constant that converts the whole match.

    This is the one label on a re-run that owes nothing to the pipeline.
    Every other lane on the page is something a detector produced, and
    judging new cards by a detector's own output is circular. A tap is a
    human saying "this rally is over", so a card either carries one or it
    does not.

    It is a coarse anchor and should be read as one: measured on this
    match the tap lands a median 1.5s BEFORE the card ends, with a spread
    from 10s early to 10s late. Good enough to say which rally; useless
    for saying where the rally ended.
    """
    with conn.cursor() as cur:
        cur.execute(
            "select t0, cut_t0, scored_at_cut_s, confirmed_winner, "
            "       game_end_override "
            "from public.points "
            "where match_id = %s and not deleted "
            "  and scored_at_cut_s is not null and cut_t0 is not null "
            "order by t0", (match_id,))
        return [[round(float(t0) + (float(tap) - float(ct0)), 2), win, ge]
                for t0, ct0, tap, win, ge in cur.fetchall()]


def in_poly(poly, x, y):
    """Ray casting. The prism is convex, but this does not need it to be."""
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            xx = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
            if x < xx:
                inside = not inside
    return inside


def convert(blob, taps=None):
    quad_d = blob.get("quad")
    if not quad_d:
        raise ValueError("no table quad; nothing to draw against")
    quad = [[float(quad_d[k][0]), float(quad_d[k][1])] for k in CORNER_ORDER]
    a, b, c, d = quad
    # A near-left, B near-right, C far-right, D far-left, so A->D and B->C
    # are the 2.740 m sides and the net crosses their midpoints.
    net = [[(a[0] + d[0]) / 2, (a[1] + d[1]) / 2],
           [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]]

    prism = blob.get("prism") or quad
    track = [[t, x, y, int(in_poly(prism, x, y))]
             for t, x, y in blob["track"]]

    times = [p[0] for p in track]
    bounces = []
    for t, on_table in blob["bounces"]:
        i = min(bisect.bisect_left(times, t), len(track) - 1)
        if i > 0 and abs(times[i - 1] - t) < abs(times[i] - t):
            i -= 1
        bounces.append([t, track[i][1], track[i][2], int(on_table)])

    return {
        "key": blob["match_id"],
        "duration": blob["duration"],
        "w": blob["w"], "h": blob["h"],
        "quad": quad, "net": net, "prism": prism,
        "track": track,
        "bounces": bounces,
        "crossings": blob["crossings"],
        "serves": blob["serves"],
        "dense": blob["dense"],
        # crossed over on purpose — see the module docstring
        "cards": [[t0, t1, None] for t0, t1 in blob["prod_cards"]],
        "newcards": [[c[0], c[1]] for c in blob["cards"]],
        # no person detector on this path; the page draws an empty lane
        "presence": [],
        # the owner's own winner calls, on the source clock
        "taps": taps or [],
        # carried through for the page's own header, not read by the renderer
        "meta": {
            "opponent": blob.get("opponent"),
            "venue": blob.get("venue"),
            "created": blob.get("created"),
            "route": blob.get("route"),
            "serves_per_min": blob.get("serves_per_min"),
            "camera": blob.get("camera"),
            "calibration": blob.get("calibration"),
            "notes": blob.get("notes"),
        },
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workroot", required=True)
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("ids", nargs="*",
                    help="only these match ids; default is every one found")
    args = ap.parse_args()

    env = config()
    s3 = None if args.no_upload else s3_client(env)
    conn = psycopg2.connect(env["DATABASE_URL"])
    rows = []
    for name in sorted(os.listdir(args.workroot)):
        if args.ids and name not in args.ids:
            continue
        src = os.path.join(args.workroot, name, "evidence.json")
        if not os.path.exists(src):
            continue
        with open(src) as fh:
            blob = json.load(fh)
        try:
            page = convert(blob, winner_taps(conn, name))
        except ValueError as e:
            print(f"{name[:8]}  skipped: {e}")
            continue
        dest = os.path.join(args.workroot, name, "page.json")
        with open(dest, "w") as fh:
            json.dump(page, fh, separators=(",", ":"))
        if s3:
            s3.upload_file(dest, MEDIA_BUCKET, f"{PREFIX}/{name}.page.json",
                           ExtraArgs={"ContentType": "application/json"})
        m = page["meta"]
        rows.append((name, m, page))
        print(f"{name[:8]}  {m['route']:14s} "
              f"{len(page['newcards']):4d} new vs {len(page['cards']):4d} now  "
              f"{m['serves_per_min']:5.2f}/min  camera {m['camera']}  "
              f"-> {os.path.getsize(dest) / 1024:.0f} KB")

    print(f"\n{len(rows)} match(es) shaped"
          f"{'' if args.no_upload else ' and uploaded'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
