#!/usr/bin/env python
"""Seed table_calibration_review: one frame and every proposal per match.

Table calibration has never had a reference worth measuring against. The
deterministic pink-rim calibrator was assumed to be one until 2026-08-16,
when two of three sampled matches turned out to carry quads spanning half the
room. This builds the corpus the owner corrects by hand, so the next claim
about accuracy is measured rather than eyeballed.

Per match it writes the exact background frame the proposals were made
against, Luna's five trials and their consensus, Sol's three trials where
Luna could not agree with itself, and whatever the pipeline stored at the
time. Corners are always SOURCE pixels.

Run:  worker/venv/bin/python worker/build_table_calibration_review.py [--limit N]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import boto3
import cv2
import numpy as np
import psycopg2
import psycopg2.extras
import placement_retry_calibration as prc
import vision_table_calibration as vtc

MEDIA_BUCKET = "ponglens-media"
FRAME_PREFIX = "research/table-calibration/v1/frames"

LUNA_MODEL = "gpt-5.6-luna"
LUNA_TRIALS = 5
SOL_MODEL = "gpt-5.6-sol"
SOL_TRIALS = 3
# Sol is 25x Luna's price. It runs only where Luna cannot reach consensus,
# which on a 51-match sample was 9 matches — about a dollar, not six.
SOL_BUDGET_USD = 2.00

RATES = {  # input, cached, cache-write, output — per token
    LUNA_MODEL: (0.2e-6, 0.02e-6, 0.25e-6, 1.2e-6),
    SOL_MODEL: (5.0e-6, 0.5e-6, 6.25e-6, 30.0e-6),
}


def keychain(service: str) -> str:
    return subprocess.run(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", service, "-w"],
        capture_output=True, text=True, timeout=10).stdout.strip()


DATABASE_URL = os.environ.get("DATABASE_URL") or keychain("ponglens-db-url")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY") or keychain("openai-api-key")


def r2():
    account = keychain("ponglens-r2-account")
    return boto3.client(
        "s3", endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=keychain("ponglens-r2-key-id"),
        aws_secret_access_key=keychain("ponglens-r2-secret"),
        region_name="auto")


def key_of(path: str) -> str:
    return path.split(f"{MEDIA_BUCKET}/", 1)[1]


# ---------------------------------------------------------------------------
# Frames — identical to what vision_calibrate would see in production
# ---------------------------------------------------------------------------
def representative_frames(s3, cut_key: str, workdir: Path):
    url = s3.generate_presigned_url(
        "get_object", Params={"Bucket": MEDIA_BUCKET, "Key": cut_key},
        ExpiresIn=7200)
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,duration", "-of", "json", url],
        capture_output=True, text=True, timeout=300).stdout)
    stream = probe["streams"][0]
    width, height = int(stream["width"]), int(stream["height"])
    duration = float(stream["duration"])

    images = []
    for index in range(24):
        at = duration * index / 24.0
        frame_path = workdir / f"s{index:02d}.jpg"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{at:.2f}",
             "-i", url, "-frames:v", "1", "-q:v", "2", "-y", str(frame_path)],
            capture_output=True, timeout=300)
        image = cv2.imread(str(frame_path))
        frame_path.unlink(missing_ok=True)
        if image is not None:
            images.append(vtc._resize_bounded(image))

    if len(images) < 3 or len({i.shape for i in images}) != 1:
        raise RuntimeError(
            f"{len(images)} usable frames, "
            f"{len({i.shape for i in images})} distinct shapes")

    background = np.median(np.stack(images), axis=0).astype(np.uint8)
    halves = np.array_split(np.arange(len(images)), 2)
    picked = [max((images[int(i)] for i in half), key=vtc._generic_frame_score)
              for half in halves if len(half)]
    paths = []
    for name, image in zip(["background.jpg", "representative-1.jpg",
                            "representative-2.jpg"], [background, *picked]):
        out = workdir / name
        cv2.imwrite(str(out), image, [cv2.IMWRITE_JPEG_QUALITY, 92])
        paths.append(out)
    return paths, background, (width, height)


# ---------------------------------------------------------------------------
# Proposals
# ---------------------------------------------------------------------------
def scale_to_source(corners, frame_w, frame_h, src_w, src_h):
    sx, sy = src_w / frame_w, src_h / frame_h
    return [[round(float(x) * sx, 1), round(float(y) * sy, 1)]
            for x, y in corners]


def run_model(frames, background, model, trials, spend):
    """Trials for one model, scored on geometry and edge support.

    activity_overlap and projection support are production's other two legs
    and both need BlurBall detections, which this script does not run. They
    reject a quad that floats off the play area; they never rescue a wrong
    one. Their absence makes this slightly more permissive than production,
    equally for every model.
    """
    frame_h, frame_w = background.shape[:2]
    out = []
    for index in range(trials):
        started = time.time()
        try:
            raw = prc.request_corner_proposal(
                list(frames), api_key=OPENAI_KEY, model=model,
                reasoning_effort="low", max_output_tokens=2400)
        except Exception as error:                      # noqa: BLE001
            out.append({"accepted": False,
                        "reason": f"request:{type(error).__name__}"})
            continue
        try:
            proposal = prc.parse_corner_proposal(raw, frame_w, frame_h)
            corners = prc.validate_quad(proposal.corners, frame_w, frame_h,
                                        bounce_core=None, min_aspect=0.25)
        except Exception as error:                      # noqa: BLE001
            out.append({"accepted": False, "reason": "geometry_or_confidence",
                        "detail": str(error)[:90],
                        "latency_s": round(time.time() - started, 1)})
            continue
        support = vtc._edge_support(background, corners)
        accepted = (support["edge_support"] >= vtc.MIN_TOTAL_EDGE_SUPPORT
                    and support["supported_edges"] >= vtc.MIN_SUPPORTED_EDGES)
        out.append({
            "accepted": bool(accepted),
            "reason": None if accepted else "edge_support",
            "confidence": round(float(proposal.confidence), 3),
            "corners": corners.tolist(),
            "edge_support": support["edge_support"],
            "supported_edges": support["supported_edges"],
            "latency_s": round(time.time() - started, 1),
        })
    return out


def consensus_block(trials, background, source_size):
    frame_h, frame_w = background.shape[:2]
    src_w, src_h = source_size
    picked = vtc.select_consensus(trials, frame_w, frame_h)
    block = {
        "trials": [
            {**t, "corners_source": (
                scale_to_source(t["corners"], frame_w, frame_h, src_w, src_h)
                if t.get("corners") else None)}
            for t in trials
        ],
        "accepted": bool(picked.get("accepted")),
        "reason": picked.get("reason"),
        "max_drift_ratio": picked.get("maximum_drift_ratio"),
        "median_drift_ratio": picked.get("median_drift_ratio"),
        "corners_source": None,
    }
    if picked.get("accepted"):
        block["corners_source"] = scale_to_source(
            picked["corners"], frame_w, frame_h, src_w, src_h)
    return block


def stored_production(s3, mj_key):
    try:
        body = s3.get_object(Bucket=MEDIA_BUCKET, Key=mj_key)["Body"].read()
        calib = (json.loads(body) or {}).get("calibration") or {}
    except Exception:                                   # noqa: BLE001
        return None
    corners = calib.get("table_corners_px")
    if not calib.get("ok") or not corners:
        return {"ok": False, "note": calib.get("note")}
    order = ["A_near_1", "B_near_2", "C_far_2", "D_far_1"]
    if not all(k in corners for k in order):
        return {"ok": False, "note": calib.get("note")}
    return {"ok": True, "note": calib.get("note"),
            "corners_source": [corners[k] for k in order]}


def spend_from(usage_path: Path) -> float:
    if not usage_path.exists():
        return 0.0
    total = 0.0
    for line in usage_path.read_text().splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        rates = RATES.get(record.get("model"))
        if not rates:
            continue
        inp, cached, write, out = rates
        usage = record["usage"]
        total_in = usage.get("input_tokens") or 0
        hit = (usage.get("input_tokens_details") or {}).get("cached_tokens") or 0
        total += max(0, total_in - hit) * (write if total_in >= 1024 else inp)
        total += hit * cached + (usage.get("output_tokens") or 0) * out
    return total


# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--only", default="")
    parser.add_argument("--no-sol", action="store_true")
    args = parser.parse_args()

    if not (DATABASE_URL and OPENAI_KEY):
        sys.exit("DATABASE_URL and OPENAI_API_KEY are required")

    usage_path = Path(tempfile.gettempdir()) / "tcr-usage.jsonl"
    usage_path.unlink(missing_ok=True)
    os.environ["PONGLENS_COST_USAGE_OUTPUT"] = str(usage_path)

    s3 = r2()
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            select id, cut_path, match_json_path, duration_s, created_at
            from matches
            where cut_path is not null and match_json_path is not null
            order by created_at
        """)
        rows = cur.fetchall()
        cur.execute("select match_id from table_calibration_review")
        done = {str(r["match_id"]) for r in cur.fetchall()}

    # Same video means same table. cut_path catches the re-cut re-uploads that
    # share a file; duration catches the same file uploaded twice under
    # different names, which no path comparison can see.
    first_by_video, first_by_duration, duplicate = {}, {}, {}
    for row in rows:
        mid = str(row["id"])
        video = row["cut_path"]
        if video in first_by_video:
            duplicate[mid] = (first_by_video[video], "same video file")
        else:
            first_by_video[video] = mid
        seconds = row["duration_s"]
        if seconds is not None:
            if seconds in first_by_duration:
                duplicate.setdefault(
                    mid, (first_by_duration[seconds], "identical duration"))
            else:
                first_by_duration[seconds] = mid

    todo = [r for r in rows if str(r["id"]) not in done]
    if args.only:
        todo = [r for r in todo if str(r["id"]).startswith(args.only)]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(rows)} matches, {len(done)} already built, {len(todo)} to do",
          flush=True)

    for row in todo:
        mid = str(row["id"])
        short = mid[:8]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                workdir = Path(tmp)
                frames, background, source_size = representative_frames(
                    s3, key_of(row["cut_path"]), workdir)
                frame_h, frame_w = background.shape[:2]

                frame_key = f"{FRAME_PREFIX}/{mid}.jpg"
                s3.put_object(Bucket=MEDIA_BUCKET, Key=frame_key,
                              Body=frames[0].read_bytes(),
                              ContentType="image/jpeg")

                luna = consensus_block(
                    run_model(frames, background, LUNA_MODEL, LUNA_TRIALS,
                              usage_path),
                    background, source_size)

                sol = None
                if not luna["accepted"] and not args.no_sol:
                    if spend_from(usage_path) < SOL_BUDGET_USD:
                        sol = consensus_block(
                            run_model(frames, background, SOL_MODEL,
                                      SOL_TRIALS, usage_path),
                            background, source_size)
                    else:
                        print("  Sol budget reached; skipping escalation",
                              flush=True)

                proposals = {
                    "luna": luna,
                    "sol": sol,
                    "production": stored_production(
                        s3, key_of(row["match_json_path"])),
                    "built_at_models": {"luna": LUNA_MODEL, "sol": SOL_MODEL},
                }

            dup = duplicate.get(mid)
            with conn.cursor() as cur:
                cur.execute("""
                    insert into table_calibration_review
                      (match_id, frame_key, frame_width, frame_height,
                       source_width, source_height, duplicate_of,
                       duplicate_reason, proposals)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
                    on conflict (match_id) do update set
                      frame_key = excluded.frame_key,
                      frame_width = excluded.frame_width,
                      frame_height = excluded.frame_height,
                      source_width = excluded.source_width,
                      source_height = excluded.source_height,
                      duplicate_of = excluded.duplicate_of,
                      duplicate_reason = excluded.duplicate_reason,
                      proposals = excluded.proposals
                """, (mid, frame_key, frame_w, frame_h, source_size[0],
                      source_size[1], dup[0] if dup else None,
                      dup[1] if dup else None, json.dumps(proposals)))

            print(f"{short} luna={'OK ' if luna['accepted'] else 'no '}"
                  f"sol={'-' if sol is None else ('OK' if sol['accepted'] else 'no')} "
                  f"{'DUP' if dup else '   '} ${spend_from(usage_path):.3f}",
                  flush=True)
        except Exception as error:                      # noqa: BLE001
            print(f"{short} FAILED {type(error).__name__}: {error}", flush=True)

    print(f"\nDONE  spend ${spend_from(usage_path):.3f}", flush=True)


if __name__ == "__main__":
    main()
