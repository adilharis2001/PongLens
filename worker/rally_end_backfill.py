"""Fill points.rally_end_cut_s on matches processed before 143.

New matches get this from points_v2.rally_end_ev, which reads the bounce
list its own detector built. A match already in the database has no cards
left to ask, so this recovers the same quantity from what WAS stored: the
placement candidates, which are the projected bounces with their table
coordinates already on them.

The two are not the same detector — placement_reconstruction's bounce test
is stricter than points_v2.bounces — so a backfilled value is an
approximation of what a reprocess would produce. It is a close one: over
423 points on six matches the gap from the last on-table candidate to t1
has a median of 2.57s, and TAIL_AFTER_BOUNCE is 2.6. That is the padding
this whole change exists to remove, recovered to within 3 hundredths.

Nothing here decodes video or calls a model. Reads placement and the
stored cut segments, writes one numeric column.

  python -m worker.rally_end_backfill --match <uuid> [--match <uuid> ...]
  python -m worker.rally_end_backfill --all-v2 --limit 20
  python -m worker.rally_end_backfill --match <uuid> --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys

# The playing surface plus the tolerance placement itself allows, in
# metres. A rally ends on the table; retrieval bounces on the floor beside
# it, and the floor is three quarters of a metre below the plane the
# homography describes, so it projects far outside this box.
TABLE_W_M = 1.525
TABLE_L_M = 2.74
EDGE_PAD_M = 0.15

# points_v2.rally_end_ev ends a card at min(last_bounce + TAIL_AFTER_BOUNCE,
# ...), so a card whose end was set by its last bounce sits at most 2.6s
# past it. Further than that and the end came from the crossing chain, the
# rally cap, or a bounce this detector never found — and the "ending" is
# then just the last bounce it happened to see.
#
# It matters more here than in the pipeline: placement's bounce test is
# stricter than points_v2's, so a backfilled point can be missing the
# bounce that actually ended the rally. The first row of the review page
# was a 16.5s rally with ONE bounce found, at 2.2s. 19% of points fail this
# and keep today's behaviour.
MAX_TAIL_AFTER_ENDING_S = 2.7


def on_table(candidate: dict) -> bool:
    u, v = candidate.get("u"), candidate.get("v")
    if not isinstance(u, (int, float)) or not isinstance(v, (int, float)):
        return False
    return (-EDGE_PAD_M <= u <= TABLE_W_M + EDGE_PAD_M
            and -EDGE_PAD_M <= v <= TABLE_L_M + EDGE_PAD_M)


def cut_position(segments, offsets, t: float) -> float:
    """Where source-time t lands in the cut. Mirrors points_pipeline."""
    for (s0, s1), off in zip(segments, offsets):
        if t < s0:
            return off
        if t <= s1:
            return off + (t - s0)
    if not segments:
        return 0.0
    return offsets[-1] + (segments[-1][1] - segments[-1][0])


def rally_end_for_point(placement, t0: float, t1: float) -> float | None:
    """Source seconds of the last moment the ball was PLAYED in this point.

    The last bounce on the table, or a bat touch after it when there is
    one. The touch matters and a constant buffer cannot stand in for it: a
    defensive player stands two metres back, so the ball spends over a
    second in the air between the bounce and their chop. A tail measured
    from the bounce cuts that flight in half.

    Measured on 1288 points: a touch follows the last table bounce on 33%
    of them, a median of 0.23s later but 1.73s at the 95th and 2.36s at
    the worst. Ending on the bounce plus 1.25s cut 57 of the 73 rallies
    whose touch lands a second or more out; ending on the touch instead
    cuts none of them, and saves MORE time overall, because the 67% with
    nothing after the bounce no longer have to carry a tail sized for the
    third that do.

    (points_v2 reaches the same place by a different road: rally_end_ev
    already returns max(last bounce, last crossing in the chain), and a
    crossing after the last bounce is the same ball still in play. This
    only has to catch up because placement stores contacts, not
    crossings.)

    Bounded by t0/t1 on purpose: clips overlap by design, so a candidate
    list can carry the tail of the previous rally and the server bouncing
    the ball before the next one. Neither is this rally's ending.
    """
    if not placement or placement.get("v") != 3:
        return None
    cands = [c for c in (placement.get("candidates") or [])
             if isinstance(c.get("t"), (int, float)) and t0 <= c["t"] <= t1]
    bounces = [c["t"] for c in cands if on_table(c)]
    if not bounces:
        return None
    last_bounce = float(max(bounces))
    touches = [c["t"] for c in cands
               if c.get("kind") == "contact" and c["t"] > last_bounce]
    return float(max(touches)) if touches else last_bounce


def backfill_match(conn, match_id: str, dry_run: bool = False) -> dict:
    from .worker import r2, R2_MEDIA_BUCKET

    cur = conn.cursor()
    cur.execute("select match_json_path from public.matches where id=%s",
                (match_id,))
    row = cur.fetchone()
    if row is None or not row[0]:
        return {"match": match_id, "skipped": "no match.json"}
    key = row[0].replace(f"r2://{R2_MEDIA_BUCKET}/", "")
    try:
        body = r2().get_object(Bucket=R2_MEDIA_BUCKET, Key=key)["Body"].read()
        mj = json.loads(body)
    except Exception as exc:                       # noqa: BLE001
        return {"match": match_id, "skipped": f"match.json unreadable: {exc}"}

    # The end-on assembler sets a card's end from a fixed pad, not from the
    # last bounce, so the guard below has no premise there: it tests that
    # the ending explains t1, and on this route nothing ever does. The
    # pipeline already excludes these matches by never producing an ending
    # for them (points_endon.build_cards has no end_evidence_s), and a
    # backfill that quietly reached them anyway would make that assurance
    # false. Detected from the route the pipeline recorded at the time.
    notes = " ".join(mj.get("notes") or [])
    if "route end-on" in notes:
        return {"match": match_id, "skipped": "end-on route"}

    segments = [tuple(s) for s in (mj.get("cut_segments") or [])]
    if not segments:
        # A spans-mode or pre-plays match: without the segment list there
        # is no way to put a source second on the cut clock, and a guess
        # here would stop playback in the wrong place.
        return {"match": match_id, "skipped": "no cut_segments"}
    offsets, acc = [], 0.0
    for s0, s1 in segments:
        offsets.append(acc)
        acc += s1 - s0

    cur.execute("""select id, idx, t0, t1, placement, rally_end_cut_s
                   from public.points
                   where match_id=%s and deleted is not true
                   order by idx""", (match_id,))
    rows = cur.fetchall()
    written = no_bounce = outside = already = unexplained = 0
    for pid, _idx, t0, t1, placement, existing in rows:
        if existing is not None:
            already += 1
            continue
        if t0 is None or t1 is None:
            no_bounce += 1
            continue
        end_s = rally_end_for_point(placement, float(t0), float(t1))
        if end_s is None:
            no_bounce += 1
            continue
        if float(t1) - end_s > MAX_TAIL_AFTER_ENDING_S:
            unexplained += 1
            continue
        cut_s = round(cut_position(segments, offsets, end_s), 2)
        # The clip runs from cut_t0; an ending the clip does not contain
        # cannot end it. Refusing is right — the column stays null and the
        # point keeps today's behaviour.
        cur.execute("select cut_t0 from public.points where id=%s", (pid,))
        cut_t0 = cur.fetchone()[0]
        if cut_t0 is None or cut_s < float(cut_t0):
            outside += 1
            continue
        if not dry_run:
            cur.execute("update public.points set rally_end_cut_s=%s where id=%s",
                        (cut_s, pid))
        written += 1
    return {"match": match_id, "points": len(rows), "written": written,
            "no_bounce": no_bounce, "outside_clip": outside,
            "unexplained": unexplained, "already_set": already}


def main(argv=None) -> None:
    from .worker import connect

    ap = argparse.ArgumentParser()
    ap.add_argument("--match", action="append", default=[],
                    help="match id; repeatable")
    ap.add_argument("--all-v2", action="store_true",
                    help="every ready match whose points carry v3 placement")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    conn = connect()
    ids = list(args.match)
    if args.all_v2:
        cur = conn.cursor()
        cur.execute("""
            select m.id::text
            from public.matches m
            where m.status = 'ready'
              and exists (select 1 from public.points p
                          where p.match_id = m.id
                            and p.deleted is not true
                            and p.placement->>'v' = '3')
              and exists (select 1 from public.points p
                          where p.match_id = m.id
                            and p.deleted is not true
                            and p.rally_end_cut_s is null)
            order by m.created_at desc
        """)
        ids += [r[0] for r in cur.fetchall()]
    if args.limit:
        ids = ids[:args.limit]
    if not ids:
        print("nothing to do")
        return

    totals = {"points": 0, "written": 0, "no_bounce": 0, "outside_clip": 0,
              "unexplained": 0}
    for mid in ids:
        res = backfill_match(conn, mid, dry_run=args.dry_run)
        if "skipped" in res:
            print(f"{mid[:8]}  skipped: {res['skipped']}")
            continue
        for k in totals:
            totals[k] += res.get(k, 0)
        print(f"{mid[:8]}  {res['written']:4d}/{res['points']:4d} written  "
              f"(no bounce {res['no_bounce']}, does not explain t1 "
              f"{res['unexplained']}, outside clip {res['outside_clip']}, "
              f"already set {res['already_set']})")
    print(f"\n{'DRY RUN, nothing written' if args.dry_run else 'written'}: "
          f"{totals['written']} of {totals['points']} points across "
          f"{len(ids)} match(es); {totals['no_bounce']} had no bounce on the "
          f"table, {totals['unexplained']} had one that does not explain "
          f"where the point ends, {totals['outside_clip']} landed outside "
          f"their clip")


if __name__ == "__main__":
    sys.exit(main())
