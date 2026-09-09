"""The cost side of letting the serve decide: false cards, false splits, wrong pull-backs, junk crossings."""
import json, glob, math, bisect
names={"10322849":"Rob","1c08539e":"Tim","2eab3e3d":"Terry 2","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","77fc4dee":"Lester","7e02fbb9":"Julian","89b35ee0":"Yu Yu Lin","95a07786":"Wayne Wei","bfc9b31b":"Anton","cebaa6d4":"Rowel","d15aad4d":"Louis","f3237587":"Koko 2"}
def key(t): return f"{math.floor(t*10+0.5)/10:.1f}"
V=json.load(open("fullframe/verdicts_body-detector.json"))
T=dict(sv_total=0, sv_in_card=0, sv_out_in_prod=0, sv_out_in_prodjunk=0, sv_out_nowhere=0, sv_out_before_first=0,
       ok_cards=0, ok_cards_2sv=0, ok_cards_2sv_25=0, pull_ok=0, pull_wrong=0, junk_cards=0, junk_nocross=0, junk_nocross_nosv=0, real_cards=0, real_nocross_nosv=0)
per={}
for f in sorted(glob.glob("bodyfix/public/research/body-detector/*/compare.json")):
    mid=f.split("/")[-2]; m=mid[:8]; d=json.load(open(f)); rows=d["rows"]
    ov=json.load(open(f"bodyfix/public/research/v3-serve-detector/{mid}/overlay.json"))
    sv=sorted(s[1] for s in ov["serves"])
    try: bx=json.load(open(f"poseretest/ballx_{m}.json")); cr=sorted(bx["crossings"])
    except Exception as ex: cr=None
    cards=sorted([c for r in rows for c in r["mine"]], key=lambda c:c["t0"])
    prod=[(r["prod_t0"], r["prod_t1"], r["kind"], r.get("tap")) for r in rows if r.get("prod_t0") is not None]
    first_prod=min(p[0] for p in prod if p[2]=="point") if any(p[2]=="point" for p in prod) else 0
    calls=V.get(m,{})
    pm=dict(false_cards=0, rescues=0, false_splits=0, pull_wrong=0)
    for s in sv:
        T["sv_total"]+=1
        if any(c["t0"]-0.3<=s<=c["t1"] for c in cards): T["sv_in_card"]+=1; continue
        if s<first_prod: T["sv_out_before_first"]+=1; continue
        hit=[p for p in prod if p[0]-0.5<=s<=p[1]]
        if hit and hit[0][2]=="point": T["sv_out_in_prod"]+=1; pm["rescues"]+=1
        elif hit: T["sv_out_in_prodjunk"]+=1; pm["false_cards"]+=1
        else: T["sv_out_nowhere"]+=1; pm["false_cards"]+=1
    # false splits: a card covering exactly one prod point (page ok) holding 2 serves >= 2.5 s apart
    for r in rows:
        if r["kind"]=="point" and r["verdict"]=="ok" and len(r["mine"])==1:
            c=r["mine"][0]; ins=[s for s in sv if c["t0"]<=s<=c["t1"]]
            T["ok_cards"]+=1
            if len(ins)>=2:
                T["ok_cards_2sv"]+=1
                if ins[-1]-ins[0]>=2.5:
                    T["ok_cards_2sv_25"]+=1; pm["false_splits"]+=1
                    call=calls.get(key(r["prod_t0"]),{}).get("verdict")
                    print(f"   {names[m]} would FALSE-SPLIT ok row {r['prod_t0']:.1f}-{r['prod_t1']:.1f} card {c['t0']:.1f}-{c['t1']:.1f} serves {[round(x,1) for x in ins]} (your call: {call})")
    # pull-back: serve within 4 s before a card start and after the previous card's end
    for i,c in enumerate(cards):
        prev_end=cards[i-1]["t1"] if i else -1
        before=[s for s in sv if max(c["t0"]-4.0, prev_end)<=s<c["t0"]-0.3]
        if not before: continue
        s=before[0]
        # right if the serve is inside the same prod point the card covers
        cov=[p for p in prod if p[2]=="point" and p[0]-0.5<=s<=p[1] and c["t0"]<=p[1] and c["t1"]>=p[0]]
        if cov: T["pull_ok"]+=1
        else: T["pull_wrong"]+=1; pm["pull_wrong"]+=1
    # junk cards vs crossings
    for r in rows:
        for c in r["mine"]:
            ins=[s for s in sv if c["t0"]<=s<=c["t1"]]
            ncr = len([x for x in cr if c["t0"]<=x<=c["t1"]]) if cr is not None else None
            if r["kind"]=="junk":
                T["junk_cards"]+=1
                if ncr is not None and ncr==0: T["junk_nocross"]+=1; T["junk_nocross_nosv"]+= (not ins)
            elif r["kind"]=="point" and r["verdict"] in ("ok",):
                T["real_cards"]+=1
                if ncr is not None and ncr==0 and not ins: T["real_nocross_nosv"]+=1
    per[names[m]]=pm
print("\nper match:", json.dumps(per))
print("TOTALS", json.dumps(T, indent=0))
