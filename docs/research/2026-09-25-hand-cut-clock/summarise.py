"""Turn the per-match drift.json files into the tables in REPAIR-PLAN.md
and a small committed measurements.json (numbers only, no paths or ids
beyond the eight-character match prefix).

    worker/venv/bin/python -B summarise.py [HC_DRIFT_DIR]
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "/private/tmp/claude-501/hc-drift")
OUT = Path(__file__).resolve().parent / "measurements.json"
OPS = Path(os.environ.get("HC_REPAIR_OPS", ROOT / "ops"))
ORDER = ["5e432cde", "04f1b393", "4923bbef", "aae8e476",
         "623c09c6", "7ba06eb1", "06deeba4", "9acef67c"]


def main():
    rows, detail = [], {}
    for key in ORDER:
        d = json.loads((ROOT / key / "drift.json").read_text())
        segs, pts = d["segments"], d["points"]
        seg_drift = [s["measured"] - s["planned"] for s in segs]
        kf_gap = [s["keyframe"] - s["measured"] for s in segs]
        frame = d["frame_s"]
        pd = [p["drift_start"] for p in pts]
        agree = max(abs(p["drift_start"] - p["drift_end"]) for p in pts)
        # Point drift predicted from its segment's measured start, against
        # the point's own two direct readings.
        pred_err = max(abs((segs[p["segment"]]["measured"] - segs[p["segment"]]["planned"])
                           - p["drift_start"]) for p in pts)
        # A clip opens on another segment's footage when it starts earlier
        # than its segment's true start: drift larger than its lead.
        leads = [p["clip_t0"] - segs[p["segment"]]["a"] for p in pts]
        foreign = [max(0.0, dr - lead) for dr, lead in zip(pd, leads)]
        mid = len(pts) // 2
        row = {
            "match": key, "segments": len(segs), "points": len(pts),
            "drift_first": round(pd[0], 3), "drift_mid": round(pd[mid], 3),
            "drift_last": round(pd[-1], 3), "drift_max": round(max(pd), 3),
            "points_over_0_1": sum(x > 0.1 for x in pd),
            "points_over_0_2": sum(x > 0.2 for x in pd),
            "clips_opening_on_other_footage": sum(f > 0.5 * frame for f in foreign),
            "worst_foreign_s": round(max(foreign), 3),
            "start_end_agree_s": round(agree, 4),
            "segment_predicts_point_s": round(pred_err, 4),
            "keyframe_minus_picture_s": [round(min(kf_gap), 4), round(max(kf_gap), 4)],
            "frame_s": round(frame, 4),
            "min_confidence": round(min(
                min(min(p["conf_start"], p["conf_end"]) for p in pts),
                min(s["confidence"] for s in segs)), 2),
            "max_cost": round(max(max(p["cost_start"], p["cost_end"]) for p in pts), 4),
        }
        timeline = OPS / key / "timeline.json"
        plan = OPS / key / "plan.json"
        if timeline.exists() and plan.exists():
            # The cut re-run from its stored segments (repair_hand_cut_clock
            # timeline) and the repair plan built on its clock.
            t = json.loads(timeline.read_text())
            pl = json.loads(plan.read_text())
            shifts = [q["shift_s"] for q in pl["points"]]
            row["rerun_identical"] = t["reproduced"]
            row["rerun_last_shift_s"] = round(shifts[-1], 4)
            row["rerun_max_shift_s"] = round(max(shifts), 4)
            row["clips_to_recut"] = sum(q["recut"] for q in pl["points"])
            by = {q["idx"]: q["shift_s"] for q in pl["points"]}
            row["rerun_vs_picture_max_frames"] = round(max(
                abs(q[f"drift_{n}"] - by[q["idx"]]) / frame
                for q in pts for n in ("start", "end")), 2)
        rows.append(row)
        detail[key] = {
            "segment_drift": [round(x, 4) for x in seg_drift],
            "point_drift": [round(x, 4) for x in pd],
            "clips": [{k: c[k] for k in ("idx", "t0", "t1", "clip_t0", "clip_t1",
                                         "drift", "seconds_after_t1",
                                         "misses_rally_end")}
                      | {"last_frame_source_s": c["last"]["source_s"]}
                      for c in d["clips"]],
        }
    OUT.write_text(json.dumps({"summary": rows, "detail": detail}, indent=1) + "\n")
    cols = ["match", "segments", "points", "drift_first", "drift_mid",
            "drift_last", "drift_max", "points_over_0_2",
            "clips_opening_on_other_footage", "worst_foreign_s"]
    print(" | ".join(cols))
    for r in rows:
        print(" | ".join(str(r[c]) for c in cols))
    print()
    for r in rows:
        print(r["match"], "start/end agree", r["start_end_agree_s"],
              "segment predicts point", r["segment_predicts_point_s"],
              "kf-picture", r["keyframe_minus_picture_s"], "frame", r["frame_s"],
              "min conf", r["min_confidence"], "max cost", r["max_cost"])
    print()
    for key in ORDER:
        for c in detail[key]["clips"]:
            print(key, "clip", c["idx"], "drift %.3f" % c["drift"],
                  "ends %.3fs after the marked end" % c["seconds_after_t1"],
                  "MISSES END" if c["misses_rally_end"] else "")


if __name__ == "__main__":
    main()
