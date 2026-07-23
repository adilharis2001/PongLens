#!/usr/bin/env python3
"""Score a candidate point split against human-curated labels.

  worker/venv/bin/python worker/eval/score_split.py labels.json match.json

labels.json comes from export_labels.py (the owner's kept/deleted curation);
match.json is a points_pipeline `points` output (candidate or baseline).

Definitions (documented once, used everywhere):
  kept point   a labels row with deleted=false — a real rally the user kept.
  recalled     an emitted segment [t0,t1] covers >= COVER_FRAC (0.70) of the
               kept point's labeled [t0,t1]. Coverage, not IoU: the user may
               have trimmed timings, and an emitted segment that fully
               contains a kept rally is a success, not a mismatch.
  false pos.   an emitted segment that overlaps NO kept point's range at
               all — exactly the segments the user would delete.
  dup pair     two emitted segments whose [t0,t1] overlap >= 50% of the
               shorter one (should be impossible; hard invariant).

HARD CONSTRAINT for any tuning: kept-point recall >= 0.99 on every labeled
match. Never trade real rallies for dead-space wins.
"""
import json
import sys

COVER_FRAC = 0.70


def overlap(a0, a1, b0, b1):
    return max(0.0, min(a1, b1) - max(a0, b0))


def score(labels, emitted):
    """labels: export_labels.py dict; emitted: [[t0,t1], ...].
    Returns a metrics dict."""
    kept = [p for p in labels["points"] if not p["deleted"]]
    deleted = [p for p in labels["points"] if p["deleted"]]

    recalled, missed = [], []
    for p in kept:
        dur = max(p["t1"] - p["t0"], 1e-6)
        cov = sum(overlap(p["t0"], p["t1"], e0, e1) for e0, e1 in emitted)
        (recalled if cov / dur >= COVER_FRAC else missed).append(p)

    fps = [e for e in emitted
           if not any(overlap(p["t0"], p["t1"], e[0], e[1]) > 0
                      for p in kept)]
    fp_minutes = sum(e1 - e0 for e0, e1 in fps) / 60.0

    dups = []
    ordered = sorted(emitted)
    for i in range(len(ordered)):
        for j in range(i + 1, len(ordered)):
            a, b = ordered[i], ordered[j]
            if b[0] >= a[1]:
                break
            short = max(min(a[1] - a[0], b[1] - b[0]), 1e-6)
            if overlap(*a, *b) / short >= 0.5:
                dups.append((a, b))

    return {
        "n_emitted": len(emitted),
        "n_kept": len(kept),
        "n_deleted_labels": len(deleted),
        "recall": len(recalled) / max(len(kept), 1),
        "missed_kept": [p["idx"] for p in missed],
        "fp_count": len(fps),
        "fp_minutes": round(fp_minutes, 2),
        "fp_segments": [[round(a, 1), round(b, 1)] for a, b in fps],
        "dup_pairs": dups,
    }


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    labels = json.load(open(sys.argv[1]))
    cand = json.load(open(sys.argv[2]))
    emitted = [[p["t0"], p["t1"]] for p in cand["points"]]
    m = score(labels, emitted)
    print(json.dumps(m, indent=1))
    print(f"\nsummary: recall {m['recall']:.1%} "
          f"({m['n_kept'] - len(m['missed_kept'])}/{m['n_kept']} kept), "
          f"{m['fp_count']} FPs / {m['fp_minutes']} min FP time, "
          f"{len(m['dup_pairs'])} dup pair(s)", file=sys.stderr)


if __name__ == "__main__":
    main()
