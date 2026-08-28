#!/usr/bin/env python3
"""Cache per-match scoring truth for the break study.

The judged verdicts cover the breaks a human was SHOWN — where the
detector fired, or where the score said a game had ended. A break nobody
was shown is not proven quiet, so calling it a negative can only make
precision look better than it is. Where the owner scored the whole
match, the score settles it: every game boundary is known, so any other
break is a true negative.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != HERE]
sys.path.insert(0, str(HERE.parent))

import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402

from worker.eval_side_changes import keychain, load_truth  # noqa: E402

WORKDIR = Path.home() / "ponglens-research-work" / "break-study"
OUT = WORKDIR / "scoring-truth.json"


def main() -> None:
    conn = psycopg2.connect(keychain("ponglens-db-url"))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    out = {}
    for folder in sorted(WORKDIR.iterdir()):
        if not (folder / "match.json").is_file():
            continue
        try:
            truth = load_truth(cur, folder.name)
        except Exception as e:                                # noqa: BLE001
            print(f"{folder.name[:8]} failed: {e}", flush=True)
            continue
        by_time = sorted(
            (p for p in truth["points"] if p.get("t0") is not None),
            key=lambda p: float(p["t0"]))
        # The rally index each proven boundary sits after, in the same
        # `idx` space the break windows use.
        after = []
        for b in truth["boundaries"]:
            gap_t0 = b.get("gap_t0")
            if gap_t0 is None:
                continue
            prev = [p for p in by_time if float(p["t1"] or -1) <= gap_t0 + 0.01]
            if prev:
                after.append(int(prev[-1]["idx"]))
        out[folder.name[:8]] = {
            "fully_scored": bool(truth["fully_scored"]),
            "boundary_after_idx": sorted(set(after)),
            "n_points": len(truth["points"]),
        }
        print(f"{folder.name[:8]} scored={truth['fully_scored']} "
              f"boundaries={sorted(set(after))}", flush=True)
    conn.commit()
    OUT.write_text(json.dumps(out, indent=1))
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
