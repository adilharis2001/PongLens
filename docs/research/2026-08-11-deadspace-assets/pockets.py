"""Fixed-rule pocket mining: cross-family conjunctions with NO fitted thresholds.

Adil's question: do simple combinations exist — e.g. "window shorter than 4s
AND no audio" — that are almost always junk? A fixed rule with round, a-priori
thresholds cannot fail cross-scene transfer the way fitted thresholds did,
because nothing is fitted. The honest risks that remain are selection (mining
many rules and keeping the lucky ones) and label noise, so the output is
candidate pockets for shadow validation, not shipped rules.

Kept casualties are the whole game: a pocket is interesting only if it hits
ZERO kept windows, and support should be spread across scenes, not one venue.
"""
import itertools
import json
from collections import defaultdict
from pathlib import Path

EXP = Path(__file__).parent
DROP = {"vinay_2ffe", "chris_d2b5", "jason_9a81"}          # duplicate uploads

d = json.load(open(EXP / "features_audio.json"))
scenes = {k: s["name"]
          for s in json.load(open(EXP / "analysis_audio_results.json"))["scenes"]
          for k in s["keys"]}
rows = [r for r in d["rows"] if r["key"] not in DROP and r["mid"] == 1]
for r in rows:
    r["dur"] = r["t1"] - r["t0"]
    r["scene"] = scenes.get(r["key"], "S??")
kept = [r for r in rows if not r["dead"]]
junk = [r for r in rows if r["dead"]]
print(f"mid-match windows after dedupe: {len(kept)} kept / {len(junk)} junk\n")


def evaluate(rule, name):
    jh = [r for r in junk if rule(r)]
    kh = [r for r in kept if rule(r)]
    sc = sorted({r["scene"] for r in jh})
    return {"name": name, "junk": len(jh), "kept": len(kh),
            "junk_pct": 100 * len(jh) / len(junk),
            "scenes": len(sc),
            "kept_scenes": sorted({r["scene"] for r in kh}),
            "hits": jh}


# ---- 1. Adil's exact rule -------------------------------------------------
print("=== Adil's rule: dur < 4s AND zero onsets ===")
for durt in (3.0, 4.0, 5.0):
    for cond, label in ((lambda r: r["n_onsets"] == 0, "n_onsets==0"),
                        (lambda r: r["n_onsets"] <= 1, "n_onsets<=1"),
                        (lambda r: r["n_onsets"] <= 2, "n_onsets<=2")):
        e = evaluate(lambda r, c=cond, t=durt: r["dur"] < t and c(r),
                     f"dur<{durt}s & {label}")
        print(f"  dur<{durt}s & {label:12s} -> junk {e['junk']:>3d} "
              f"({e['junk_pct']:4.1f}%) | KEPT HIT {e['kept']:>2d} "
              f"{e['kept_scenes'] if e['kept'] else ''} | "
              f"junk spread over {e['scenes']} scenes")

# ---- 2. systematic grid of fixed conjunctions ----------------------------
CONDS = {
    "dur<2": lambda r: r["dur"] < 2, "dur<3": lambda r: r["dur"] < 3,
    "dur<4": lambda r: r["dur"] < 4, "dur<5": lambda r: r["dur"] < 5,
    "dur>=20": lambda r: r["dur"] >= 20,
    "silent": lambda r: r["n_onsets"] == 0,
    "ons<=1": lambda r: r["n_onsets"] <= 1,
    "ons<=2": lambda r: r["n_onsets"] <= 2,
    "rate<=0.3": lambda r: r["onset_rate"] <= 0.3,
    "gap>=0.8": lambda r: r["max_gap_frac"] >= 0.8,
    "gap==1": lambda r: r["max_gap_frac"] >= 0.999,
    "cv>=1.5": lambda r: (r["ioi_cv"] or 0) >= 1.5,
    "rhythm<=0.2": lambda r: (r["rhythmicity"] if r["rhythmicity"] is not None
                              else 1.0) <= 0.2,
    "decay": lambda r: (r["decay_slope"] or 0) <= -0.15
                        and (r["decay_r2"] or 0) >= 0.6,
    "weak": lambda r: (r["strength_med_pct"] if r["strength_med_pct"]
                       is not None else 100) <= 20,
    "busy_after": lambda r: (r["post_rate_10s"] or 0) >= 2.0,
    "quiet_before": lambda r: r["pre_rate_10s"] is not None
                              and r["pre_rate_10s"] <= 0.3,
}
FAMILY = {  # never pair two conditions that read the same quantity
    "dur<2": "dur", "dur<3": "dur", "dur<4": "dur", "dur<5": "dur",
    "dur>=20": "dur", "silent": "ons", "ons<=1": "ons", "ons<=2": "ons",
    "rate<=0.3": "ons", "gap>=0.8": "gap", "gap==1": "gap", "cv>=1.5": "ioi",
    "rhythm<=0.2": "ioi", "decay": "ioi", "weak": "amp",
    "busy_after": "ctx", "quiet_before": "ctx",
}

results, tested = [], 0
names = list(CONDS)
for k in (1, 2, 3):
    for combo in itertools.combinations(names, k):
        fams = [FAMILY[c] for c in combo]
        if len(set(fams)) != len(fams):
            continue
        tested += 1
        e = evaluate(lambda r, cs=combo: all(CONDS[c](r) for c in cs),
                     " & ".join(combo))
        if e["kept"] == 0 and e["junk"] >= 8:
            results.append(e)

print(f"\n=== grid: {tested} fixed rules tested; zero-kept pockets with "
      f">=8 junk ===")
results.sort(key=lambda e: -e["junk"])
seen_hits = set()
for e in results[:14]:
    ids = {id(h) for h in e["hits"]}
    marker = " (subset of a rule above)" if ids <= seen_hits else ""
    seen_hits |= ids
    print(f"  {e['name']:38s} junk {e['junk']:>3d} ({e['junk_pct']:4.1f}%) "
          f"over {e['scenes']} scenes{marker}")

# ---- 3. union of zero-kept pockets ---------------------------------------
union = {id(h): h for e in results for h in e["hits"]}
per_scene = defaultdict(int)
for h in union.values():
    per_scene[h["scene"]] += 1
tot_junk_scene = defaultdict(int)
for r in junk:
    tot_junk_scene[r["scene"]] += 1
print(f"\n=== union of ALL zero-kept pockets ===")
print(f"  junk cut {len(union)}/{len(junk)} = "
      f"{100 * len(union) / len(junk):.1f}% | kept casualties 0/{len(kept)}")
print(f"  per scene: " + ", ".join(
    f"{s}:{per_scene[s]}/{tot_junk_scene[s]}"
    for s in sorted(tot_junk_scene)))

# ---- 4. honesty check: near-miss kept windows ----------------------------
print("\n=== kept windows CLOSEST to the pockets (near-misses; the risk) ===")
near = [r for r in kept if r["dur"] < 5 and r["n_onsets"] <= 3]
print(f"  kept with dur<5s and n_onsets<=3: {len(near)}")
for r in sorted(near, key=lambda r: (r["n_onsets"], r["dur"]))[:8]:
    print(f"    {r['key']:16s} {r['scene']} dur={r['dur']:.1f}s "
          f"onsets={r['n_onsets']} gap={r['max_gap_frac']:.2f}")
