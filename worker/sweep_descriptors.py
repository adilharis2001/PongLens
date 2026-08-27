#!/usr/bin/env python3
"""Choose the player-appearance descriptor by measurement, not by opinion.

The extractor stores every candidate descriptor for every sampled frame
(see player_descriptors). This sweeps them against the corpus's own scored
game boundaries and prints what each one actually buys.

Thresholds cannot be shared across descriptors. A median BGR triple and a
36-bin square-rooted histogram live on different rulers, so a spread gate
of 0.16 means "quite strict" to one and "wide open" to the other. Each
descriptor therefore gets its grid built from ITS OWN measured distance
distribution: the spread gate from the spread of frames within one rally,
the switch penalty from how far apart the two players sit. Comparing
descriptors at a shared literal threshold would be comparing tunings.

  worker/venv/bin/python -m worker.sweep_descriptors
  worker/venv/bin/python -m worker.sweep_descriptors --descriptor hs_cc --detail
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from worker.eval_side_changes import (  # noqa: E402
    DEFAULT_WORKDIR, keychain, load_truth, score_match,
)
from worker.side_change import (  # noqa: E402
    _distance, detect_side_changes, merge_config, summarize_point_side,
)

NAMES = (
    # the baseline, and the same statistic on a masked polygon: the gap
    # between these two is what the masking alone bought
    "bgr",
    # single-statistic colour, illumination-reduced
    "lab", "rg", "lab_tc", "bgr_tc", "legs_lab",
    # the tails the median throws away, banded over a rectified body
    "lab_q", "lab_q_tc",
    # identity that survives a change of light by construction
    "logdiff", "geom",
    # distributions, which survive an arm across the shirt
    "hs_up", "hs_low", "cn_up", "cn_low",
    # joins
    "lab_q+logdiff", "lab_q+geom", "hs_up+hs_low", "cn_up+cn_low",
    "lab+legs_lab", "logdiff+geom",
)


def compose(
    frame: dict,
    name: str,
    allow_ambiguous: bool = False,
) -> list[float] | None:
    """One frame's vector, or None when the frame should not be used.

    A frame the chooser would not commit to — two people at one end of
    nearly the same size — is skipped unless the sweep asks for it. That
    gate is worth about a tenth of all points and used to be decided at
    extraction time; it is a filter now so its cost is measurable.
    """
    if not allow_ambiguous and (frame.get("_amb") or [0.0])[0] > 0.5:
        return None
    return _compose(frame, name)


def _compose(frame: dict, name: str) -> list[float] | None:
    """One frame's vector for a named descriptor, including joins.

    A '+' joins two regions into one vector. Both halves must be present:
    half a signature compared against a whole one is not a comparison.
    """
    if "+" in name:
        out: list[float] = []
        for part in name.split("+"):
            piece = frame.get(part)
            if not piece:
                return None
            out.extend(piece)
        return out
    return frame.get(name)


def align_ends(points: list[dict]) -> list[dict]:
    """Remove the average difference between the two ends of the table.

    The second answer to the illumination problem, and the one that needs
    no table quad. Pool every near-end signature in the match and every
    far-end signature, and subtract each pool's own mean: whatever is
    systematically different about standing at the far end comes out, and
    the difference between the two PLAYERS stays, because over a match
    with at least one changeover both of them appear in both pools.

    The bias to respect, stated plainly: this is only clean if the two
    players spend comparable time at each end. A match whose first game
    ran to 11-2 and whose second went to deuce loads one pool more than
    the other, and some real between-player difference is removed with
    the end effect. It is a candidate to measure, not a free win.
    """
    pools: dict[str, list[list[float]]] = {"near": [], "far": []}
    for point in points:
        for side in ("near", "far"):
            summary = point.get(side)
            if summary and summary.get("ok"):
                pools[side].append(summary["sig"])
    if len(pools["near"]) < 4 or len(pools["far"]) < 4:
        return points
    width = min(len(v) for side in pools for v in pools[side])
    means = {
        side: [
            sum(v[d] for v in vectors) / len(vectors)
            for d in range(width)
        ]
        for side, vectors in pools.items()
    }
    middle = [(means["near"][d] + means["far"][d]) / 2.0
              for d in range(width)]
    for point in points:
        for side in ("near", "far"):
            summary = point.get(side)
            if not summary:
                continue
            summary["sig"] = [
                summary["sig"][d] - means[side][d] + middle[d]
                for d in range(width)
            ]
    return points


def rebuild(evidence: dict, name: str, spread_max: float,
            allow_ambiguous: bool = False,
            aligned: bool = False) -> dict:
    """One descriptor's evidence, summarised per point.

    Deliberately built ONCE per descriptor and then re-gated, because the
    signature and the spread do not depend on spread_max — only the
    pass/fail flag does. Rebuilding for every threshold in the grid meant
    walking the whole corpus eight hundred times to answer a question the
    first pass had already answered.
    """
    points = []
    for point in evidence.get("points") or []:
        bank = point.get("bank") or {}
        rebuilt = dict(point)
        rebuilt.pop("bank", None)
        for side in ("near", "far"):
            frames = [
                vector
                for vector in (
                    compose(frame, name, allow_ambiguous)
                    for frame in bank.get(side) or []
                )
                if vector
            ]
            rebuilt[side] = (
                summarize_point_side(frames, spread_max) if frames else None
            )
        points.append(rebuilt)
    if aligned:
        points = align_ends(points)
    for point in points:
        point["qualified"] = bool(
            point["near"] and point["far"]
            and point["near"]["ok"] and point["far"]["ok"]
        )
    return {**evidence, "points": points}


def regate(prepared: dict, spread_max: float) -> list[dict]:
    """The same summaries, re-judged against a different spread gate."""
    points = []
    for point in prepared["points"]:
        copy = dict(point)
        for side in ("near", "far"):
            summary = copy.get(side)
            if not summary:
                continue
            summary = dict(summary)
            spread = summary.get("spread")
            summary["ok"] = summary.get("frames", 0) >= 2 and (
                spread is None or float(spread) <= spread_max)
            copy[side] = summary
        copy["qualified"] = bool(
            copy["near"] and copy["far"]
            and copy["near"]["ok"] and copy["far"]["ok"])
        points.append(copy)
    return points


def scales(prepared: dict) -> dict[str, float]:
    """The descriptor's own rulers, read off the corpus.

    within: how far apart two frames of ONE player in ONE rally sit. The
            spread gate has to sit above most of this or nothing
            qualifies.
    apart:  how far apart the two DIFFERENT players sit. The switch
            penalty has to sit below this or nothing ever fires.

    Thresholds do not transfer between descriptors — a Hellinger distance
    and a sixty-float quantile vector are not on the same ruler — so every
    grid is fitted here rather than shared. Sweeping two descriptors
    against one literal threshold would be comparing tunings.
    """
    within, apart = [], []
    for evidence in prepared.values():
        for point in evidence["points"]:
            near, far = point.get("near"), point.get("far")
            for summary in (near, far):
                if summary and summary.get("spread") is not None:
                    within.append(float(summary["spread_raw"]))
            if near and far:
                apart.append(_distance(near["sig"], far["sig"]))
    return {
        "within_p50": statistics.median(within) if within else 0.0,
        "apart_p50": statistics.median(apart) if apart else 0.0,
        "samples": len(within),
    }


def evaluate(prepared: dict, truths: dict, config: dict) -> dict:
    tp = fp = fn = drift = 0
    qualified = total = withheld = 0
    detail = []
    for match_id, evidence in prepared.items():
        points = regate(evidence, float(config["spread_max"]))
        qualified += sum(1 for p in points if p["qualified"])
        total += len(points)
        result = {**evidence, "points": points,
                  **detect_side_changes(points, config)}
        if result.get("status") != "ready":
            withheld += 1
        truth = truths[match_id]
        score = score_match(result, truth)
        hits = score["hits_tolerant"]
        drift += score["drift_hits"]
        tp += hits
        fn += score["true_boundaries"] - hits
        if truth["fully_scored"]:
            fp += len(score["false_positives"])
        detail.append({
            "match": match_id[:8], "truth": score["true_boundaries"],
            "hits": hits, "fp": len(score["false_positives"]),
            "status": result.get("status"),
            "coverage": f"{sum(1 for p in points if p['qualified'])}/"
                        f"{len(points)}",
            "separability": result.get("separability"),
            "contradiction": result.get("contradiction"),
            "reason": result.get("reason"),
        })
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {
        "tp": tp, "fp": fp, "fn": fn, "drift_hits": drift,
        "withheld_matches": withheld,
        "precision": precision, "recall": recall,
        "f1": (2 * precision * recall / (precision + recall)
               if precision + recall else 0.0),
        "coverage": qualified / total if total else 0.0,
        "config": config, "detail": detail,
    }


def load_cache(workdir: Path, cur) -> dict:
    cache = {}
    for directory in sorted(workdir.iterdir()):
        evidence_path = directory / "evidence.json"
        if directory.is_file() or not evidence_path.exists():
            continue
        evidence = json.loads(evidence_path.read_text())
        if not (evidence.get("points") or [{}])[0].get("bank"):
            continue  # v2 evidence, no descriptor bank
        truth = load_truth(cur, directory.name)
        if truth["boundaries"]:
            cache[directory.name] = (evidence, truth)
    return cache


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workdir", type=Path, default=DEFAULT_WORKDIR)
    parser.add_argument("--descriptor", nargs="*", default=list(NAMES))
    parser.add_argument("--detail", action="store_true")
    parser.add_argument(
        "--ambiguous", action="store_true",
        help="also use frames the player chooser would not commit to")
    parser.add_argument(
        "--align", action="store_true",
        help="subtract each end's own mean signature before comparing")
    parser.add_argument(
        "--tune", action="store_true",
        help="after picking a descriptor, sweep the state machine too")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    conn = psycopg2.connect(keychain("ponglens-db-url"))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cache = load_cache(args.workdir, cur)
    truths = {mid: truth for mid, (_, truth) in cache.items()}
    boundaries = sum(len(t["boundaries"]) for _, t in cache.values())
    print(f"{len(cache)} matches, {boundaries} scored boundaries\n")

    results = []
    for name in args.descriptor:
        prepared = {
            match_id: rebuild(evidence, name, 1e9,
                              args.ambiguous, args.align)
            for match_id, (evidence, _) in cache.items()
        }
        ruler = scales(prepared)
        if not ruler["samples"]:
            print(f"{name}: not present in the evidence")
            continue
        best = None
        for spread in (ruler["within_p50"] * m
                       for m in (0.8, 1.2, 1.8, 2.6)):
            for penalty in (ruler["apart_p50"] * m
                            for m in (0.2, 0.35, 0.5, 0.7, 1.0)):
                for floor in (0.0, ruler["apart_p50"] * 0.55):
                    config = merge_config({
                        "spread_max": spread,
                        "switch_penalty": penalty,
                        "min_separability": floor,
                        "verify_margin": ruler["apart_p50"] * 0.1,
                        "confidence_scale": penalty * 2.0,
                    })
                    outcome = evaluate(prepared, truths, config)
                    if best is None or outcome["f1"] > best["f1"]:
                        best = {**outcome, "descriptor": name}
        results.append(best)
        print(
            f"{name:<16} P={best['precision']:6.1%} R={best['recall']:6.1%} "
            f"F1={best['f1']:.3f}  TP={best['tp']:3d} FP={best['fp']:3d} "
            f"FN={best['fn']:3d}  coverage={best['coverage']:5.1%} "
            f"withheld={best['withheld_matches']:2d}  "
            f"(within {ruler['within_p50']:.3f}, "
            f"apart {ruler['apart_p50']:.3f})",
            flush=True,
        )

    if args.tune and results:
        # Second stage: with the descriptor settled, sweep the state
        # machine itself. Kept separate because the two grids answer
        # different questions and multiplying them together would take
        # the sweep from minutes to hours for a joint optimum nobody
        # would trust on 122 boundaries anyway.
        winner = max(results, key=lambda r: r["f1"])
        name = winner["descriptor"]
        base = dict(winner["config"])
        prepared = {
            match_id: rebuild(evidence, name, 1e9,
                              args.ambiguous, args.align)
            for match_id, (evidence, _) in cache.items()
        }
        print(f"\ntuning the state machine on {name}:")
        print(f"{'F1':>6}{'prec':>8}{'rec':>8}{'TP':>5}{'FP':>4}{'FN':>4}"
              f"   link_span link_decay min_segment radius contradiction")
        tuned = []
        for span in (2, 3, 5):
            for decay in (0.4, 0.6, 0.8):
                for floor in (2, 3, 4):
                    for radius in (1, 2, 3):
                        for contradiction in (0.25, 0.35, 0.5):
                            config = merge_config({
                                **base, "link_span": span,
                                "link_decay": decay,
                                "min_segment_points": floor,
                                "confidence_radius": radius,
                                "max_contradiction": contradiction,
                            })
                            outcome = evaluate(prepared, truths, config)
                            tuned.append(outcome)
        tuned.sort(key=lambda r: (-r["f1"], -r["precision"]))
        for outcome in tuned[:10]:
            c = outcome["config"]
            print(f"{outcome['f1']:6.3f}{outcome['precision']:8.1%}"
                  f"{outcome['recall']:8.1%}{outcome['tp']:5d}"
                  f"{outcome['fp']:4d}{outcome['fn']:4d}"
                  f"   {int(c['link_span']):9d} {c['link_decay']:10.1f}"
                  f" {int(c['min_segment_points']):11d}"
                  f" {int(c['confidence_radius']):6d}"
                  f" {c['max_contradiction']:13.2f}")
        print("\nbest precision at recall >= 60%:")
        strong = [t for t in tuned if t["recall"] >= 0.60]
        strong.sort(key=lambda r: (-r["precision"], -r["recall"]))
        for outcome in strong[:6]:
            c = outcome["config"]
            print(f"{outcome['f1']:6.3f}{outcome['precision']:8.1%}"
                  f"{outcome['recall']:8.1%}{outcome['tp']:5d}"
                  f"{outcome['fp']:4d}{outcome['fn']:4d}"
                  f"   span={int(c['link_span'])} decay={c['link_decay']} "
                  f"seg={int(c['min_segment_points'])} "
                  f"radius={int(c['confidence_radius'])} "
                  f"contradiction={c['max_contradiction']}")
        if args.out:
            best = tuned[0]
            Path(str(args.out) + ".tuned").write_text(
                json.dumps({k: v for k, v in best.items() if k != "detail"},
                           indent=1, default=str))

    results.sort(key=lambda r: -r["f1"])
    print("\nbest first:")
    for outcome in results:
        config = outcome["config"]
        print(f"  {outcome['descriptor']:<14} F1={outcome['f1']:.3f}  "
              f"spread_max={config['spread_max']:.3f} "
              f"switch_penalty={config['switch_penalty']:.3f} "
              f"min_separability={config['min_separability']:.3f}")
    if args.detail and results:
        print(f"\nper match, {results[0]['descriptor']}:")
        for row in results[0]["detail"]:
            print(f"  {row['match']} truth={row['truth']} hits={row['hits']} "
                  f"fp={row['fp']} cov={row['coverage']} "
                  f"sep={row['separability']} {row['status']} "
                  f"{row['reason'] or ''}")
    if args.out:
        args.out.write_text(json.dumps(results, indent=1, default=str))
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
