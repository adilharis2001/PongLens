"""Split the ambiguous class in two.

One tap across a split pair can mean two different things. If the tap is in
the SECOND card, the first holds the opening of a rally that has no winner —
a point genuinely cut in half. If the tap is in the FIRST card, the second is
a leftover, and if Adil then deleted it, it was junk and the split cost
nothing. Which side the tap fell on separates the two.
"""
import json, subprocess, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import psycopg2

def kc(s):
    return subprocess.run(["security", "find-generic-password", "-a", "openclaw", "-s", s, "-w"],
                          capture_output=True, text=True).stdout.strip()

splits = json.load(open("splits.json"))
taps_all = json.load(open("taps.json"))
mids = sorted({s["mid"] for s in splits})
conn = psycopg2.connect(kc("ponglens-db-url")); cur = conn.cursor()
cur.execute("""select match_id::text, t0, t1, deleted, confirmed_winner is not null, is_let,
                      tight_start, tight_end
               from points where match_id = any(%s::uuid[]) order by match_id, t0""", (mids,))
rowsdb = {}
for mid, t0, t1, d, sc, let, ts, te in cur.fetchall():
    rowsdb.setdefault(mid, []).append(dict(t0=float(t0), t1=float(t1), deleted=d, scored=sc,
                                           let=let, tight_start=ts, tight_end=te))
conn.close()

def row_for(mid, t0):
    L = rowsdb.get(mid, [])
    if not L:
        return None
    r = min(L, key=lambda r: abs(r["t0"] - t0))
    return r if abs(r["t0"] - t0) < 0.6 else None

for s in splits:
    taps = taps_all.get(s["mid"], [])
    ta = [t for t in taps if s["a0"] <= t <= s["a1"] + 0.5]
    tb = [t for t in taps if s["b0"] <= t <= s["b1"] + 0.5]
    ra, rb = row_for(s["mid"], s["a0"]), row_for(s["mid"], s["b0"])
    s["a_deleted"] = ra["deleted"] if ra else None
    s["b_deleted"] = rb["deleted"] if rb else None
    s["a_scored"] = ra["scored"] if ra else None
    s["b_scored"] = rb["scored"] if rb else None
    if ta and tb:
        s["klass"] = "both halves scored: the split was right"
    elif tb and not ta:
        s["klass"] = "only the SECOND half scored: the first holds a rally with no winner"
    elif ta and not tb:
        s["klass"] = ("only the first half scored, second deleted: the second was junk"
                      if s["b_deleted"] else "only the FIRST half scored, second kept but unscored")
    else:
        s["klass"] = "neither half scored"
json.dump(splits, open("splits.json", "w"), indent=1)

from collections import Counter
print("The 97 cap splits, by what Adil's scoring says about them\n")
for k, n in Counter(s["klass"] for s in splits).most_common():
    print(f"  {n:3d}  {k}")
have = [s for s in splits if s.get("ev_gap") is not None]
print(f"\n{len(have)} of them carry per-card evidence. Gap in play at the cut, by class:")
for k in sorted({s["klass"] for s in have}):
    v = sorted(s["ev_gap"] for s in have if s["klass"] == k)
    if len(v) < 3:
        print(f"  {k[:58]:58s} n={len(v)}  {[round(x,1) for x in v]}")
        continue
    print(f"  {k[:58]:58s} n={len(v):3d}  p10 {v[len(v)//10]:4.1f}s  median {v[len(v)//2]:4.1f}s  p90 {v[9*len(v)//10]:5.1f}s")
