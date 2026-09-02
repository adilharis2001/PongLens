"""Final grading of the cut-short census, and the page to validate it.

Route matters: on an end-on match no card has a serve mark, so "next card
has no serve" is true of every pair and says nothing. The LIKELY grade is
serve-anchored only. A deletion only confirms a split on a serve-anchored
match too — on end-on matches Adil deleted junk cards by the dozen.
Tap-confirmed cases stand on every route.
"""
import html, json, os, subprocess
from collections import Counter
import psycopg2

W = "/tmp/serve-diag/census"
OUT = ("/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/"
       "dd63c93b-843c-4cc1-9306-421c75c875dd/scratchpad/cut-short-list.html")
report = json.load(open(f"{W}/report.json"))


def keychain(service):
    r = subprocess.run(["security", "find-generic-password", "-a", "openclaw", "-s", service, "-w"],
                       capture_output=True, text=True)
    return r.stdout.strip()


def mmss(t):
    return f"{int(t) // 60}:{int(t) % 60:02d}"


routes = {}
for mid in {r["match_id"] for r in report}:
    p = f"{W}/{mid}.serves.json"
    if os.path.exists(p):
        routes[mid] = (json.load(open(p)).get("meta") or {}).get("route") or "?"

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
# Labels that survive two untitled matches from one account on one day:
# owner / opponent (day, card count).
cur.execute("""
  select m.id::text, coalesce(u.raw_user_meta_data->>'full_name', u.email), m.opponent_name,
         to_char(m.created_at, 'DD Mon'), (select count(*) from points p where p.match_id = m.id)
  from matches m join auth.users u on u.id = m.user_id where m.created_at >= '2026-08-22'""")
labels = {}
for mid, owner, opp, day, n in cur.fetchall():
    labels[mid] = f"{(owner or '?').split()[0]} / {opp or 'untitled'} ({day}, {n} cards)"
conn.close()
for r in report:
    r["match"] = labels.get(r["match_id"], r["match"])

out = []
for mid, cards in pts.items():
    for idx, c in cards.items():
        if c["tap"] is not None and c["tap"] > c["t1"] + 1.5:
            out.append(dict(grade="confirmed", why=f"your winner tap lands {c['tap'] - c['t1']:.1f}s after the card ends",
                            match=labels.get(mid, mid[:8]), match_id=mid, point=idx, t1=c["t1"], route=routes.get(mid, "?")))
for r in report:
    if routes.get(r["match_id"]) != "serve-anchored":
        continue
    if not (r["s1"] and r["prev_idx"] is not None and r["next_idx"] is not None):
        continue
    cards = pts.get(r["match_id"], {})
    a, b = cards.get(r["prev_idx"]), cards.get(r["next_idx"])
    if a and b and a["scored"] and b["deleted"] and not b["scored"]:
        if not any(o["match_id"] == r["match_id"] and o["point"] == r["prev_idx"] for o in out):
            out.append(dict(grade="confirmed", why="you scored this card and deleted the fragment that followed",
                            match=r["match"], match_id=r["match_id"], point=r["prev_idx"], t1=r["prev_t1"],
                            route="serve-anchored", next_point=r["next_idx"]))
for r in report:
    if routes.get(r["match_id"]) != "serve-anchored":
        continue
    if not (r["s1"] and r["s2"] and r["dt_cross"] is not None and r["dt_cross"] <= 3.0 and r["prev_idx"] is not None):
        continue
    if any(o["match_id"] == r["match_id"] and o["point"] == r["prev_idx"] for o in out):
        continue
    cards = pts.get(r["match_id"], {})
    a, b = cards.get(r["prev_idx"]), cards.get(r["next_idx"])
    if a and b and a["tap"] is not None and a["tap"] <= r["prev_t1"] + 0.3 and b.get("tap"):
        continue                                   # his taps say two points
    out.append(dict(grade="likely", why=f"next card opens {r['gap']:.1f}s later with no serve, play resumes {r['dt_cross']:.1f}s after the cut",
                    match=r["match"], match_id=r["match_id"], point=r["prev_idx"], t1=r["prev_t1"],
                    route="serve-anchored", next_point=r["next_idx"]))
# the two lob cuts proven from the full-frame track (Anton reprocesses)
for mid, idx, t1, note in (("41a18e3d-0055-4910-acfe-a3b723e3ef50", 17, 214.83, "the lob you found: ball rose above the crop box for 1.1s; rally ran on into cards 18-19"),
                           ("ad634efd-751d-43cf-a5c4-02de2bb2986c", 65, 736.21, "ball peaks at the top of the frame; next card opens 1.0s later")):
    out = [o for o in out if not (o["match_id"] == mid and o["point"] == idx)]
    out.append(dict(grade="confirmed", why=note, match=labels.get(mid), match_id=mid, point=idx, t1=t1, route="serve-anchored"))

out.sort(key=lambda o: (o["match"], o["t1"]))
json.dump(out, open(f"{W}/validate_list.json", "w"), indent=1)
print("grades:", Counter(o["grade"] for o in out))
for m, n in sorted(Counter(o["match"] for o in out).items(), key=lambda kv: -kv[1]):
    conf = sum(1 for o in out if o["match"] == m and o["grade"] == "confirmed")
    print(f"  {m:40s} {n:3d}  (confirmed {conf})")
excluded = sorted({labels[m] for m, rt in routes.items() if rt != "serve-anchored"})
print("end-on (excluded from likely):", excluded)

rows = "".join(f'''<tr class="{o['grade']}"><td>{html.escape(o['match'])}</td><td class="num">{o['point']}</td>
<td class="num">{mmss(o['t1'])}</td><td><span class="tag {o['grade']}">{o['grade']}</span></td>
<td>{html.escape(o['why'])}{'' if not o.get('next_point') else f' &middot; continuation is card {o["next_point"]}'}</td></tr>''' for o in out)
n_c = sum(1 for o in out if o["grade"] == "confirmed")
doc = f'''<title>Points cut before they ended</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root {{ --ground:#f4f6f8; --surface:#fff; --ink:#10161d; --muted:#5d6b7a; --line:#d6dee6; --sure:#4d7a12; --sure-bg:#eef4dd; --maybe:#8a5a12; --maybe-bg:#f7ecd6; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --ground:#0d1520; --surface:#152234; --ink:#e6ecf2; --muted:#8b9bab; --line:#24374e; --sure:#c9d94a; --sure-bg:#2a3417; --maybe:#e8b45a; --maybe-bg:#3a2d14; }} }}
:root[data-theme="dark"] {{ --ground:#0d1520; --surface:#152234; --ink:#e6ecf2; --muted:#8b9bab; --line:#24374e; --sure:#c9d94a; --sure-bg:#2a3417; --maybe:#e8b45a; --maybe-bg:#3a2d14; }}
body {{ margin:0; background:var(--ground); color:var(--ink); font:15px/1.5 ui-sans-serif,-apple-system,system-ui,sans-serif; }}
.wrap {{ max-width:1080px; margin:0 auto; padding:0 20px 60px; }}
h1 {{ font-size:26px; letter-spacing:-.02em; margin:34px 0 8px; }}
p.lede {{ color:var(--muted); max-width:66ch; margin:0 0 22px; }}
.tablewrap {{ overflow-x:auto; border:1px solid var(--line); border-radius:10px; background:var(--surface); }}
table {{ border-collapse:collapse; width:100%; min-width:720px; font-variant-numeric:tabular-nums; }}
th,td {{ padding:8px 12px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top; }}
thead th {{ font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }}
td.num {{ text-align:right; white-space:nowrap; }}
.tag {{ font-size:10px; letter-spacing:.09em; text-transform:uppercase; padding:3px 8px; border-radius:999px; font-weight:700; }}
.tag.confirmed {{ background:var(--sure-bg); color:var(--sure); }} .tag.likely {{ background:var(--maybe-bg); color:var(--maybe); }}
</style>
<div class="wrap">
<h1>Points cut before they ended</h1>
<p class="lede">Every ready match uploaded since 22 August, all accounts. <b>Confirmed</b> means your own data already says the rally carried on: a winner tap well past the card's end, a card you scored followed by a fragment you deleted, or a lob proven from the full-frame ball track. <b>Likely</b> is a production-only signature that agreed with your taps about two times in three, so expect roughly one in three to be a genuine new point. Matches routed end-on are left out of the likely grade because the signature cannot work there. Point numbers are the ones you see in the app.</p>
<div class="tablewrap"><table><thead><tr><th>Match</th><th class="num">Point</th><th class="num">Card ends</th><th>Grade</th><th>Why it is here</th></tr></thead>
<tbody>{rows}</tbody></table></div>
<p class="lede" style="margin-top:14px">{len(out)} cards listed, {n_c} confirmed.</p>
</div>'''
open(OUT, "w").write(doc)
print("page:", OUT, f"{os.path.getsize(OUT) / 1e3:.0f} KB")
