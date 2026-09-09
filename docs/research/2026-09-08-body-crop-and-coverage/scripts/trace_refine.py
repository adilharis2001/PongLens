"""Step Julian's decoder segments through _bf_refine and V2.resolve, printing what each stage does near the points that vanished."""
import os, sys, numpy as np
os.environ.update(dict(V3_MATCH="7e02fbb9", V3_BODYFIRST="confirm", V3_BF_SERVE="1", V3_BF_SPLIT="6.0", V3_BF_NOCROSS="quiet", V3_BODY_SRV="0.80", V3_BF_EXTEND="both", V3_BF_EXTEND_GAP="1.2", V3_BF_EXTEND_PMIN="0.3", V3_BF_AFTER_FIRST="1"))
sys.path.insert(0, os.getcwd())
import sweep_dead as S, points_v2 as V2
e = S.make_e()
WIN = [(168, 186), (355, 376), (382, 396)]
def near(c): return any(c["t1"] >= a and c["t0"] <= b for a, b in WIN)
def show(tag, cards):
    print(f"--- {tag}")
    for c in sorted(cards, key=lambda c: c["t0"]):
        if near(c): print(f"   {c['t0']:.1f}-{c['t1']:.1f}  serve_s={c.get('serve_s')}  why={c.get('why')}  ev={c.get('end_evidence_s')}")
raw = S._bf_cards(e); show("decoder cards (padded)", raw)
sv = sorted(float(x) for x in e.serves); cr = np.asarray(e.cross, float); bt = np.asarray(e.bt_table, float)
for c in sorted(raw, key=lambda c: c["t0"]):
    if near(c):
        ins = [round(x, 1) for x in sv if c["t0"] <= x <= c["t1"]]
        print(f"   card {c['t0']:.1f}-{c['t1']:.1f}: serves inside {ins}; crossings {int(((cr>=c['t0'])&(cr<=c['t1'])).sum())}; table bounces {int(((bt>=c['t0'])&(bt<=c['t1'])).sum())}")
ref = S._bf_refine(e, raw); show("after _bf_refine (before resolve)", ref)
res = V2.resolve(ref); show("after V2.resolve", res)
# AFTER_FIRST and anything else the export applies
try:
    E2, final = S.assemble(); show("assemble() output", final)
except Exception as ex: print("assemble failed:", ex)
print("MIN_DEAD_S", V2.MIN_DEAD_S, "MIN_CARD_S", V2.MIN_CARD_S, "HEAD_LEAD", V2.HEAD_LEAD, "MIN_GAP_S", V2.MIN_GAP_S)
