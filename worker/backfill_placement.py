#!/usr/bin/env python3
"""Ask for placement on the matches that never had it, one at a time.

    ./venv/bin/python backfill_placement.py [--limit N] [--dry-run]

The admin portal's three winner rules read the touches the placement
reconstruction stores — which bounce, which racket contact, in what order,
where on the table. Thirty-one matches since 20 August have
`placement_status = 'not_requested'`, so there are no touches on them and
the rules stay silent no matter how good the ball track is. This requests
the reconstruction for each.

ONE AT A TIME, AND ONLY INTO AN EMPTY QUEUE. There is a single pgmq queue
and the worker takes it in order, so enqueueing thirty-one jobs at once
would put a real upload behind ten hours of backfill. Instead this waits
until nothing else is queued or processing, adds one job, and waits for it
to finish before considering the next — so a player who uploads tonight
waits for at most the job already in flight.

Writes the same rows `request_placement_generation` (055) writes, with the
same guards, as the match's own owner. It cannot call that function
directly because it is auth.uid()-scoped to the owner, and most of these
matches are not ours.

What this changes for the owner: their match gains a placement map. No
notification is sent either way — `jobs_notify_failed` fires only for
deadspace_cut and youtube_import, and the success path deliberately sends
nothing.

Resumable. Eligibility is re-read every round and a match stops being
eligible the moment its job is queued, so a restart never doubles up.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import psycopg2  # noqa: E402
from research_reprocess import config  # noqa: E402

POLL_S = 30
# Long enough for a download, blurball and the reconstruction on a big
# match; past it, something is wrong and waiting longer helps nobody.
JOB_TIMEOUT_S = 90 * 60
# How long to keep waiting for someone else's job to clear before giving up
# for this round.
QUEUE_WAIT_S = 60 * 60

ELIGIBLE = """
  select m.id, m.user_id, coalesce(m.opponent_name, '-'), m.created_at::date,
         (select count(*) from public.points p
           where p.match_id = m.id and not p.deleted) as pts
    from public.matches m
   where m.status = 'ready'
     and m.placement_status = 'not_requested'
     and m.placement_generation_job_id is null
     and m.placement_retry_count = 0
     and m.placement_retry_expires_at > now()
     and exists (select 1 from public.points p
                  where p.match_id = m.id and not p.deleted)
     and not exists (select 1 from public.points p
                      where p.match_id = m.id and not p.deleted
                        and p.placement is not null)
   order by m.created_at desc
"""


def busy(conn):
    """Anything queued or processing, ours or a real upload's."""
    with conn.cursor() as cur:
        cur.execute("select count(*) from public.jobs "
                    "where status in ('queued', 'processing')")
        return cur.fetchone()[0]


def request(conn, match_id, user_id):
    """Exactly what request_placement_generation does, for another owner."""
    with conn.cursor() as cur:
        cur.execute(
            "insert into public.jobs (user_id, kind, status, input_path, "
            "original_name, options) values (%s, 'placement_generate', "
            "'queued', null, 'Placement generation', %s) returning id",
            (user_id, json.dumps({"match_id": str(match_id)})))
        job_id = cur.fetchone()[0]
        cur.execute(
            "update public.matches set placement_status = 'processing', "
            "placement_generation_job_id = %s, placement_failure_code = null "
            "where id = %s", (job_id, match_id))
    conn.commit()
    return job_id


def wait_for(conn, job_id):
    """Poll one job to a terminal state. Returns (status, mapped points)."""
    started = time.time()
    while time.time() - started < JOB_TIMEOUT_S:
        time.sleep(POLL_S)
        conn.rollback()          # a new snapshot, not the one we opened with
        with conn.cursor() as cur:
            cur.execute("select status, error from public.jobs where id = %s",
                        (job_id,))
            status, error = cur.fetchone()
        if status in ("done", "failed"):
            return status, error
    return "timeout", None


def mapped(conn, match_id):
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute("select count(*) from public.points "
                    "where match_id = %s and not deleted "
                    "and placement is not null", (match_id,))
        return cur.fetchone()[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    env = config()
    with psycopg2.connect(env["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute(ELIGIBLE)
            todo = cur.fetchall()
        if args.limit:
            todo = todo[:args.limit]
        print(f"{len(todo)} matches eligible for placement generation, "
              f"{sum(r[4] for r in todo)} points\n", flush=True)
        for mid, uid, opp, when, pts in todo:
            print(f"  {str(mid)[:8]}  {str(when)}  {opp[:20]:20s} {pts:4d} pts",
                  flush=True)
        if args.dry_run:
            print("\ndry run — nothing enqueued")
            return 0
        print(flush=True)

        done = failed = 0
        for i, (mid, uid, opp, when, pts) in enumerate(todo, 1):
            # Yield to anything real that arrived while we were working.
            waited = 0
            while busy(conn) and waited < QUEUE_WAIT_S:
                conn.rollback()
                time.sleep(POLL_S)
                waited += POLL_S
            if busy(conn):
                print(f"[{i}/{len(todo)}] queue still busy after "
                      f"{waited // 60} min — stopping, run again later",
                      flush=True)
                break

            # Re-check eligibility: the owner may have asked for it
            # themselves while this was working through the list.
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute(ELIGIBLE + " ")
                if str(mid) not in {str(r[0]) for r in cur.fetchall()}:
                    print(f"[{i}/{len(todo)}] {str(mid)[:8]}  no longer "
                          f"eligible, skipped", flush=True)
                    continue

            started = time.time()
            job_id = request(conn, mid, uid)
            print(f"[{i}/{len(todo)}] {str(mid)[:8]}  {opp[:18]:18s} "
                  f"queued {str(job_id)[:8]}…", flush=True)
            status, error = wait_for(conn, job_id)
            got = mapped(conn, mid)
            mins = (time.time() - started) / 60
            if status == "done":
                done += 1
                print(f"    done in {mins:.0f} min — {got} of {pts} points "
                      f"mapped", flush=True)
            else:
                failed += 1
                print(f"    {status} after {mins:.0f} min"
                      + (f" — {str(error)[:120]}" if error else ""), flush=True)

    print(f"\n{done} generated, {failed} failed or timed out")
    return 0


if __name__ == "__main__":
    sys.exit(main())
