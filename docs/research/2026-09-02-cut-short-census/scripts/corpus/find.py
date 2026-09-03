"""Every match that can judge this rule: scored by its owner, cut by v2.

A winner tap is the only independent statement of where a point ended, so
a match with no taps cannot say whether a split was right.
"""
import json, subprocess
import psycopg2

def kc(s):
    return subprocess.run(["security", "find-generic-password", "-a", "openclaw", "-s", s, "-w"],
                          capture_output=True, text=True).stdout.strip()

conn = psycopg2.connect(kc("ponglens-db-url")); cur = conn.cursor()
cur.execute("""
  select m.id::text,
         coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1)) as owner,
         coalesce(m.opponent_name,'untitled') as opp,
         m.created_at::date::text,
         m.match_json_path,
         count(p.id) as cards,
         count(p.scored_at_cut_s) as taps,
         count(*) filter (where p.confirmed_winner is not null) as scored,
         count(*) filter (where p.deleted) as deleted,
         count(*) filter (where p.tight_start or p.tight_end) as handedited
  from matches m
  join auth.users u on u.id = m.user_id
  left join points p on p.match_id = m.id
  where m.status = 'ready' and m.match_json_path is not null
  group by 1,2,3,4,5
  having count(p.scored_at_cut_s) >= 15
  order by count(p.scored_at_cut_s) desc""")
rows = cur.fetchall()
conn.close()
out = [dict(mid=r[0], owner=r[1], opp=r[2], created=r[3], mjp=r[4], cards=r[5],
            taps=r[6], scored=r[7], deleted=r[8], hand=r[9]) for r in rows]
json.dump(out, open("candidates.json", "w"), indent=1)
print(f"{len(out)} matches with at least 15 winner taps\n")
print(f"{'owner':12s} {'opponent':26s} {'date':11s} {'cards':>5s} {'taps':>5s} {'scored':>6s} {'edited':>6s}")
for r in out:
    print(f"{r['owner'][:12]:12s} {r['opp'][:26]:26s} {r['created']:11s} {r['cards']:5d} {r['taps']:5d} {r['scored']:6d} {r['hand']:6d}")
print("\nby owner:", {o: sum(1 for r in out if r["owner"] == o) for o in sorted({r["owner"] for r in out})})
