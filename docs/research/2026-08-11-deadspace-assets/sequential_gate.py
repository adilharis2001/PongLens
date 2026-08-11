"""Sequential within-match gating — Adil's negative-control idea, untested.

The match-level gate failed because it needed labels. But SCORING PRODUCES
labels, in order: after the user has scored the first N points of a match,
we know exactly how many of their own kept points measured zero crossings in
this very file (same camera, quad and track throughout). If that early
sample certifies the measurement, apply the zero-crossing rule to the rest.

Simulation over the 22 evaluated matches: user scores the first points
manually; once NK kept points are seen, certify iff at most ALLOW of them
measured zero crossings; then every remaining zero-crossing window is
auto-deleted. Tally tail junk caught and tail kept harmed.
"""
import json
from pathlib import Path

import evaluate as E                      # reuse loaders + verbatim crossings

CX = Path(__file__).parent
per_match = dict(json.load(open(CX / "evaluation.json"))["per_match"])

cases = []
for key, pm in per_match.items():
    out = E.eval_match(key, pm["fps"])
    if out is None:
        continue
    _, rows = out
    rows.sort(key=lambda r: r["t0"])
    cases.append((key, rows))
print(f"{len(cases)} matches loaded\n")

for NK in (8, 12, 16):
    for ALLOW in (0, 1):
        cert, tj, tjc, tk, tkh = 0, 0, 0, 0, 0
        harmed = {}
        for key, rows in cases:
            kept_seen, zero_seen, cut_at = 0, 0, None
            for i, r in enumerate(rows):
                if not r["junk"]:
                    kept_seen += 1
                    if r["n_cross"] == 0:
                        zero_seen += 1
                if kept_seen == NK:
                    if zero_seen <= ALLOW:
                        cut_at = i + 1
                    break
            if cut_at is None:
                continue
            cert += 1
            tail = rows[cut_at:]
            for r in tail:
                if r["junk"]:
                    tj += 1
                    if r["n_cross"] == 0:
                        tjc += 1
                else:
                    tk += 1
                    if r["n_cross"] == 0:
                        tkh += 1
                        harmed[key] = harmed.get(key, 0) + 1
        print(f"NK={NK:>2d} ALLOW={ALLOW} | certified {cert:>2d}/22 | "
              f"tail junk caught {tjc:>3d}/{tj:<3d} "
              f"({100*tjc/max(1,tj):4.1f}%) | tail kept harmed "
              f"{tkh:>2d}/{tk:<4d} ({100*tkh/max(1,tk):.2f}%) | {harmed}")

print("\nBaselines: oracle match gate 5/563 harmed (0.89%), 127/186 junk;"
      "\nbest blind match gate 62/1088 (5.7%).")
