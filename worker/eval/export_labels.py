#!/usr/bin/env python3
"""Export human-labeled ground truth for a match into a labels JSON.

The owner curates a match in the UI by deleting every false-positive point
(deleted=true) and keeping/fixing the real ones — that curation IS the label
set for the dead-space/point-splitting eval loop (see score_split.py).

READ-ONLY against prod. Usage:

  worker/venv/bin/python worker/eval/export_labels.py <match_id> > labels.json

Reads the DB URL from the 'ponglens-db-url' Keychain item (account
'openclaw') or $DATABASE_URL. Output shape:

  {"match_id": ..., "points": [{"idx", "t0", "t1", "deleted", "is_let"}]}
"""
import json
import os
import subprocess
import sys


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    match_id = sys.argv[1]
    db = os.environ.get("DATABASE_URL")
    if not db:
        db = subprocess.check_output(
            ["security", "find-generic-password", "-a", "openclaw",
             "-s", "ponglens-db-url", "-w"]).decode().strip()
    import psycopg2
    conn = psycopg2.connect(db)
    with conn.cursor() as cur:
        cur.execute(
            "select idx, t0, t1, deleted, is_let from public.points "
            "where match_id = %s order by idx", (match_id,))
        pts = [{"idx": i, "t0": float(t0), "t1": float(t1),
                "deleted": bool(d), "is_let": bool(l)}
               for i, t0, t1, d, l in cur.fetchall()]
    conn.close()
    json.dump({"match_id": match_id, "points": pts}, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
