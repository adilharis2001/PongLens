"""How many of the flagged failures already have a serve stamp that could fix them.
Body page rows (bodyfix payloads) + the V3 overlay's serve stamps (serves[i][1] = serve moment)."""
import json, glob, math
names={"10322849":"Rob","1c08539e":"Tim","2eab3e3d":"Terry 2","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","77fc4dee":"Lester","7e02fbb9":"Julian","89b35ee0":"Yu Yu Lin","95a07786":"Wayne Wei","bfc9b31b":"Anton","cebaa6d4":"Rowel","d15aad4d":"Louis","f3237587":"Koko 2"}
def key(t): return f"{math.floor(t*10+0.5)/10:.1f}"
V=json.load(open("fullframe/verdicts_body-detector.json"))
tot=dict(missed=0, missed_serve=0, missed_wrong=0, missed_wrong_serve=0, fused=0, fused_2serves=0, fused_gap=[], late=0, late_serve_before=0, junkw=0, junkw_noserve=0)
for f in sorted(glob.glob("bodyfix/public/research/body-detector/*/compare.json")):
    mid=f.split("/")[-2]; m=mid[:8]
    d=json.load(open(f)); rows=d["rows"]
    ov=json.load(open(f"bodyfix/public/research/v3-serve-detector/{mid}/overlay.json"))
    sv=sorted(s[1] for s in ov["serves"]); bn=sorted(b[0] for b in ov["bounces"])
    calls=V.get(m,{})
    cards=[c for r in rows for c in r["mine"]]
    lines=[]
    for r in rows:
        t = r["prod_t0"] if r.get("prod_t0") is not None else (r["mine"][0]["t0"] if r["mine"] else None)
        call=calls.get(key(t),{}).get("verdict") if t is not None else None
        pv=r["verdict"]
        if pv=="missed" and r["kind"]=="point":
            end = r["tap"] or r["prod_t1"]
            ins=[s for s in sv if r["prod_t0"]-0.5 <= s <= end]
            tot["missed"]+=1; tot["missed_serve"]+= bool(ins)
            if call=="wrong":
                tot["missed_wrong"]+=1; tot["missed_wrong_serve"]+=bool(ins)
                lines.append(f"   MISSED(wrong) {r['prod_t0']:.1f}-{r['prod_t1']:.1f} serves inside: {[round(x,1) for x in ins]}")
        if pv=="fused" and r["kind"]=="point":
            # the body card crossing this row
            cov=[c for c in cards if c["t0"] <= (r["tap"] or r["prod_t1"]) and c["t1"] >= r["prod_t0"]]
            if cov:
                c=max(cov, key=lambda c: min(c["t1"], r["prod_t1"])-max(c["t0"], r["prod_t0"]))
                ins=[s for s in sv if c["t0"] <= s <= c["t1"]]
                tot["fused"]+=1
                if len(ins)>=2:
                    tot["fused_2serves"]+=1; tot["fused_gap"].append(ins[-1]-ins[0])
                if call in ("wrong","unsure") or True:
                    lines.append(f"   FUSED({call}) prod {r['prod_t0']:.1f}-{r['prod_t1']:.1f} body card {c['t0']:.1f}-{c['t1']:.1f} serves inside {[round(x,1) for x in ins]}")
        if r["kind"]=="point" and r["mine"] and pv in ("ok","extra"):
            c=r["mine"][0]; late=c["t0"]-r["prod_t0"]
            if late>=1.0:
                before=[s for s in sv if c["t0"]-4.0 <= s < c["t0"]+0.3]
                tot["late"]+=1; tot["late_serve_before"]+=bool(before)
                if call in ("wrong","unsure"):
                    lines.append(f"   LATE({call}) prod {r['prod_t0']:.1f} body {c['t0']:.1f} (+{late:.1f}s) serve before start: {[round(x,1) for x in before]}")
        if r["kind"]=="junk" and call=="wrong":
            for c in r["mine"]:
                ins=[s for s in sv if c["t0"] <= s <= c["t1"]]; bb=[b for b in bn if c["t0"] <= b <= c["t1"]]
                tot["junkw"]+=1; tot["junkw_noserve"]+= (not ins)
                lines.append(f"   JUNK(wrong) card {c['t0']:.1f}-{c['t1']:.1f} ({c['t1']-c['t0']:.1f}s) serves {len(ins)} bounces {len(bb)} why={c['why']}")
    if lines: print(f"## {names[m]}"); print("\n".join(lines))
g=tot.pop("fused_gap")
print("\nTOTALS", json.dumps(tot))
import statistics
if g: print("fused with 2 serves: serve spacing median %.1f s, min %.1f, max %.1f; under 6 s: %d of %d" % (statistics.median(g), min(g), max(g), sum(1 for x in g if x<6.0), len(g)))
