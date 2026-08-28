#!/usr/bin/env python3
"""Download raw source video + match.json for the break-footage study.

The changeover detector has only ever read the per-point clips. The
break between two rallies — which is where a changeover physically
happens — is in the source file and nowhere else, so this study needs
the raws. They are swept at 30 days, so this is also a snapshot: 23 of
the 38 judged matches still had one on 2026-08-28.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# worker/worker.py is a MODULE named `worker`, and a real module beats a
# namespace package wherever it is found. Running a script that lives in
# worker/ puts that directory on sys.path, so `worker.eval_side_changes`
# resolves against worker.py and fails. Drop our own directory first.
HERE = Path(__file__).resolve().parent
sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != HERE]
sys.path.insert(0, str(HERE.parent))

import psycopg2
import psycopg2.extras

from worker.eval_side_changes import keychain, parse_r2, r2_client
from worker.judged_boundaries import judgements

WORKDIR = Path.home() / "ponglens-research-work" / "break-study"


def main() -> None:
    want = sorted({k.split("@")[0] for k in judgements()})
    conn = psycopg2.connect(keychain("ponglens-db-url"))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        select m.id, left(m.id::text, 8) as short, m.match_json_path,
               j.input_path, m.original_name
        from public.matches m
        left join public.jobs j on j.id = m.job_id
        where left(m.id::text, 8) = any(%s)
        order by m.created_at
        """,
        (want,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.commit()

    client = r2_client()
    kept = 0
    for row in rows:
        folder = WORKDIR / row["id"]
        folder.mkdir(parents=True, exist_ok=True)
        src = row["input_path"]
        if not src or not src.startswith("r2://"):
            print(f"{row['short']} no input_path", flush=True)
            continue
        bucket, key = parse_r2(src)
        suffix = Path(key).suffix or ".mp4"
        raw = folder / f"source{suffix}"
        try:
            head = client.head_object(Bucket=bucket, Key=key)
        except Exception:
            print(f"{row['short']} raw gone", flush=True)
            continue
        if not raw.exists() or raw.stat().st_size != head["ContentLength"]:
            client.download_file(bucket, key, str(raw))
        mbucket, mkey = parse_r2(row["match_json_path"])
        mj = folder / "match.json"
        if not mj.exists():
            client.download_file(mbucket, mkey, str(mj))
        kept += 1
        print(f"{row['short']} ok  {head['ContentLength']/1e6:>7.1f}MB  "
              f"{raw.name}", flush=True)
    print(f"\n{kept} matches ready in {WORKDIR}", flush=True)


if __name__ == "__main__":
    main()
