"""Pull the seven-match ruler corpus out of Postgres, read-only.

  ./venv/bin/python ../docs/research/.../dump_corpus.py <out-dir>

The corpus is CLAUDE.md's vouched list narrowed to the matches that carry
v3 placement AND a table Adil has looked at. Seven matches, 527 scored
points, which is the arithmetic that identifies them: no other combination
of the vouched list sums to it.

Writes <out-dir>/<slug>.json per match: the match row and every point row,
which is all diagnoseServePlacement needs. Nothing is written back.
"""
import json
import os
import subprocess
import sys

import psycopg2
import psycopg2.extras

# id -> label. The pairs (Chris 22 vs 25 Aug, Julian 23 vs 25 Aug) are the
# same match uploaded twice; these are the copies the placement research
# record already refers to.
CORPUS = [
    ("77fc4dee-3de6-47d6-a2df-df85e239535c", "lester"),
    ("cebaa6d4-81e4-4aab-b4fa-1ed485685d00", "rowel"),
    ("9e15ed10-f595-4efc-85c8-74cce08eb9c5", "prabhas"),
    ("d59d7610-d087-42ec-a1a6-b532fb4cac96", "ishan"),
    ("a52a6612-7c4d-489e-b5c1-50c437cad931", "ali"),
    ("ec6490f4-b835-4d82-882a-8fb2f1abc2e5", "chris"),
    ("7e02fbb9-a3af-4686-84bc-d4b961ab9fed", "julian"),
]


def keychain(service):
    return subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", service, "-w"]).decode().strip()


def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    url = os.environ.get("DATABASE_URL") or keychain("ponglens-db-url")
    conn = psycopg2.connect(url)
    conn.set_session(readonly=True)
    manifest = []
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        for match_id, slug in CORPUS:
            cur.execute("select m.*, j.input_path from public.matches m "
                        "left join public.jobs j on j.id = m.job_id "
                        "where m.id = %s", (match_id,))
            match = cur.fetchone()
            if match is None:
                raise SystemExit(f"{slug}: no such match {match_id}")
            cur.execute("select * from public.points where match_id = %s "
                        "order by idx", (match_id,))
            points = cur.fetchall()
            path = os.path.join(out_dir, f"{slug}.json")
            with open(path, "w") as handle:
                json.dump({"match": match, "points": points}, handle,
                          default=str)
            scored = sum(1 for p in points
                         if not p["deleted"] and p["confirmed_winner"])
            manifest.append({"slug": slug, "id": match_id,
                             "opponent": match["opponent_name"],
                             "venue": match["venue"],
                             "user_side": match["user_side"],
                             "first_server": match["first_server"],
                             "input_path": match["input_path"],
                             "raw_path": match["raw_path"],
                             "points": len(points), "scored": scored})
            print(f"{slug:9s} {match['opponent_name']:9s} "
                  f"{len(points):4d} points, {scored:4d} scored")
    with open(os.path.join(out_dir, "manifest.json"), "w") as handle:
        json.dump(manifest, handle, indent=2)
    print(f"\n{sum(m['scored'] for m in manifest)} scored points total")


if __name__ == "__main__":
    main()
