"""Recompute hypothesis status under alternative rule sets.
Validated first: the baseline recomputation must reproduce every stored
status and confidence exactly, or the counterfactual means nothing."""
import json, math, copy, sys

BLOCKERS = {
 "serve_incomplete","terminal_observation_missing","contact_inferred_from_audio",
 "contact_too_close_after_landing","landing_missing_before_contact",
 "contact_missing_before_landing","terminal_inferred_from_suggestion",
 "later_evidence_after_terminal","non_alternating_contacts",
 "unexpected_hitter","landing_on_hitter_half"}

def status_for(score, reasons, hard, blockers=BLOCKERS, drop_hard=frozenset()):
    hard = [h for h in hard if h not in drop_hard]
    conf = 1.0/(1.0+math.exp(-score/4.0))
    blocked = bool(set(blockers) & set(reasons))
    if hard: conf = min(conf, 0.69)
    elif blocked: conf = min(conf, 0.71)
    if conf >= 0.72 and not hard and not blocked: st="ready"
    elif conf >= 0.42: st="review"
    else: st="unavailable"
    return st, round(conf,4)

m=json.load(open("chris.json"))
bad=0; n=0
for p in m["points"]:
    for side,h in ((p.get("placement") or {}).get("hypotheses") or {}).items():
        n+=1
        st,cf = status_for(h["score"], h.get("reasons") or [], h.get("hard_reasons") or [])
        if st!=h["status"] or abs(cf-h["confidence"])>2e-4:
            bad+=1
            if bad<=3:
                print("MISMATCH",p["idx"],side,"got",st,cf,"stored",h["status"],h["confidence"])
print(f"validation: {n-bad}/{n} hypotheses reproduced exactly"
      f"{' — OK' if bad==0 else ' — BROKEN'}")

CONTACT = {"contact_too_close_after_landing","contact_missing_before_landing",
           "landing_missing_before_contact","contact_inferred_from_audio"}
TERMINAL = {"terminal_observation_missing","terminal_inferred_from_suggestion",
            "later_evidence_after_terminal"}
ORDERHARD = {"serve_first_bounce_on_receiver_half",
             "serve_second_bounce_on_server_half"}

VARIANTS = {
 "A_baseline":            (BLOCKERS, frozenset()),
 "B_drop_contact":        (BLOCKERS-CONTACT, frozenset()),
 "C_drop_terminal":       (BLOCKERS-TERMINAL, frozenset()),
 "D_drop_contact+term":   (BLOCKERS-CONTACT-TERMINAL, frozenset()),
 "E_D+serve_order_soft":  (BLOCKERS-CONTACT-TERMINAL, ORDERHARD),
 "F_evidence_only":       (frozenset(), frozenset(BLOCKERS|ORDERHARD|
                            {"unexpected_hitter","landing_on_hitter_half",
                             "non_alternating_contacts","serve_incomplete"})),
}
for name,(blk,dh) in VARIANTS.items():
    v=copy.deepcopy(m)
    for p in v["points"]:
        for side,h in ((p.get("placement") or {}).get("hypotheses") or {}).items():
            st,cf = status_for(h["score"], h.get("reasons") or [],
                               h.get("hard_reasons") or [], blk, dh)
            h["status"]=st; h["confidence"]=cf
            h["hard_reasons"]=[x for x in (h.get("hard_reasons") or [])
                               if x not in dh]
        pl=p.get("placement")
        if pl:
            sts={hh["status"] for hh in (pl.get("hypotheses") or {}).values()}
            pl["status"]=("ready" if "ready" in sts else
                          "review" if "review" in sts else "unavailable")
    json.dump(v,open(f"variant_{name}.json","w"))
print("variants written:", len(VARIANTS))
