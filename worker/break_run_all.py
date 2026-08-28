#!/usr/bin/env python3
"""Run break_extract over every calibrated match in the study folder."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORKDIR = Path.home() / "ponglens-research-work" / "break-study"
RTMPOSE_PY = Path(
    "/Users/adil/Library/Caches/PongLens/rtmpose-production/venv/bin/python")


def main() -> None:
    todo = []
    for folder in sorted(WORKDIR.iterdir()):
        mj = folder / "match.json"
        if not mj.is_file():
            continue
        cal = (json.loads(mj.read_text()).get("calibration") or {})
        if not cal.get("table_corners_px"):
            print(f"{folder.name[:8]} no table, skipped", flush=True)
            continue
        if not any(folder.glob("source.*")):
            continue
        todo.append(folder)

    print(f"{len(todo)} matches to extract\n", flush=True)
    for i, folder in enumerate(todo, 1):
        out = folder / "breaks.json"
        if out.is_file():
            print(f"[{i}/{len(todo)}] {folder.name[:8]} cached", flush=True)
            continue
        started = time.perf_counter()
        proc = subprocess.run(
            [str(RTMPOSE_PY), str(HERE / "break_extract.py"),
             "--match-dir", str(folder), "--out", str(out)],
            capture_output=True, text=True)
        tail = (proc.stdout or proc.stderr or "").strip().splitlines()
        print(f"[{i}/{len(todo)}] {tail[-1] if tail else 'no output'} "
              f"({time.perf_counter() - started:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
