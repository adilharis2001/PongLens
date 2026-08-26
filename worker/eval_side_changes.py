#!/usr/bin/env python3
"""Evaluate the side-change detector against scored production matches.

Scored matches carry the ground truth for free: every game boundary is
either provable from the confirmed-winner walk (fully scored matches) or
pinned by the owner's positional game_end_override — which by design marks
"the video's visible side switch" (migration 021). This harness downloads
each truth-bearing match's clips + match.json from R2, runs the isolated
RTMPose extractor, and scores detected side changes against those
boundaries by TIME OVERLAP, so later splits, merges and deletions in the
app cannot skew the comparison.

Matching rule: a confirmed detection covering gap [after.t1, before.t0]
counts as a hit when a true boundary's own gap midpoint falls within the
detected gap padded by ±3s (and vice versa for recall). False positives
are only charged on fully-scored matches — on pin-only matches an
un-pinned fire may simply be a boundary the owner never marked, and those
are reported separately as "unverified".

Read-only against production: this script never writes to jobs, matches
or points. Artifacts land under --workdir (default
~/ponglens-research-work/game-end-eval), outside the repo.

Run from the repo root with the worker venv:

  worker/venv/bin/python -m worker.eval_side_changes --all-truth
  worker/venv/bin/python -m worker.eval_side_changes --match <uuid> ...
  worker/venv/bin/python -m worker.eval_side_changes --all-truth \
      --config '{"margin_threshold": 0.12}' --no-extract   # rescore only
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import psycopg2
import psycopg2.extras

REPO = Path(__file__).resolve().parent
DEFAULT_WORKDIR = Path.home() / "ponglens-research-work" / "game-end-eval"
RTMPOSE_PY = Path(
    "/Users/adil/Library/Caches/PongLens/rtmpose-production/venv/bin/python"
)
RTMPOSE_MODEL = Path(
    "/Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx"
)
EXTRACTOR = REPO / "extract_side_changes_rtmpose.py"
MATCH_PAD_S = 3.0

GAME_TARGET, CLEAR_BY = 11, 2


def keychain(service: str) -> str:
    return subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", service, "-w"],
        text=True,
    ).strip()


def r2_client():
    import boto3

    account = keychain("ponglens-r2-account")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=keychain("ponglens-r2-key-id"),
        aws_secret_access_key=keychain("ponglens-r2-secret"),
        region_name="auto",
    )


def parse_r2(path: str) -> tuple[str, str]:
    without = path.removeprefix("r2://")
    bucket, _, key = without.partition("/")
    return bucket, key


# --- ground truth -----------------------------------------------------------

def game_winner(you: int, them: int) -> str | None:
    if max(you, them) < GAME_TARGET or abs(you - them) < CLEAR_BY:
        return None
    return "user" if you > them else "opponent"


def walk_boundaries(points: list[dict]) -> list[dict]:
    """Eval-only port of gameScore.ts stepBoundaryWalk.

    The TS walk is the single boundary authority for product surfaces;
    this port exists so a Python harness can read the same truth, and any
    drift between the two shows up as eval noise, not user-facing state.
    Returns the closing point rows.
    """
    you = them = 0
    open_hold = False
    closing = []
    for p in points:
        winner = p["confirmed_winner"] if not p["is_let"] else None
        if winner == "user":
            you += 1
        elif winner == "opponent":
            them += 1
        override = p["game_end_override"]
        if override == "end":
            ends = True
        elif override == "continue":
            open_hold = True
            ends = False
        elif open_hold or winner is None:
            ends = False
        else:
            ends = game_winner(you, them) is not None
        if ends:
            closing.append(p)
            you = them = 0
            open_hold = False
    return closing


def load_truth(cur, match_id: str) -> dict:
    cur.execute(
        """
        select p.id, p.idx, p.t0::float as t0, p.t1::float as t1,
               coalesce(p.is_let, false) as is_let,
               p.confirmed_winner, p.game_end_override
        from public.points p
        where p.match_id = %s and coalesce(p.deleted, false) = false
        order by p.t0 nulls last, p.idx
        """,
        (match_id,),
    )
    points = [dict(r) for r in cur.fetchall()]
    scored = [p for p in points if not p["is_let"]]
    fully = bool(scored) and all(
        p["confirmed_winner"] is not None for p in scored
    )
    closing = walk_boundaries(points)
    boundaries = []
    for close in closing:
        if not fully and close["game_end_override"] != "end":
            continue  # auto boundaries are unreliable on partial scoring
        after = [
            p for p in points
            if p["t0"] is not None
            and close["t1"] is not None
            and p["t0"] > close["t1"]
        ]
        nxt = after[0] if after else None
        if nxt is None:
            # The final game's close has no following point — there is no
            # after-configuration to observe, so a side-swap detector
            # cannot see it even in principle. Not part of the truth.
            continue
        boundaries.append(
            {
                "point_id": str(close["id"]),
                "idx": close["idx"],
                "gap_t0": float(close["t1"]) if close["t1"] is not None else None,
                "gap_t1": float(nxt["t0"]) if nxt["t0"] is not None else None,
            }
        )
    return {
        "points": points,
        "fully_scored": fully,
        "boundaries": [b for b in boundaries if b["gap_t0"] is not None],
    }


# --- media ------------------------------------------------------------------

def fetch_match_media(client, match: dict, dest: Path) -> Path | None:
    """Download match.json + point clips into dest; returns match.json path."""
    dest.mkdir(parents=True, exist_ok=True)
    bucket, key = parse_r2(match["match_json_path"])
    match_json = dest / "match.json"
    if not match_json.exists():
        client.download_file(bucket, key, str(match_json))
    parsed = json.loads(match_json.read_text())
    calibration = parsed.get("calibration") or {}
    if calibration.get("ok") is False or "table_corners_px" not in calibration:
        return None
    prefix = key.rsplit("/", 1)[0]
    for point in parsed.get("points") or []:
        clip = str(point.get("clip") or "").split("/")[-1]
        if not clip:
            continue
        local = dest / clip
        if local.exists() and local.stat().st_size > 0:
            continue
        client.download_file(bucket, f"{prefix}/{clip}", str(local))
    return match_json


# --- scoring ----------------------------------------------------------------

def score_match(evidence: dict, truth: dict) -> dict:
    detected = [
        c for c in evidence.get("side_changes") or [] if c.get("confirmed")
    ]
    by_idx = {int(p["idx"]): p for p in evidence.get("points") or []}
    intervals = []
    for change in detected:
        a = by_idx.get(int(change["after_idx"]))
        b = by_idx.get(int(change["before_idx"]))
        if not a or not b:
            continue
        intervals.append(
            {
                "t0": float(a["t1"]) - MATCH_PAD_S,
                "t1": float(b["t0"]) + MATCH_PAD_S,
                "change": change,
            }
        )
    hits, false_pos = [], []
    matched_truth = set()
    for interval in intervals:
        hit = None
        for i, boundary in enumerate(truth["boundaries"]):
            # Interval overlap, not midpoint: the truth gap runs to the
            # next VISIBLE point while the evidence may end at a since-
            # deleted junk card inside the same break, so the two windows
            # describe one gap at different lengths.
            b0 = boundary["gap_t0"]
            b1 = boundary["gap_t1"] if boundary["gap_t1"] is not None else b0
            if interval["t0"] <= b1 and b0 <= interval["t1"]:
                hit = i
                break
        if hit is not None:
            matched_truth.add(hit)
            hits.append(interval)
        else:
            false_pos.append(interval)
    misses = [
        b for i, b in enumerate(truth["boundaries"])
        if i not in matched_truth
    ]
    return {
        "true_boundaries": len(truth["boundaries"]),
        "detected_confirmed": len(intervals),
        "hits": len(hits),
        "false_positives": [
            {
                "gap": [round(i["t0"] + MATCH_PAD_S, 1),
                        round(i["t1"] - MATCH_PAD_S, 1)],
                "confidence": i["change"]["confidence"],
                "components": i["change"]["components"],
            }
            for i in false_pos
        ],
        "misses": [
            {"idx": m["idx"], "gap_t0": m["gap_t0"], "gap_t1": m["gap_t1"]}
            for m in misses
        ],
    }


def rescore_from_summaries(evidence: dict, config: dict | None) -> dict:
    """Re-run the pure state machine over stored point summaries with new
    thresholds, without re-running pose. Evidence carries the raw
    per-frame signatures, so qualification (trim + spread) is re-derived
    from scratch and every threshold can be swept offline."""
    sys.path.insert(0, str(REPO.parent))
    from worker.side_change import (
        detect_side_changes,
        merge_config,
        summarize_point_side,
    )

    cfg = merge_config(config)
    points = json.loads(json.dumps(evidence.get("points") or []))
    for p in points:
        for side in ("near", "far"):
            summary = p.get(side)
            if not summary:
                continue
            samples = summary.get("samples")
            if samples:
                p[side] = summarize_point_side(
                    samples, float(cfg["spread_max"])
                )
            else:
                spread = summary.get("spread")
                summary["ok"] = summary.get("frames", 0) >= 2 and (
                    spread is None
                    or float(spread) <= float(cfg["spread_max"])
                )
        p["qualified"] = bool(
            p.get("near") and p.get("far")
            and p["near"]["ok"] and p["far"]["ok"]
        )
    detection = detect_side_changes(points, cfg)
    return {**evidence, **detection}


def persist_evidence(conn, cur, match_id: str, evidence: dict) -> str:
    """Backfill one match's compact evidence; returns what happened."""
    sys.path.insert(0, str(REPO.parent))
    from worker.side_change import compact_evidence, map_point_ids

    cur.execute(
        "select match_type, "
        "match_structure->>'status' as existing_status, "
        "match_structure->>'algorithm' as existing_algorithm "
        "from public.matches where id = %s",
        (match_id,),
    )
    row = cur.fetchone()
    if not row:
        return "skipped: no match row"
    match_type = row["match_type"]
    existing_status = row["existing_status"]
    existing_algorithm = row["existing_algorithm"]
    if match_type in ("drills", "practice"):
        return "skipped: non-competitive type"
    if existing_status is not None and not (
        existing_status == "failed"
        or existing_algorithm == "side-change-v2"
    ):
        return "skipped: would overwrite retained v1 evidence"
    cur.execute(
        "select id, idx, t0::float as t0, t1::float as t1 "
        "from public.points where match_id = %s",
        (match_id,),
    )
    points_by_idx = {
        int(r["idx"]): {"id": r["id"], "t0": r["t0"], "t1": r["t1"]}
        for r in cur.fetchall()
    }
    try:
        mapped = map_point_ids(evidence, points_by_idx)
    except ValueError as exc:
        return f"skipped: {exc}"
    cur.execute(
        "update public.matches set match_structure = %s where id = %s",
        (json.dumps(compact_evidence(mapped)), match_id),
    )
    conn.commit()
    confirmed = sum(
        1 for c in mapped.get("side_changes") or [] if c.get("confirmed")
    )
    return f"persisted ({confirmed} confirmed)"


# --- driver -----------------------------------------------------------------

def select_matches(cur, args) -> list[dict]:
    if args.match:
        cur.execute(
            """
            select m.id, m.opponent_name, m.match_type, m.match_json_path,
                   m.story_crop->>'camera' as camera
            from public.matches m where m.id = any(%s::uuid[])
            """,
            (args.match,),
        )
        return [dict(r) for r in cur.fetchall()]
    cur.execute(
        """
        select m.id, m.opponent_name, m.match_type, m.match_json_path,
               m.story_crop->>'camera' as camera
        from public.matches m
        where m.status = 'ready' and m.match_json_path is not null
          and exists (
            select 1 from public.points p
            where p.match_id = m.id and coalesce(p.deleted, false) = false
              and (p.game_end_override = 'end'
                   or p.confirmed_winner is not null)
          )
        order by m.created_at
        """
    )
    rows = [dict(r) for r in cur.fetchall()]
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--match", nargs="*", help="explicit match ids")
    parser.add_argument("--all-truth", action="store_true")
    parser.add_argument("--workdir", type=Path, default=DEFAULT_WORKDIR)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--samples", type=int, default=7)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--config", type=str, default=None,
        help="JSON threshold overrides for side_change",
    )
    parser.add_argument(
        "--no-extract", action="store_true",
        help="rescore existing evidence.json files with --config only",
    )
    parser.add_argument(
        "--persist", action="store_true",
        help=(
            "backfill: write compact evidence to matches.match_structure "
            "for the selected matches. Skips drills/practice, and never "
            "overwrites anything except null or status='failed' artifacts "
            "(the two dead 2026-07 rollout rows). Display stays gated by "
            "app_config.game_end_detection either way."
        ),
    )
    args = parser.parse_args()
    if not args.match and not args.all_truth:
        parser.error("pass --all-truth or --match <id> ...")
    overrides = json.loads(args.config) if args.config else None

    conn = psycopg2.connect(keychain("ponglens-db-url"))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    matches = select_matches(cur, args)
    if args.limit:
        matches = matches[: args.limit]
    client = None if args.no_extract else r2_client()

    results = []
    for match in matches:
        match_id = str(match["id"])
        dest = args.workdir / match_id
        evidence_path = dest / "evidence.json"
        truth = load_truth(cur, match_id)
        # An --all-truth sweep only wants judgeable matches; an explicit
        # --match is an extraction/backfill target and runs regardless.
        if (
            not args.match
            and not truth["boundaries"]
            and not truth["fully_scored"]
        ):
            continue
        row = {
            "match_id": match_id,
            "opponent": match["opponent_name"],
            "type": match["match_type"],
            "camera": match["camera"],
            "points": len(truth["points"]),
            "fully_scored": truth["fully_scored"],
        }
        try:
            if not args.no_extract:
                media = fetch_match_media(client, match, dest)
                if media is None:
                    row["skip"] = "no usable calibration in match.json"
                    results.append(row)
                    print(f"skip {match_id[:8]}: no calibration")
                    continue
                if not evidence_path.exists():
                    started = time.perf_counter()
                    subprocess.run(
                        [
                            str(RTMPOSE_PY), str(EXTRACTOR),
                            "--clips-dir", str(dest),
                            "--match-json", str(media),
                            "--output", str(evidence_path),
                            "--model", str(RTMPOSE_MODEL),
                            "--device", args.device,
                            "--samples", str(args.samples),
                        ],
                        check=True,
                        timeout=30 * 60,
                    )
                    row["extract_s"] = round(
                        time.perf_counter() - started, 1
                    )
            if not evidence_path.exists():
                row["skip"] = "no evidence extracted"
                results.append(row)
                continue
            evidence = json.loads(evidence_path.read_text())
            if overrides or args.no_extract:
                evidence = rescore_from_summaries(evidence, overrides)
            if args.persist:
                row["persisted"] = persist_evidence(
                    conn, cur, match_id, evidence
                )
            row["status"] = evidence.get("status")
            row["qualified"] = (
                f"{sum(1 for p in evidence.get('points') or [] if p.get('qualified'))}"
                f"/{len(evidence.get('points') or [])}"
            )
            row["foreshortening"] = evidence.get("foreshortening")
            row["flips_total"] = evidence.get("flips_total")
            row.update(score_match(evidence, truth))
        except Exception as exc:  # keep the sweep alive, record why
            row["error"] = f"{type(exc).__name__}: {exc}"
        results.append(row)
        print(
            f"{match_id[:8]} {str(row.get('type')):>10} "
            f"cam={str(row.get('camera'))} "
            f"truth={row.get('true_boundaries')} "
            f"hits={row.get('hits')} "
            f"fp={len(row.get('false_positives') or [])} "
            f"status={row.get('status')} q={row.get('qualified')}"
            + (f" ERR {row['error']}" if row.get("error") else "")
        )

    fully = [r for r in results if r.get("fully_scored") and "hits" in r]
    pins = [
        r for r in results if not r.get("fully_scored") and "hits" in r
    ]
    tp = sum(r["hits"] for r in fully)
    fp = sum(len(r["false_positives"]) for r in fully)
    fn = sum(r["true_boundaries"] - r["hits"] for r in fully)
    unverified = sum(len(r["false_positives"]) for r in pins)
    pin_tp = sum(r["hits"] for r in pins)
    pin_total = sum(r["true_boundaries"] for r in pins)
    print("\n== fully-scored matches (precision is meaningful) ==")
    print(f"  matches={len(fully)}  TP={tp}  FP={fp}  FN={fn}")
    if tp + fp:
        print(f"  precision={tp / (tp + fp):.2%}", end="  ")
    if tp + fn:
        print(f"recall={tp / (tp + fn):.2%}")
    print("== pin-only matches (recall on pins; extra fires unverified) ==")
    print(
        f"  matches={len(pins)}  pins hit={pin_tp}/{pin_total}  "
        f"unverified fires={unverified}"
    )
    out = args.workdir / "eval-results.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2, default=str) + "\n")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
