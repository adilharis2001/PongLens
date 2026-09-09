"""Before any redeploy of the body page: does every stored row call still have a row
in the candidate payloads? Point rows and deleted-card rows are keyed by production's
card start and cannot move; a card on nothing is keyed by MY card's start and can.
Reports orphans and the nearest same-kind row they could be re-attached to.
  /usr/bin/python3 verdicts_check.py <dir with <id>.json payloads> [page]"""
import sys, os, json, glob
F = os.path.dirname(os.path.abspath(__file__))
root = sys.argv[1]; page = sys.argv[2] if len(sys.argv) > 2 else "body-detector"
calls = json.load(open(f"{F}/verdicts_{page}.json"))
NAMES = {"77fc4dee": "Lester", "89b35ee0": "Yu Yu Lin", "d15aad4d": "Louis", "10322849": "Rob", "2eab3e3d": "Terry 2", "7e02fbb9": "Julian", "bfc9b31b": "Anton Aug", "cebaa6d4": "Rowel", "f3237587": "Koko 2", "1c08539e": "Tim", "5c90151a": "Hugo 22m", "5fd822ec": "Hugo 11m", "95a07786": "Wayne Wei"}
import math
def _r1(t): return math.floor(t * 10 + 0.5) / 10   # JS Math.round(t*10)/10, as the page keys rows
def row_key(r):
    if r.get("prod_t0") is not None: return _r1(r["prod_t0"])
    m = r.get("mine") or []
    return _r1(m[0]["t0"]) if m else None
total = kept = 0; orphans = []
for m, cs in calls.items():
    ps = glob.glob(f"{root}/{m}-*.json") or glob.glob(f"{root}/{m}-*/compare.json")
    if not ps: print(f"{NAMES.get(m, m)}: no candidate payload, {len(cs)} calls untested"); continue
    rows = json.load(open(ps[0]))["rows"]
    keys = {}
    for r in rows:
        k = row_key(r)
        if k is not None: keys.setdefault(f"{k:.1f}", r)
    for k, v in cs.items():
        total += 1
        if k in keys: kept += 1; continue
        # nearest row with no production card (the only kind that can move)
        cand = [(abs(row_key(r) - float(k)), row_key(r)) for r in rows if r.get("prod_t0") is None and row_key(r) is not None]
        near = min(cand) if cand else None
        orphans.append((NAMES.get(m, m), k, v["verdict"], (v.get("note") or "")[:40], f"nearest card on nothing at {near[1]:.1f} ({near[0]:.1f} s away)" if near else "no candidate"))
print(f"{page}: {kept} of {total} calls still have their row in {root}")
FULL = {"10322849": "10322849-07c6-469c-ae9c-58a879140d9e", "1c08539e": "1c08539e-d489-4ce3-95ce-205661afb43a", "2eab3e3d": "2eab3e3d-c4df-46ff-b0e2-2c6698fb2c69", "5c90151a": "5c90151a-d9be-417a-a450-e16c272fbc8c", "5fd822ec": "5fd822ec-bd27-4bf1-9553-eb6d6aef5947", "77fc4dee": "77fc4dee-3de6-47d6-a2df-df85e239535c", "7e02fbb9": "7e02fbb9-a3af-4686-84bc-d4b961ab9fed", "89b35ee0": "89b35ee0-01f9-4c01-a966-6305b6e96d4a", "95a07786": "95a07786-e8dd-461f-a710-9179cbbdab20", "bfc9b31b": "bfc9b31b-5220-40f7-ac28-ea32a8166bb8", "cebaa6d4": "cebaa6d4-81e4-4aab-b4fa-1ed485685d00", "d15aad4d": "d15aad4d-dfbf-4234-9b45-d68de83412cf", "f3237587": "f3237587-2aec-4267-99c8-b20c4e37386d"}
SHORT = {v: k for k, v in NAMES.items()}
import re as _re
blocking = 0
for o in orphans:
    name, k, verdict, note, near = o
    mm = _re.search(r"at ([\d.]+) \(([\d.]+) s away\)", near)
    if mm and float(mm.group(2)) <= 1.0 and SHORT.get(name) in FULL:
        # a card on nothing that moved by under a second keeps its call
        print("  REKEY", o)
        print(f"  REKEY-SQL update public.research_row_verdicts set row_s = {float(mm.group(1)):.1f}, updated_at = now() where page = '{page}' and match_id = '{FULL[SHORT[name]]}' and row_s = {float(k):.1f};")
    elif verdict == "wrong":
        # a card Adil called wrong that the new cards no longer make: the
        # problem is gone, the call stays stored as its record. Not blocking.
        print("  RESOLVED", o)
    else:
        # a card he called fine or unsure that no longer exists: a regression
        # or a lost row. Blocking.
        blocking += 1
        print("  ORPHAN", o)
if not orphans and total: print("  nothing would be lost")
if total and not blocking: print("  OK TO DEPLOY")
