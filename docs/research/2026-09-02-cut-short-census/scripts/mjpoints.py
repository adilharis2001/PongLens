import json, glob, os, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import points_v2 as V2
rows = [r for r in json.load(open("/tmp/serve-diag/census/verdicts_joined.json")) if r["verdict"] == "real"]
sj = {os.path.basename(p).split(".")[0]: json.load(open(p)) for p in glob.glob("/tmp/serve-diag/census/*.serves.json")}
print(f"{'match':32s} {'pt':>4s} {'t0':>8s} {'t1':>8s} {'dur':>5s} {'serve':>8s} {'rallyEnd':>9s} {'t1-rE':>6s} || {'next t0':>8s} {'gap':>5s} {'nSrv':>8s} {'nRE':>9s} {'span':>5s}")
for r in sorted(rows, key=lambda r: (r["match"], r["point"])):
    mid = r["match_id"]
    P = sorted(json.load(open(f"mj/{mid}.json"))["points"], key=lambda p: p["t0"])
    me = min(P, key=lambda p: abs(p["t0"] - r["db"]["me"]["t0"]))
    i = P.index(me); nx = P[i+1] if i+1 < len(P) else {}
    f = lambda v: "-" if v is None else f"{v:8.2f}"
    gap = (nx["t0"] - me["t1"]) if nx else None
    span = (nx["t1"] - me["t0"]) if nx else None
    tre = (me["t1"] - me["rally_end_s"]) if me.get("rally_end_s") is not None else None
    print(f"{r['match'][:32]:32s} {r['point']:4d} {me['t0']:8.2f} {me['t1']:8.2f} {me['t1']-me['t0']:5.1f} {f(me.get('serve_s')):>8s} "
          f"{f(me.get('rally_end_s')):>9s} {('-' if tre is None else f'{tre:6.2f}'):>6s} || {f(nx.get('t0')) if nx else '-':>8s} "
          f"{('-' if gap is None else f'{gap:5.2f}'):>5s} {f(nx.get('serve_s')) if nx else '-':>8s} {f(nx.get('rally_end_s')) if nx else '-':>9s} "
          f"{('-' if span is None else f'{span:5.1f}'):>5s}")
