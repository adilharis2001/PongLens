#!/usr/bin/env python3
"""Calibrate the break-study matches that have no table.

Half the matches in the judged corpus were processed before the keypoint
detector shipped and carry `{"ok": false}`. Their point clips could not
recover a quad, but the SOURCE video is a much better input than a 720px
clip: full resolution, and free to sample anywhere rather than only
inside a rally. So this runs the production ladder's first rung directly
on the source and writes the result back into the study's own copy of
match.json.

Writes ONLY into ~/ponglens-research-work/break-study. Production
match.json is not touched — a quad good enough for a study is not
automatically one to serve to a player.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != HERE]
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

WORKDIR = Path.home() / "ponglens-research-work" / "break-study"


def main() -> None:
    import points_pipeline

    todo = []
    for folder in sorted(WORKDIR.iterdir()):
        mj = folder / "match.json"
        if not mj.is_file():
            continue
        match = json.loads(mj.read_text())
        cal = match.get("calibration") or {}
        if cal.get("table_corners_px") and cal.get("ok") is not False:
            continue
        src = next((p for p in folder.glob("source.*")), None)
        if src is None:
            continue
        todo.append((folder, mj, match, src))

    print(f"{len(todo)} matches need a table\n", flush=True)
    won = 0
    for folder, mj, match, src in todo:
        work = Path(tempfile.mkdtemp(prefix="kp-"))
        try:
            result = points_pipeline.keypoint_calibrate(str(src), str(work))
        except Exception as e:                               # noqa: BLE001
            print(f"{folder.name[:8]} crashed: {e}", flush=True)
            result = None
        finally:
            shutil.rmtree(work, ignore_errors=True)
        if not result:
            print(f"{folder.name[:8]} declined", flush=True)
            continue
        match["calibration"] = {
            "ok": True,
            "source": "keypoints-from-source",
            "table_corners_px": result["corners_px"],
            "note": result.get("note"),
        }
        mj.write_text(json.dumps(match))
        won += 1
        print(f"{folder.name[:8]} calibrated", flush=True)
    print(f"\n{won}/{len(todo)} recovered", flush=True)


if __name__ == "__main__":
    main()
