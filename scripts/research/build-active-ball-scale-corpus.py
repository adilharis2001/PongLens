#!/usr/bin/env python3
"""Build the fixed cross-recording active-ball teacher corpus locally."""
import argparse
import concurrent.futures
import hashlib
import json
import subprocess
import sys
import uuid
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from worker.active_ball_data import validate_dataset
from worker.active_ball_scale_data import sample_times, validate_recording_splits


SOURCES = {
    "chris_b": ("train", "PingPod"),
    "chris_rc": ("train", "PingPod"),
    "julian_16": ("train", "PingPod Dobro"),
    "prabhas_rc": ("train", "LYTTC"),
    "rowel": ("train", "PingPod"),
    "gavin_16": ("validation", "LYTTC"),
    "tripp_rc": ("validation", "Westchester TTC"),
    "julian_rc": ("test", "PingPod"),
    "terry": ("test", "Westchester TTC"),
}
CORNER_ORDER = ("A_near_1", "B_near_2", "C_far_2", "D_far_1")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def extract_recording(name, split, venue, work, output):
    source_dir = work / name
    source = source_dir / "raw.mov"
    match = json.loads((source_dir / "match.json").read_text())
    meta = json.loads((source_dir / "meta.json").read_text())
    digest = sha256(source)
    fps = float(meta["fps"])
    duration = float(meta["duration"])
    width, height = int(meta["width"]), int(meta["height"])
    corners = [match["calibration"]["table_corners_px"][key] for key in CORNER_ORDER]
    seed = int(hashlib.sha256(f"{name}:{digest}".encode()).hexdigest()[:16], 16)
    samples = sample_times(match["points"], duration, seed=seed)
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise ValueError(f"could not open {source}")
    rows = []
    for target_time, kind in samples:
        frame = max(1, min(round(target_time * fps), round(duration * fps) - 2))
        frame_times = [(frame + offset) / fps for offset in (-1, 0, 1)]
        sample_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"ponglens:{digest}:{frame}"))
        frame_dir = output / "frames" / sample_id
        frame_dir.mkdir(parents=True, exist_ok=True)
        capture.set(cv2.CAP_PROP_POS_FRAMES, frame - 1)
        paths = []
        for index in range(3):
            ok, image = capture.read()
            if not ok or image.shape[:2] != (height, width):
                raise ValueError(f"bad decoded frame {name}:{frame - 1 + index}")
            path = frame_dir / f"{index}.jpg"
            if not cv2.imwrite(str(path), image, [cv2.IMWRITE_JPEG_QUALITY, 95]):
                raise ValueError(f"could not write {path}")
            paths.append(str(path))
        rows.append({
            "id": sample_id,
            "match_id": f"scale:{name}",
            "source_name": name,
            "source_file": str(source),
            "source_sha256": digest,
            "venue": venue,
            "split": split,
            "sample_kind": kind,
            "frame": frame,
            "time_s": frame_times[1],
            "frame_times_s": frame_times,
            "width": width,
            "height": height,
            "frames": paths,
            "corners": corners,
            "label": None,
        })
    capture.release()
    return rows


def make_clip(row, output):
    path = output / "context" / f"{row['id']}.mp4"
    if path.exists() and path.stat().st_size:
        return
    temporary = path.with_suffix(".tmp.mp4")
    subprocess.run([
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{row['time_s'] - 1.2:.6f}", "-i", row["source_file"],
        "-t", "2.4", "-an", "-vf", "scale=960:-2,fps=15",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(temporary),
    ], check=True)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--work", type=Path, default=Path("/Users/adil/Desktop/Projects/TTVid/recall-lab/work"))
    parser.add_argument("--clip-workers", type=int, default=6)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "frames").mkdir(exist_ok=True)
    (args.output / "context").mkdir(exist_ok=True)

    rows = []
    for name, (split, venue) in SOURCES.items():
        rows.extend(extract_recording(name, split, venue, args.work, args.output))
        print(json.dumps({"extracted": name, "rows": len(rows)}), flush=True)
    rows.sort(key=lambda row: (row["source_name"], row["time_s"]))
    validate_recording_splits(rows)
    validate_dataset(rows, allow_shared_venues=True)
    if len(rows) != 810:
        raise ValueError(f"expected 810 rows, found {len(rows)}")
    counts = {split: sum(row["split"] == split for row in rows) for split in ("train", "validation", "test")}
    if counts != {"train": 450, "validation": 180, "test": 180}:
        raise ValueError(f"unexpected split counts: {counts}")
    manifest = args.output / "manifest.json"
    manifest.write_text(json.dumps(rows, indent=2))
    # Interleave recordings so a small API smoke run exercises every venue and split.
    input_order = []
    by_source = {name: [row for row in rows if row["source_name"] == name] for name in SOURCES}
    for position in range(90):
        input_order.extend(by_source[name][position] for name in SOURCES)
    inputs = [{key: row[key] for key in ("id", "frames", "frame_times_s", "width", "height", "corners")} for row in input_order]
    (args.output / "inputs.json").write_text(json.dumps(inputs, indent=2))
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.clip_workers) as pool:
        futures = [pool.submit(make_clip, row, args.output) for row in rows]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            future.result()
            if index % 30 == 0:
                print(json.dumps({"clips": index, "total": len(rows)}), flush=True)
    summary = {
        "rows": len(rows),
        "splits": counts,
        "sources": {name: sum(row["source_name"] == name for row in rows) for name in SOURCES},
        "sample_kinds": {kind: sum(row["sample_kind"] == kind for row in rows) for kind in ("rally", "gap")},
        "manifest_sha256": sha256(manifest),
    }
    (args.output / "corpus-summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
