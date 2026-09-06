"""Evaluate the frozen owned candidate model without changing its threshold."""
import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np
import torch

from worker.active_ball_data import validate_dataset
from worker.active_ball_motion import ball_candidates
from worker.active_ball_patches import ActiveBallPatchNet, candidate_geometry, candidate_multiscale_patch
from worker.active_ball_teacher import prediction_from_ranked, score_predictions


def flat_groups(rows, predictions, proposals, key):
    return {value: score_predictions([row for row in rows if row[key] == value], predictions, proposals)
            for value in sorted({row[key] for row in rows})}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--split", choices=("train", "validation", "test", "all"), default="test")
    parser.add_argument("--run-name", required=True)
    args = parser.parse_args()
    all_rows = json.loads(args.manifest.read_text())
    validate_dataset(all_rows, allow_shared_venues=True)
    rows = [row for row in all_rows if row.get("label") and row["label"]["state"] != "unsure" and (args.split == "all" or row["split"] == args.split)]
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    if checkpoint["architecture"] != "active-ball-patch-v3-multiscale-teacher":
        raise ValueError("wrong checkpoint architecture")
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = ActiveBallPatchNet(channels=18).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    predictions, proposals, timings, ranked_output = {}, {}, [], {}
    args.output.mkdir(parents=True, exist_ok=True)
    overlays = args.output / "overlays"
    overlays.mkdir(exist_ok=True)
    with torch.no_grad():
        for index, row in enumerate(rows, 1):
            frames = [cv2.imread(path) for path in row["frames"]]
            if any(frame is None for frame in frames):
                raise ValueError(f"could not decode frames for {row['id']}")
            start = time.perf_counter()
            candidates = ball_candidates(frames)
            dt = (row["frame_times_s"][2] - row["frame_times_s"][0]) / 2
            scores = []
            for offset in range(0, len(candidates), 96):
                batch = candidates[offset:offset + 96]
                patches = torch.stack([candidate_multiscale_patch(frames, c["x"], c["y"]) for c in batch]).to(device)
                geometry = torch.stack([candidate_geometry(c["x"], c["y"], row["corners"], dt) for c in batch]).to(device)
                scores.extend(model(patches, geometry).sigmoid().cpu().tolist())
            ranked = [{**candidate, "score": float(score)} for candidate, score in zip(candidates, scores)]
            predictions[row["id"]] = prediction_from_ranked(ranked, checkpoint["candidate_threshold"], checkpoint["ambiguity_margin"])
            timings.append(time.perf_counter() - start)
            if row["label"]["state"] == "visible":
                proposals[row["id"]] = min((float(np.hypot(c["x"] - row["label"]["x"], c["y"] - row["label"]["y"])) for c in candidates), default=None)
            ranked_output[row["id"]] = sorted(ranked, key=lambda item: item["score"], reverse=True)[:8]
            image = frames[1].copy()
            cv2.polylines(image, [np.asarray(row["corners"], np.int32)], True, (255, 220, 40), 2)
            label, prediction = row["label"], predictions[row["id"]]
            if label["state"] == "visible":
                cv2.circle(image, (round(label["x"]), round(label["y"])), 18, (255, 230, 40), 3)
            if prediction["state"] == "visible":
                cv2.rectangle(image, (round(prediction["x"]) - 18, round(prediction["y"]) - 18), (round(prediction["x"]) + 18, round(prediction["y"]) + 18), (230, 50, 230), 3)
            cv2.putText(image, f"reference {label['state']} | owned {prediction['state']}", (25, 45), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            cv2.imwrite(str(overlays / f"{row['id']}.jpg"), image)
            if index % 25 == 0:
                print(json.dumps({"evaluated": index, "total": len(rows)}), flush=True)
    metrics = score_predictions(rows, predictions, proposals)
    metrics["by_source"] = flat_groups(rows, predictions, proposals, "source_name") if rows and "source_name" in rows[0] else {}
    metrics["threshold"] = checkpoint["candidate_threshold"]
    metrics["margin"] = checkpoint["ambiguity_margin"]
    metrics["median_inference_ms_excluding_jpeg_decode"] = float(np.median(timings) * 1000) if timings else None
    metrics["run_name"] = args.run_name
    metrics["reference_provenance"] = sorted({row["label"].get("provenance", "unknown") for row in rows})
    (args.output / "summary.json").write_text(json.dumps(metrics, indent=2))
    (args.output / "predictions.json").write_text(json.dumps(predictions, indent=2))
    (args.output / "ranked-candidates.json").write_text(json.dumps(ranked_output, indent=2))
    print(json.dumps(metrics), flush=True)


if __name__ == "__main__":
    main()
