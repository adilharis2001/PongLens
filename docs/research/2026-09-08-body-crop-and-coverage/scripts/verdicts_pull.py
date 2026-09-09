"""Pull Adil's row calls (research_row_verdicts) into the lab as JSON.
Run under the worker venv (db.py needs psycopg2 + the worker's DATABASE_URL):
  /Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python verdicts_pull.py [page]
Writes fullframe/verdicts_<page>.json: {"<short id>": {"<row_s>": {"verdict":..,"note":..}}}"""
import sys, json, os
sys.path.insert(0, os.path.expanduser("~/Library/Caches/PongLens/serve-study"))
import db
page = sys.argv[1] if len(sys.argv) > 1 else "body-detector"
rows = db.q("select match_id::text, row_s::float, verdict, note from public.research_row_verdicts where page = %s", (page,))
out = {}
for r in rows:
    out.setdefault(r["match_id"][:8], {})[f"{r['row_s']:.1f}"] = {"verdict": r["verdict"], "note": r["note"]}
here = os.path.dirname(os.path.abspath(__file__))
json.dump(out, open(f"{here}/verdicts_{page}.json", "w"), indent=1)
print(f"{page}: {len(rows)} calls on {len(out)} matches -> verdicts_{page}.json")
