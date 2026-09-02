"""Turn the census into a list Adil can validate.

Two grades:
  CONFIRMED   Adil's own data already says the rally carried on: a winner
              tap more than 1.5 s past the card's end, or a split pair
              where he scored the first card and DELETED the second (his
              verdict that the second was not a point of its own).
  LIKELY      the production-only signature that calibrated best against
              his taps (~65%): next card opens within 1.6 s, has no serve,
              and its first net crossing comes within 3 s of the cut.
"""
import json, os, subprocess, sys
import psycopg2

W = "/tmp/serve-diag/census"
report = json.load(open(f"{W}/report.json"))


def keychain(service):
    r = subprocess.run(["security", "find-generic-password", "-a", "openclaw", "-s", service, "-w"],
                       capture_output=True, text=True)
    return r.stdout.strip()


def mmss(t):
    return f"{int(t) // 60}:{int(t) % 60:02d}"


conn = psycopg2.connect(os.environ.get("DATABASE_URL") or keychain("ponglens-db-url"))
cur = conn.cursor()
cur.execute("""
  select p.match_id::text, p.idx, p.t0, p.t1, p.deleted,
         p.t0 - (m.clip_pads->>'pre')::numeric - p.cut_t0 + p.scored_at_cut_s as tap_src,
         p.confirmed_winner is not null as scored
  from points p join matches m on m.id = p.match_id
  where m.created_at >= '2026-08-22'""")
pts = {}
for mid, idx, t0, t1, deleted, tap, scored in cur.fetchall():
    pts.setdefault(mid, {})[idx] = dict(t0=float(t0), t1=float(t1), deleted=deleted,
                                        tap=float(tap) if tap is not None else None, scored=scored)
conn.close()

out = []
# CONFIRMED by a late tap
for mid, cards in pts.items():
    label = next((r["match"] for r in report if r["match_id"] == mid), mid[:8])
    for idx, c in cards.items():
        if c["tap"] is not None and c["tap"] > c["t1"] + 1.5:
            out.append(dict(grade="CONFIRMED", why=f"your winner tap is {c['tap'] - c['t1']:.1f}s after the card ends",
                            match=label, match_id=mid, point=idx, ends=mmss(c["t1"]), t1=c["t1"]))
# CONFIRMED by scored-then-deleted split
for r in report:
    if not r["s1"] or r["prev_idx"] is None or r["next_idx"] is None:
        continue
    cards = pts.get(r["match_id"], {})
    a, b = cards.get(r["prev_idx"]), cards.get(r["next_idx"])
    if a and b and a["scored"] and b["deleted"] and not b["scored"]:
        out.append(dict(grade="CONFIRMED", why="you scored this card and deleted the fragment that followed it",
                        match=r["match"], match_id=r["match_id"], point=r["prev_idx"], ends=mmss(r["prev_t1"]),
                        t1=r["prev_t1"], next_point=r["next_idx"]))
# LIKELY by signature
for r in report:
    if r["s1"] and r["s2"] and r["dt_cross"] is not None and r["dt_cross"] <= 3.0 and r["prev_idx"] is not None:
        if any(o["match_id"] == r["match_id"] and o["point"] == r["prev_idx"] for o in out):
            continue
        cards = pts.get(r["match_id"], {})
        a = cards.get(r["prev_idx"])
        if a and a["tap"] is not None and a["tap"] <= r["prev_t1"] + 0.3 and cards.get(r["next_idx"], {}).get("tap"):
            continue        # his taps say two points: drop it
        out.append(dict(grade="LIKELY", why=f"next card opens {r['gap']:.1f}s later with no serve; play resumes {r['dt_cross']:.1f}s after the cut",
                        match=r["match"], match_id=r["match_id"], point=r["prev_idx"], ends=mmss(r["prev_t1"]),
                        t1=r["prev_t1"], next_point=r["next_idx"]))

out.sort(key=lambda o: (o["match"], o["t1"]))
json.dump(out, open(f"{W}/validate_list.json", "w"), indent=1)
from collections import Counter
print("grades:", Counter(o["grade"] for o in out))
print("per match:")
for m, n in sorted(Counter(o["match"] for o in out).items(), key=lambda kv: -kv[1]):
    conf = sum(1 for o in out if o["match"] == m and o["grade"] == "CONFIRMED")
    print(f"  {m:40s} {n:3d}  (confirmed {conf})")
print("\nGabriel's match:")
for o in out:
    if o["match"].startswith("Gabriel"):
        print(f"  point {o['point']:3d} ends {o['ends']}  {o['grade']}  {o['why']}")
