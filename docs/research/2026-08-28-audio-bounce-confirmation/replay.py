"""Rebuild each point's placement, with and without audio, for the ruler.

  ./venv/bin/python replay.py <corpus-dir> <work-dir> <out-dir> [--arms ...]

The reconstruction is `reconstruct_existing_match`, imported from
worker/placement_backfill.py — the production function the placement
backfill and the retry both run, and it has taken an `audio_impacts`
argument since the day it was written. So this file supplies an argument
and changes no rule.

The inputs are production's own: match.json's stored calibration, which is
the quad that drew the maps now in the database, and the point windows from
the points table. Only the ball track is re-derived, and step one of the
whole measurement is checking that re-derivation reproduces what the
database holds.

An arm is `threshold:blend:rescue[:rescueonly]` — the detector's z-score
floor, the two matching tolerances inside extract_candidates, and whether
to run the rescue branch alone. `none` is production.

`rescueonly` turns off the two mechanisms that are not aimed at the missing
landing: the blend, which raises the confidence of events that already
exist including ones with no table coordinates, and the standalone impact
candidate, which invents an event where there is sound and no visual
evidence. What is left is the branch this experiment is about.

`ontable` keeps the rescue and the blend but refuses to raise an event that
has no table coordinates, and drops the standalone impact candidate. It is
the minimal correction to the damage the first arms measure: an event we
cannot draw should not be able to outscore one we can.

Writes <out-dir>/<arm>/<slug>.json = {point_id: placement}, plus a
counts.json recording how many candidates each mechanism produced, so the
result can be attributed to the branch that caused it rather than guessed
at from the totals.

THE SCAFFOLD THIS NEEDS IN PRODUCTION
-------------------------------------
Five module-level names in `worker/placement_reconstruction.py`, all
defaulting to what the module has always done. If the measurement said not
to ship and they have been reverted, re-apply them to re-run:

  1. above `def _audio_time`, add

        AUDIO_BLEND_TOLERANCE_S = 0.09
        AUDIO_RESCUE_TOLERANCE_S = 0.09
        AUDIO_BLEND_ENABLED = True
        AUDIO_IMPACT_CANDIDATES_ENABLED = True
        AUDIO_BLEND_REQUIRES_TABLE_COORDS = False

  2. in `extract_candidates`, replace the literal `0.09` in the
     `audio_supported_short_bounce` test with AUDIO_RESCUE_TOLERANCE_S;

  3. in the blend loop, replace

        for event in candidates:
            match = _attach_audio(event, impacts, tolerance_s=0.09)

     with

        for event in candidates:
            if not AUDIO_BLEND_ENABLED or (
                AUDIO_BLEND_REQUIRES_TABLE_COORDS
                and (event.get("u") is None or event.get("v") is None)
            ):
                event["audio_confidence"] = 0.0
                continue
            match = _attach_audio(
                event, impacts, tolerance_s=AUDIO_BLEND_TOLERANCE_S)

  4. add `if not AUDIO_IMPACT_CANDIDATES_ENABLED: break` as the first line
     of the loop over unused impacts.

At the defaults that is the shipped function line for line, which is what
lets the honesty check below prove the harness is honest. Verify it the way
this study did, against the committed copy:

    git show HEAD:worker/placement_reconstruction.py > /tmp/old.py

and compare `extract_candidates` output on the same input with an empty
impact list and a populated one. Both must be byte-identical.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import audio_impacts as AUDIO
import placement_reconstruction as RECON
from placement_backfill import load_detections, reconstruct_existing_match

DEFAULT_ARMS = ["3.0:0.09:0.09", "3.0:0.05:0.03", "5.0:0.05:0.03",
                "3.0:0.09:0.09:rescueonly", "3.0:0.05:0.03:rescueonly",
                "5.0:0.05:0.03:rescueonly",
                "3.0:0.05:0.03:ontable", "3.0:0.09:0.09:ontable"]


def candidate_counts(placements):
    """What the audio actually built, by mechanism."""
    counts = {"candidates": 0, "bounce": 0, "contact": 0, "impact_only": 0,
              "audio_rescued_bounce": 0, "with_audio_confidence": 0}
    for placement in placements.values():
        for candidate in placement.get("candidates") or []:
            counts["candidates"] += 1
            kind = candidate.get("kind")
            if kind == "impact":
                counts["impact_only"] += 1
            elif kind in ("bounce", "contact"):
                counts[kind] += 1
            if candidate.get("audio_supported_short_peak"):
                counts["audio_rescued_bounce"] += 1
            if float(candidate.get("audio_confidence") or 0) > 0:
                counts["with_audio_confidence"] += 1
    return counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("corpus")
    parser.add_argument("work")
    parser.add_argument("out")
    parser.add_argument("--arms", nargs="*", default=DEFAULT_ARMS)
    parser.add_argument("--offset", type=float, default=0.0,
                        help="seconds added to every impact time")
    parser.add_argument("--only", default=None)
    parser.add_argument("--impacts-dir", default=None,
                        help="read <slug>.json impact lists from here instead "
                             "of running the detector; the arm's threshold is "
                             "then only a floor applied to what is read")
    parser.add_argument("--band", default="lo", choices=("lo", "hi"),
                        help="lo = 1.5-8 kHz (this study's first detector); "
                             "hi = 10 kHz+ (the Sony AI pipeline's cutoff, "
                             "measured 87%% against 72%% on production's own "
                             "visual bounces at matched impact density)")
    args = parser.parse_args()

    manifest = json.load(open(os.path.join(args.corpus, "manifest.json")))
    summary = {}
    for entry in manifest:
        slug = entry["slug"]
        if args.only and slug != args.only:
            continue
        work = os.path.join(args.work, slug)
        blurball = Path(work) / "blurball.jsonl"
        if not blurball.exists():
            print(f"{slug}: no blurball yet, skipped", flush=True)
            continue
        match_json = json.load(open(os.path.join(work, "match.json")))
        rows = json.load(open(os.path.join(args.corpus, f"{slug}.json")))
        points = [dict(p, t0=float(p["t0"]), t1=float(p["t1"]))
                  for p in rows["points"] if not p["deleted"]]
        detections = load_detections(blurball)

        cache = {}
        for arm in ["none"] + list(args.arms):
            if arm == "none":
                impacts = []
            else:
                parts = arm.split(":")
                threshold, blend, rescue = (float(v) for v in parts[:3])
                mode = parts[3] if len(parts) > 3 else ""
                rescue_only = mode == "rescueonly"
                band = (AUDIO.BALL_BAND if args.band == "lo"
                        else AUDIO.HIGH_BAND)
                if args.impacts_dir:
                    if "file" not in cache:
                        cache["file"] = json.load(open(os.path.join(
                            args.impacts_dir, f"{slug}.json")))
                    impacts = [dict(i, t=i["t"] + args.offset)
                               for i in cache["file"]
                               if i["confidence"] >= threshold]
                else:
                    if threshold not in cache:
                        cache[threshold] = AUDIO.detect(
                            os.path.join(work, "audio.wav"),
                            threshold=threshold, band=band, offset_s=args.offset)
                    impacts = cache[threshold]
                RECON.AUDIO_BLEND_TOLERANCE_S = blend
                RECON.AUDIO_RESCUE_TOLERANCE_S = rescue
                RECON.AUDIO_BLEND_ENABLED = not rescue_only
                RECON.AUDIO_IMPACT_CANDIDATES_ENABLED = (
                    not rescue_only and mode != "ontable")
                RECON.AUDIO_BLEND_REQUIRES_TABLE_COORDS = mode == "ontable"
            placements = reconstruct_existing_match(
                match_json, points, detections,
                match_json.get("calibration"), impacts)
            RECON.AUDIO_BLEND_TOLERANCE_S = 0.09
            RECON.AUDIO_RESCUE_TOLERANCE_S = 0.09
            RECON.AUDIO_BLEND_ENABLED = True
            RECON.AUDIO_IMPACT_CANDIDATES_ENABLED = True
            RECON.AUDIO_BLEND_REQUIRES_TABLE_COORDS = False
            by_id = {p["id"]: placements[int(p["idx"])] for p in points}
            out_dir = os.path.join(args.out, arm)
            os.makedirs(out_dir, exist_ok=True)
            json.dump(by_id, open(os.path.join(out_dir, f"{slug}.json"), "w"))
            counts = candidate_counts(placements)
            summary.setdefault(arm, {})[slug] = dict(
                counts, impacts=len(impacts))
            print(f"{slug:9s} {arm:14s} {len(impacts):5d} impacts  "
                  + "  ".join(f"{k}={v}" for k, v in counts.items()),
                  flush=True)
    json.dump(summary, open(os.path.join(args.out, "counts.json"), "w"),
              indent=2)


if __name__ == "__main__":
    main()
