"""What a drifted clip file opens on.

A clip was cut from the cut video at the published cut_t0. When the drift
is larger than the clip's lead into its segment (clip_t0 minus the
segment's first kept second, 0.15 s for most points), the clip starts
before its own segment does, on the last frames of the PREVIOUS kept
segment. This finds the clip's first frames in the original around that
previous segment's end, and the frame where the clip jumps to its own
footage.

    worker/venv/bin/python -B clip_open.py <inventory.json> <match-prefix> <idx> [...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import framematch as fm  # noqa: E402
import r2ro  # noqa: E402


def main(argv):
    inventory, prefix, idxs = argv[0], argv[1], [int(x) for x in argv[2:]]
    row = next(r for r in json.load(open(inventory)) if r["match"].startswith(prefix))
    key = row["match"][:8]
    work = r2ro.LOCAL_ROOT / key
    drift = json.loads((work / "drift.json").read_text())
    fps = drift["fps"]
    segs = drift["segments"]
    src_url = r2ro.presign(row["raw_path"])
    k = max(6, int(round(0.1 * fps)))
    for idx in idxs:
        p = next(x for x in drift["points"] if x["idx"] == idx)
        seg = segs[p["segment"]]
        lead = p["clip_t0"] - seg["a"]
        d = p["drift_start"]
        clip = r2ro.fetch(p["clip_path"], work / "clips" / Path(p["clip_path"]).name)
        head = fm.decode(str(clip), 0.0, 1.5, fps)
        first = fm.Frames(head.pts[:k], head.img[:k])
        if p["segment"] == 0:
            print(key, idx, "first segment: nothing before it")
            continue
        prev_end = segs[p["segment"] - 1]["b"]
        window = fm.decode(src_url, prev_end - 1.5, 2.0, fps)
        m_prev = fm.align(first, window)
        own = fm.decode(src_url, p["clip_t0"] - 0.5, 1.5, fps)
        m_own = fm.align(first, own)
        # Where the clip's own footage begins: the first clip frame that
        # matches the segment's opening frames.
        opening = fm.run_of(fm.decode(src_url, seg["a"] - 0.02, 0.4, fps), seg["a"], k)
        m_jump = fm.align(opening, head)
        print(f"{key} clip {idx:3d} drift {d:.3f} lead {lead:.3f}: "
              f"first frame = source {m_prev.pts:.3f} (previous segment ends "
              f"{prev_end:.2f}; cost {m_prev.cost:.4f} vs {m_own.cost:.4f} "
              f"near its own start); own footage begins "
              f"{m_jump.pts - head.pts[0]:.3f}s into the clip "
              f"(expected {max(0.0, d - lead):.3f})", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
