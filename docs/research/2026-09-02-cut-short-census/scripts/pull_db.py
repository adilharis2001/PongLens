import json, subprocess, psycopg2
def keychain(s):
    return subprocess.run(["security","find-generic-password","-a","openclaw","-s",s,"-w"],capture_output=True,text=True).stdout.strip()
conn = psycopg2.connect(keychain("ponglens-db-url")); cur = conn.cursor()
rows = json.load(open("/tmp/serve-diag/census/verdicts_joined.json"))
mids = sorted({r["match_id"] for r in rows})
cur.execute("""select p.match_id::text, p.idx, p.t0, p.t1, p.cut_t0, p.rally_end_cut_s, p.scored_at_cut_s, p.confirmed_winner is not null, p.deleted, p.tight_end, p.tight_start,
                      (m.clip_pads->>'pre')::float, (m.clip_pads->>'post')::float
               from points p join matches m on m.id = p.match_id where p.match_id = any(%s::uuid[]) order by p.match_id, p.t0""", (mids,))
pts = {}
for mid, idx, t0, t1, cut_t0, re_cut, tap_cut, scored, deleted, te, ts, pre, post in cur.fetchall():
    pts.setdefault(mid, []).append(dict(idx=idx, t0=float(t0), t1=float(t1), cut_t0=float(cut_t0) if cut_t0 is not None else None,
        re_cut=float(re_cut) if re_cut is not None else None, tap_cut=float(tap_cut) if tap_cut is not None else None,
        scored=scored, deleted=deleted, tight_end=te, tight_start=ts, pre=pre or 0.3, post=post or 0.4))
conn.close()
json.dump(pts, open("/tmp/serve-diag/census/db_points.json", "w"))
f = lambda v, w=6: (f"{v:{w}.1f}" if isinstance(v, (int, float)) else f"{'-':>{w}s}")
print(f"{'v':5s} {'match':22s} {'pt':>3s} {'dur':>5s} {'rallyEnd-t1':>11s} {'tap-t1':>7s} {'scored':>6s} {'nx.gap':>6s} {'nx.dur':>6s} {'nx.scored':>9s} {'nx.deleted':>10s}")
for r in sorted(rows, key=lambda r: (r["verdict"] != "real", r["match"], r["t1"])):
    L = pts[r["match_id"]]
    me = next((k for k in L if k["idx"] == r["point"]), None)
    if not me: print(r["verdict"], r["match"], r["point"], "NO DB ROW"); continue
    nxt = next((k for k in L if k["t0"] > me["t0"] and not k["deleted"]), None)
    def src_of_cut(k, cut):
        return None if cut is None or k["cut_t0"] is None else cut - k["cut_t0"] - k["pre"] + k["t0"]
    re_src = src_of_cut(me, me["re_cut"]); tap_src = src_of_cut(me, me["tap_cut"])
    print(f"{r['verdict']:5s} {r['match'][:22]:22s} {r['point']:3d} {f(me['t1']-me['t0'],5)} {f(re_src - me['t1'] if re_src is not None else None, 11)} {f(tap_src - me['t1'] if tap_src is not None else None, 7)} {str(me['scored']):>6s} {f(nxt['t0']-me['t1'] if nxt else None)} {f(nxt['t1']-nxt['t0'] if nxt else None)} {str(nxt['scored'] if nxt else '-'):>9s} {str(nxt['deleted'] if nxt else '-'):>10s}")
    r["db"] = dict(me=me, nxt=nxt, re_src=re_src, tap_src=tap_src)
json.dump(rows, open("/tmp/serve-diag/census/verdicts_joined.json", "w"), indent=1)
