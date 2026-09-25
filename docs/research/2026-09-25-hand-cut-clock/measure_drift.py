"""Measure where a published hand cut's footage really sits in its cut video.

For one match: every kept segment's true start on the cut's clock, every
point's drift (true position minus published cut_t0 arithmetic) at a moment
inside its rally near the start and near the end, and, for the clips asked
for, which source seconds the clip file actually opens and closes on.

Two independent readings of each segment start:

- picture: a run of original frames 0.5 s into the segment, found in the
  cut by framematch (the original is read by range over a presigned URL,
  never downloaded whole);
- structure: every part cmd_cut encoded starts on its own keyframe and the
  cut's GOP is fixed at 60 frames, so a keyframe after a gap other than 60
  frames is a part boundary.

Read-only: R2 GET/HEAD and presigned GET. Writes only under HC_DRIFT_DIR.

    worker/venv/bin/python -B measure_drift.py <inventory.json> <match-prefix> \
        [--clips last:3,worst:3]

The inventory is the read-only query in REPAIR-PLAN.md, one row per match.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import framematch as fm  # noqa: E402
import r2ro  # noqa: E402

RUN_S = 0.2          # length of the original's frame run
SEARCH_S = 3.0       # search either side of the published position
PRE, POST = 1.2, 1.3


def planned_offsets(segments):
    out, acc = [], 0.0
    for a, b in segments:
        out.append(acc)
        acc += b - a
    return out


def segment_of(segments, second):
    for i, (a, b) in enumerate(segments):
        if a - 0.01 <= second <= b + 0.01:
            return i
    return None


def cut_frame_s(cut: Path) -> float:
    """The cut's typical frame duration (median video packet duration)."""
    rows = subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "packet=duration_time", "-of", "csv=p=0", str(cut)], text=True).split()
    return float(np.median([float(r) for r in rows if r and r != "N/A"]))


def keyframe_offsets(cut: Path, planned: list[float]) -> tuple[list[float], list[bool]]:
    """Each segment's first keyframe on the cut clock, and whether it is an
    unambiguous part boundary (reached after a gap other than 60 frames)."""
    rows = subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "packet=pts_time,flags", "-of", "csv=p=0", str(cut)], text=True).split()
    pk = sorted((float(r.split(",")[0]), "K" in r.split(",")[1]) for r in rows)
    kidx = [i for i, p in enumerate(pk) if p[1]]
    boundary = {kidx[0]} | {c for p, c in zip(kidx, kidx[1:]) if c - p != 60}
    out, flags, drift = [], [], 0.0
    for off in planned:
        best = min(kidx, key=lambda k: abs(pk[k][0] - off - drift))
        out.append(pk[best][0])
        flags.append(best in boundary)
        drift = pk[best][0] - off
    return out, flags


def locate(src_url, cut_path, source_s, guess_cut_s, fps):
    """Cut-clock position of the original's frame at source_s (the first
    frame at or after it), searched around guess_cut_s."""
    src = fm.decode(src_url, source_s - 0.05, RUN_S + 0.2, fps)
    run = fm.run_of(src, source_s, max(6, int(round(RUN_S * fps))))
    cut = fm.decode(str(cut_path), guess_cut_s - SEARCH_S,
                    2 * SEARCH_S + RUN_S + 0.2, fps)
    m = fm.align(run, cut)
    return float(run.pts[0]), m


def clip_ends(src_url, clip: Path, near_start_s, near_end_s, fps):
    """Source seconds of a clip file's first and last frame, by picture."""
    dur = float(json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
         "json", str(clip)]))["format"]["duration"])
    k = max(6, int(round(RUN_S * fps)))
    head = fm.decode(str(clip), 0.0, RUN_S + 0.3, fps)
    head_run = fm.Frames(head.pts[:k], head.img[:k])
    tail = fm.decode(str(clip), max(0.0, dur - 0.6), 0.8, fps)
    tail_run = fm.Frames(tail.pts[-k:], tail.img[-k:])
    frame = float(np.median(np.diff(tail.pts))) if len(tail.pts) > 1 else 1 / fps
    out = {"clip_duration_s": dur}
    for name, run, near, last in (("first", head_run, near_start_s, False),
                                  ("last", tail_run, near_end_s, True)):
        window = fm.decode(src_url, near - 2.5, 5.0 + RUN_S, fps)
        m = fm.align(run, window)
        # The source second of the run's first frame; for the tail, walk
        # to the clip's final frame and add its duration: where it ends.
        at = m.pts + ((run.pts[-1] - run.pts[0]) + frame if last else 0.0)
        out[name] = {"source_s": round(at, 4), "cost": round(m.cost, 4),
                     "confidence": round(m.confidence, 2)}
    return out


def main(argv):
    inventory, prefix = argv[0], argv[1]
    clip_spec = argv[argv.index("--clips") + 1] if "--clips" in argv else ""
    row = next(r for r in json.load(open(inventory)) if r["match"].startswith(prefix))
    key = row["match"][:8]
    work = r2ro.LOCAL_ROOT / key
    mj = json.load(open(r2ro.fetch(row["match_json_path"], work / "match.json")))
    cut = r2ro.fetch(row["cut_path"], work / "cut.mp4")
    src_url = r2ro.presign(row["raw_path"])
    fps = float(mj.get("source", {}).get("fps") or 0) or 60.0
    probe = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=avg_frame_rate", "-of", "json", str(cut)]))
    num, den = probe["streams"][0]["avg_frame_rate"].split("/")
    # An upper bound on the frame rate, for how many frames to decode. The
    # frame duration the checks use is measured separately (cut_frame_s).
    fps = max(fps, float(num) / float(den))

    segments = [(float(a), float(b)) for a, b in mj["cut_segments"]]
    planned = planned_offsets(segments)
    kf, kf_ok = keyframe_offsets(cut, planned)
    by_idx = {int(p["idx"]): p for p in mj["points"]}

    seg_rows = []
    for i, ((a, b), off) in enumerate(zip(segments, planned)):
        s = a + min(0.5, (b - a) / 2)
        src0, m = locate(src_url, cut, s, off + (s - a) + (kf[i] - off), fps)
        seg_rows.append({
            "i": i, "a": a, "b": b, "planned": round(off, 4),
            "measured": round(m.pts - (src0 - a), 4),
            "keyframe": round(kf[i], 4), "keyframe_boundary": kf_ok[i],
            "cost": round(m.cost, 4), "confidence": round(m.confidence, 2)})
        print(f"{key} seg {i:3d} planned {off:9.3f} measured "
              f"{seg_rows[-1]['measured']:9.3f} drift "
              f"{seg_rows[-1]['measured'] - off:+.3f} kf {kf[i] - off:+.3f} "
              f"conf {m.confidence:.1f}", flush=True)

    point_rows = []
    for p in row["points"]:
        idx = int(p["idx"])
        mp = by_idx[idx]
        t0, t1 = float(p["t0"]), float(p["t1"])
        cut_t0 = float(p["cut_t0"])
        clip_t0 = float(mp["clip_t0"])
        seg = segment_of(segments, clip_t0)
        rec = {"idx": idx, "id": p["id"], "t0": t0, "t1": t1,
               "cut_t0_db": cut_t0, "cut_t0_json": float(mp["cut_t0"]),
               "clip_t0": clip_t0, "clip_t1": float(mp["clip_t1"]),
               "segment": seg, "clip_path": p.get("clip_path")}
        for name, s in (("start", min(t0 + 0.5, (t0 + t1) / 2)),
                        ("end", max(t1 - 0.3, (t0 + t1) / 2))):
            pub = cut_t0 + (s - clip_t0)
            guess = pub + (seg_rows[seg]["measured"] - seg_rows[seg]["planned"]
                           if seg is not None else 0.0)
            src0, m = locate(src_url, cut, s, guess, fps)
            rec[f"drift_{name}"] = round(m.pts - (cut_t0 + (src0 - clip_t0)), 4)
            rec[f"cost_{name}"] = round(m.cost, 4)
            rec[f"conf_{name}"] = round(m.confidence, 2)
        point_rows.append(rec)
        print(f"{key} point {idx:3d} drift start {rec['drift_start']:+.3f} "
              f"end {rec['drift_end']:+.3f}", flush=True)

    clip_rows = []
    if clip_spec:
        want: list[int] = []
        for part in clip_spec.split(","):
            kind, n = part.split(":")
            n = int(n)
            if kind == "last":
                want += [r["idx"] for r in point_rows[-n:]]
            elif kind == "worst":
                want += [r["idx"] for r in sorted(
                    point_rows, key=lambda r: -r["drift_start"])[:n]]
            elif kind == "first":
                want += [r["idx"] for r in point_rows[:n]]
        for idx in dict.fromkeys(want):
            rec = next(r for r in point_rows if r["idx"] == idx)
            if not rec["clip_path"]:
                continue
            local = r2ro.fetch(rec["clip_path"], work / "clips" / Path(rec["clip_path"]).name)
            d = rec["drift_start"]
            ends = clip_ends(src_url, local, rec["clip_t0"] - d, rec["clip_t1"] - d, fps)
            ends.update(idx=idx, t0=rec["t0"], t1=rec["t1"],
                        clip_t0=rec["clip_t0"], clip_t1=rec["clip_t1"],
                        drift=d,
                        seconds_after_t1=round(ends["last"]["source_s"] - rec["t1"], 3),
                        misses_rally_end=bool(ends["last"]["source_s"] < rec["t1"]))
            clip_rows.append(ends)
            print(f"{key} clip {idx:3d} opens at {ends['first']['source_s']:.3f} "
                  f"(clip_t0 {rec['clip_t0']:.2f}) closes at "
                  f"{ends['last']['source_s']:.3f} (t1 {rec['t1']:.2f}, "
                  f"clip_t1 {rec['clip_t1']:.2f})", flush=True)

    out = {"match": row["match"], "fps": fps, "frame_s": cut_frame_s(cut),
           "segments": seg_rows,
           "points": point_rows, "clips": clip_rows}
    (work / "drift.json").write_text(json.dumps(out, indent=1))
    print(f"wrote {work / 'drift.json'}")


if __name__ == "__main__":
    main(sys.argv[1:])
