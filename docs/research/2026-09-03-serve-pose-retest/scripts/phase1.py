"""Phase 1: Adil's 87 verdicts -> a scoring set the crop arms can be judged on.

Three groups, and only the first needs a timestamp:

  HIT      he said a flash is the serve, so that flash time IS the serve.
           Used to catch REGRESSION: a crop that loses these is worse.
  MISS     he said a serve is there and no flash landed on it. No timestamp,
           but we know a serve exists — so "does the cropped run produce a
           flash here" is answerable without one. This is the group the
           crop is supposed to fix.
  NONE     no serve in the clip, or unsure. Excluded from both.

A "later flash" verdict is only usable as a timestamp when the clip had
exactly two flashes; with three or four the button could not say which,
which was a design fault of the review page.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    verd = json.load(open(f"{HERE}/verdicts_raw.json"))
    cards = json.load(open(f"{HERE}/emerge_cards_89b35ee0.json"))
    out = {"hit": [], "miss": [], "excluded": []}
    for v in verd:
        idx = str(v["idx"])
        c = cards.get(idx) or {}
        flashes = c.get("emerge_local") or []
        rec = {"idx": v["idx"], "arm": v["arm"], "truth": v["truth"],
               "n_flashes": len(flashes)}
        if v["verdict"] == "first" and flashes:
            rec["serve_local"] = flashes[0]
            out["hit"].append(rec)
        elif v["verdict"] == "later" and len(flashes) == 2:
            rec["serve_local"] = flashes[1]
            out["hit"].append(rec)
        elif v["verdict"] == "later":
            # he judged a later flash right but the page could not record which
            rec["serve_local"] = None
            rec["note"] = "later flash correct, index unrecorded"
            out["hit"].append(rec)
        elif v["verdict"] == "missed":
            out["miss"].append(rec)
        else:
            rec["verdict"] = v["verdict"]
            out["excluded"].append(rec)
    json.dump(out, open(f"{HERE}/phase1_truth.json", "w"), indent=1)
    timed = [r for r in out["hit"] if r.get("serve_local") is not None]
    print(f"HIT  {len(out['hit'])} cards a flash got right "
          f"({len(timed)} with a usable timestamp, "
          f"{len(out['hit'])-len(timed)} where the page could not record which flash)")
    print(f"MISS {len(out['miss'])} cards with a serve the flash did not find")
    print(f"     of those, {sum(1 for r in out['miss'] if r['n_flashes']==0)} had NO flash at all "
          f"and {sum(1 for r in out['miss'] if r['n_flashes']>0)} had one in the wrong place")
    print(f"EXCL {len(out['excluded'])} (no serve in clip, or unsure)")
    print()
    for arm in ("unanchored", "anchored"):
        h = [r for r in out["hit"] if r["arm"] == arm]
        m = [r for r in out["miss"] if r["arm"] == arm]
        print(f"  {arm:11s} hit {len(h):3d}  miss {len(m):3d}  "
              f"= {len(h)/(len(h)+len(m))*100:.0f}% found")


if __name__ == "__main__":
    main()
