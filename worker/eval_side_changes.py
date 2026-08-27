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

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from worker import game_truth

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
# How many rallies of scoring drift a hit may forgive; see score_match.
TOLERANCE_RALLIES = 3

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
#
# The walk itself lives in game_truth.py, which reads truth per GAME rather
# than per match. The old rule here — trust a match only if every non-let
# point in it carries a winner — was a match-level gate on a point-level
# fact, and it threw away most of the corpus: a player scores two games
# carefully then stops, and the two proven boundaries go with the rest.
# Per-game truth takes the corpus from 57 boundaries to 122.


def load_truth(cur, match_id: str) -> dict:
    cur.execute(
        """
        select p.id, p.idx, p.t0::float as t0, p.t1::float as t1,
               coalesce(p.is_let, false) as is_let,
               p.confirmed_winner, p.game_end_override,
               coalesce(p.deleted, false) as deleted
        from public.points p
        where p.match_id = %s
        order by p.t0 nulls last, p.idx
        """,
        (match_id,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    live = [r for r in rows if not r["deleted"]]
    deleted = [r for r in rows if r["deleted"]]
    truth = game_truth.boundaries(live, deleted)
    return {
        "points": live,
        "deleted": deleted,
        "fully_scored": truth["fully_scored"],
        "games": truth["games"],
        "boundaries": truth["boundaries"],
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

def _rally_order(evidence: dict) -> tuple[dict[int, dict], dict[int, int]]:
    by_idx = {int(p["idx"]): p for p in evidence.get("points") or []}
    order = sorted(by_idx)
    return by_idx, {idx: position for position, idx in enumerate(order)}


def _gap_after(by_idx: dict, order: list[int], position: int) -> float | None:
    """The break after the rally at `position`, on the DETECTOR's clock."""
    if position is None or position + 1 >= len(order):
        return None
    before, after = by_idx[order[position]], by_idx[order[position + 1]]
    if before.get("t1") is None or after.get("t0") is None:
        return None
    return float(after["t0"]) - float(before["t1"])


def score_match(
    evidence: dict,
    truth: dict,
    tolerance_rallies: int = TOLERANCE_RALLIES,
) -> dict:
    """Hits, misses and false positives, scored two ways.

    STRICT is time overlap: the detected gap and the truth gap must touch.
    That is the honest default and the number to quote.

    TOLERANT forgives an offset of a few rallies, but only in the one
    direction the video supports. Measured 2026-08-27 over 49 confirmed
    fires: 33 land exactly on the scored boundary, 6 land one to four
    rallies early, and 6 are plainly wrong (26 to 46 rallies away). Every
    one of the six near misses fired on a LONGER break than the scored
    boundary had — 22.5s against 1.2s, 34.0s against 9.7s, 57.5s against
    3.5s. Players walking round a table take longer than a second, so a
    "boundary" with a one-second gap is not where the game ended; the
    owner's score drifted by a rally or two and the detector found the
    actual changeover. game_end_override is defined as the video's visible
    side switch (migration 021), so that IS the thing being detected.

    The `gap_fire >= gap_truth` condition is what keeps this from being a
    free pass: an offset is only forgiven when the physical evidence says
    the score, not the detector, is the thing that moved.
    """
    detected = [
        c for c in evidence.get("side_changes") or [] if c.get("confirmed")
    ]
    by_idx, position_of = _rally_order(evidence)
    order = sorted(by_idx)
    fires = []
    for change in detected:
        a = by_idx.get(int(change["after_idx"]))
        b = by_idx.get(int(change["before_idx"]))
        if not a or not b:
            continue
        position = position_of.get(int(change["after_idx"]))
        fires.append(
            {
                "t0": float(a["t1"]) - MATCH_PAD_S,
                "t1": float(b["t0"]) + MATCH_PAD_S,
                "position": position,
                "gap": _gap_after(by_idx, order, position),
                "change": change,
            }
        )
    targets = []
    for boundary in truth["boundaries"]:
        position = position_of.get(int(boundary["idx"]))
        targets.append(
            {
                "b0": boundary["gap_t0"],
                "b1": boundary["gap_t1"]
                if boundary["gap_t1"] is not None else boundary["gap_t0"],
                "position": position,
                "gap": _gap_after(by_idx, order, position),
                "boundary": boundary,
            }
        )

    taken: dict[int, str] = {}
    verdicts = []
    for fire in fires:
        hit, how = None, None
        for i, target in enumerate(targets):
            if i in taken:
                continue
            if fire["t0"] <= target["b1"] and target["b0"] <= fire["t1"]:
                hit, how = i, "strict"
                break
        if hit is None:
            for i, target in enumerate(targets):
                if i in taken or target["position"] is None:
                    continue
                if fire["position"] is None:
                    continue
                if abs(target["position"] - fire["position"]) > tolerance_rallies:
                    continue
                if (
                    fire["gap"] is not None
                    and target["gap"] is not None
                    and fire["gap"] >= target["gap"]
                ):
                    hit, how = i, "drift"
                    break
        if hit is not None:
            taken[hit] = how
        verdicts.append((fire, hit, how))

    strict_hits = sum(1 for h in taken.values() if h == "strict")
    drift_hits = sum(1 for h in taken.values() if h == "drift")
    false_pos = [f for f, hit, _ in verdicts if hit is None]
    misses = [
        t["boundary"] for i, t in enumerate(targets) if i not in taken
    ]
    return {
        "true_boundaries": len(targets),
        "detected_confirmed": len(fires),
        "hits": strict_hits,
        "drift_hits": drift_hits,
        "hits_tolerant": strict_hits + drift_hits,
        "false_positives": [
            {
                "gap": [round(f["t0"] + MATCH_PAD_S, 1),
                        round(f["t1"] - MATCH_PAD_S, 1)],
                "gap_s": round(f["gap"], 1) if f["gap"] is not None else None,
                "confidence": f["change"]["confidence"],
                "components": f["change"]["components"],
            }
            for f in false_pos
        ],
        "misses": [
            {"idx": m["idx"], "tier": m["tier"],
             "gap_t0": m["gap_t0"], "gap_t1": m["gap_t1"]}
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
    tp_tol = sum(r["hits_tolerant"] for r in fully)
    fp = sum(len(r["false_positives"]) for r in fully)
    fn = sum(r["true_boundaries"] - r["hits"] for r in fully)
    fn_tol = sum(r["true_boundaries"] - r["hits_tolerant"] for r in fully)
    fp_tol = sum(len(r["false_positives"]) for r in fully)
    unverified = sum(len(r["false_positives"]) for r in pins)
    pin_tp = sum(r["hits"] for r in pins)
    pin_total = sum(r["true_boundaries"] for r in pins)
    print("\n== fully-scored matches (precision is meaningful) ==")
    print(f"  matches={len(fully)}  TP={tp}  FP={fp}  FN={fn}")
    if tp + fp:
        print(f"  precision={tp / (tp + fp):.2%}", end="  ")
    if tp + fn:
        print(f"recall={tp / (tp + fn):.2%}")
    print(f"  tolerant (forgiving <=3 rallies of scoring drift): "
          f"TP={tp_tol} FP={fp_tol} FN={fn_tol}", end="  ")
    if tp_tol + fp_tol:
        print(f"precision={tp_tol / (tp_tol + fp_tol):.2%}", end="  ")
    if tp_tol + fn_tol:
        print(f"recall={tp_tol / (tp_tol + fn_tol):.2%}")
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
