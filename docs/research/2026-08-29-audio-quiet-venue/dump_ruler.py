"""Everything the audio experiments need to be judged against, read-only.

  ./venv/bin/python dump_ruler.py <out-dir> <match-id> [match-id ...]

Per match one JSON holding:

  * `events` — every placement candidate the shipped pipeline found, with
    its source time, its pixel position, its table coordinates when it has
    them, and the near/far side the pipeline assigned. This is the ground
    truth for anything asking "could the sound have told us where the ball
    was", because the coordinates come from vision and the time is on the
    same clock as the audio.
  * `points` — the card windows, plus Adil's own serve and winner taps
    converted from the cut clock onto the source clock via cut_t0.
  * `boundaries` — the point_boundaries rows where they exist: his taps
    already converted, which is the only unbiased statement of when a
    rally was actually happening.

Nothing is written back to the database.
"""
import json, os, subprocess, sys
import psycopg2, psycopg2.extras

def kc(s):
    return subprocess.check_output(["security","find-generic-password","-a","openclaw","-s",s,"-w"]).decode().strip()

def main():
    out = sys.argv[1]; ids = sys.argv[2:]
    os.makedirs(out, exist_ok=True)
    conn = psycopg2.connect(os.environ.get("DATABASE_URL") or kc("ponglens-db-url"))
    conn.set_session(readonly=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    for mid in ids:
        cur.execute("""select m.id, m.venue, m.opponent_name, m.created_at::date d,
                              m.user_side, m.first_server, m.duration_s,
                              m.player_near_name, m.player_far_name,
                              coalesce((m.clip_pads->>'pre')::numeric, 1.2) pre_pad
                       from public.matches m where m.id=%s""", (mid,))
        m = cur.fetchone()
        if m is None:
            print(f"{mid}: missing"); continue
        cur.execute("""select id, idx, t0, t1, cut_t0, deleted, warmup, is_let,
                              confirmed_winner, server, server_override,
                              serve_start_at_cut_s, scored_at_cut_s, rally_end_cut_s,
                              tight_start, tight_end, placement
                       from public.points where match_id=%s order by idx""", (mid,))
        rows = cur.fetchall()
        cur.execute("""select point_id, idx, start_source_s, end_source_s,
                              start_cut_s, end_cut_s, length_s, usable, deleted
                       from public.point_boundaries where match_id=%s order by idx""", (mid,))
        bounds = [dict(b) for b in cur.fetchall()]

        events, points = [], []
        for r in rows:
            p = r["placement"] or {}
            cands = p.get("candidates") or [] if str(p.get("v")) == "3" else []
            for c in cands:
                events.append({
                    "point_id": str(r["id"]), "idx": r["idx"],
                    "t": c.get("t"), "kind": c.get("kind"), "side": c.get("side"),
                    "u": c.get("u"), "v": c.get("v"),
                    "x": c.get("x"), "y": c.get("y"),
                    "vis": c.get("visual_confidence"),
                    "kinds": c.get("kinds"),
                    "band": c.get("projection_safety_band"),
                })
            ct0 = r["cut_t0"]
            # Exactly the point_boundaries view's arithmetic. The pre-pad
            # matters: a card starts that many seconds BEFORE t0, so a cut
            # time converts through t0 - pre - cut_t0, and leaving the pad
            # out shifts every tap by 1.2 s — which is larger than the
            # thing most of these experiments are trying to measure.
            pre = float(m["pre_pad"])
            def to_source(cut_s):
                if cut_s is None or ct0 is None or r["t0"] is None: return None
                return float(r["t0"]) - pre - float(ct0) + float(cut_s)
            points.append({
                "id": str(r["id"]), "idx": r["idx"],
                "t0": r["t0"], "t1": r["t1"], "cut_t0": ct0,
                "deleted": r["deleted"], "warmup": r["warmup"], "is_let": r["is_let"],
                "winner": r["confirmed_winner"],
                "server": r["server"], "server_override": r["server_override"],
                "serve_src": to_source(r["serve_start_at_cut_s"]),
                "scored_src": to_source(r["scored_at_cut_s"]),
                "rally_end_src": to_source(r["rally_end_cut_s"]),
                "tight_start": r["tight_start"], "tight_end": r["tight_end"],
                "placement_status": (r["placement"] or {}).get("status"),
                "v3": str((r["placement"] or {}).get("v")) == "3",
            })
        doc = {"match": {k: (str(v) if k in ("id","d") else v) for k, v in m.items()},
               "points": points, "events": events, "boundaries": bounds}
        path = os.path.join(out, f"{mid[:8]}.json")
        json.dump(doc, open(path,"w"), default=str)
        with_uv = sum(1 for e in events if e["u"] is not None)
        print(f"{mid[:8]} {str(m['venue'])[:16]:16s} {str(m['opponent_name'])[:12]:12s} "
              f"{len(points):3d} points  {len(events):5d} events ({with_uv} on the table)  "
              f"{len(bounds):3d} boundaries  "
              f"{sum(1 for p in points if p['serve_src'] is not None):3d} serve taps")

if __name__ == "__main__":
    main()
