"""Write inventory.json: every live hand cut, its files and its points.

Read-only: the session is set read only before the query runs. The query is
the one used for the 2026-09-25 measurements (run then through the Supabase
MCP); this wrapper only saves its answer.

    worker/venv/bin/python -B inventory.py /private/tmp/claude-501/hc-drift/inventory.json
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

QUERY = """
select coalesce(json_agg(json_build_object(
  'match', m.id, 'user', m.user_id, 'cut_path', m.cut_path,
  'raw_path', m.raw_path, 'match_json_path', m.match_json_path,
  'duration_s', m.duration_s,
  'processing_version_id', m.active_processing_version_id,
  'points', (select json_agg(json_build_object(
      'id', p.id, 'idx', p.idx, 't0', p.t0, 't1', p.t1,
      'cut_t0', p.cut_t0, 'clip_path', p.clip_path) order by p.idx)
    from public.points p
    where p.match_id = m.id and not p.deleted
      and p.processing_version_id = m.active_processing_version_id))
  order by m.created_at), '[]'::json)
from public.matches m
where m.cut_source = 'manual' and m.status = 'ready'
"""


def main(out: str) -> None:
    import psycopg2
    url = os.environ.get("DATABASE_URL") or subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw", "-s",
         "ponglens-db-url", "-w"], text=True).strip()
    conn = psycopg2.connect(url)
    try:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute(QUERY)
            rows = cur.fetchone()[0]
    finally:
        conn.close()
    with open(out, "w") as fh:
        json.dump(rows, fh, indent=1, default=str)
    print(f"wrote {out}: {len(rows)} hand cuts, "
          f"{sum(len(r['points'] or []) for r in rows)} points")


if __name__ == "__main__":
    main(sys.argv[1])
