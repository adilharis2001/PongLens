"""Train an owned candidate scorer from frozen Gemini teacher labels on this Mac."""
import argparse
import hashlib
import json
import random
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.nn import functional as F

from worker.active_ball_data import validate_dataset
from worker.active_ball_motion import ball_candidates
from worker.active_ball_patches import ActiveBallPatchNet, candidate_geometry, candidate_multiscale_patch
from worker.active_ball_teacher import assign_candidate_targets, select_operating_point


SEED = 20260905
PROVENANCE = "gemini_3_8_flash_prompt3"


def frames_for(row):
    frames = [cv2.imread(path) for path in row["frames"]]
    if any(frame is None for frame in frames):
        raise ValueError(f"could not decode frames for {row['id']}")
    return frames


def uint8_patch(frames, candidate):
    return (candidate_multiscale_patch(frames, candidate["x"], candidate["y"]) * 255).round().to(torch.uint8)


def score_rows(model, rows, device):
    model.eval()
    ranked, proposal_distances = {}, {}
    with torch.no_grad():
        for index, row in enumerate(rows, 1):
            frames = frames_for(row)
            candidates = ball_candidates(frames)
            label = row["label"]
            if label["state"] == "visible":
                proposal_distances[row["id"]] = min(
                    (float(np.hypot(c["x"] - label["x"], c["y"] - label["y"])) for c in candidates),
                    default=None,
                )
            scores = []
            dt = (row["frame_times_s"][2] - row["frame_times_s"][0]) / 2
            for offset in range(0, len(candidates), 96):
                batch = candidates[offset:offset + 96]
                patches = torch.stack([uint8_patch(frames, c) for c in batch]).to(device).float().div_(255)
                geometry = torch.stack([candidate_geometry(c["x"], c["y"], row["corners"], dt) for c in batch]).to(device)
                scores.extend(model(patches, geometry).sigmoid().cpu().tolist())
            ranked[row["id"]] = [{**candidate, "score": float(score)} for candidate, score in zip(candidates, scores)]
            if index % 30 == 0:
                print(json.dumps({"validation_scored": index, "total": len(rows)}), flush=True)
    return ranked, proposal_distances


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--negative-cap", type=int, default=16)
    args = parser.parse_args()
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    rows = json.loads(args.manifest.read_text())
    validate_dataset(rows, allow_shared_venues=True)
    usable = [row for row in rows if row.get("label") and row["label"]["state"] != "unsure"]
    train_rows = [row for row in usable if row["split"] == "train" and row["label"].get("provenance") == PROVENANCE]
    validation_rows = [row for row in usable if row["split"] == "validation" and row["label"].get("provenance") == PROVENANCE]
    if not train_rows or not validation_rows:
        raise ValueError("teacher train and validation rows are required")

    patches, geometry, targets, records = [], [], [], []
    proposal = {"visible_rows": 0, "within_20px": 0, "within_40px": 0, "within_64px": 0}
    for index, row in enumerate(train_rows, 1):
        frames = frames_for(row)
        candidates = ball_candidates(frames)
        labels = assign_candidate_targets(candidates, row["label"])
        if row["label"]["state"] == "visible":
            proposal["visible_rows"] += 1
            nearest = min((np.hypot(c["x"] - row["label"]["x"], c["y"] - row["label"]["y"]) for c in candidates), default=np.inf)
            for limit in (20, 40, 64):
                proposal[f"within_{limit}px"] += int(nearest <= limit)
        selected = [i for i, target in enumerate(labels) if target == 1]
        negatives = [i for i, target in enumerate(labels) if target == 0]
        moving = sorted((i for i in negatives if candidates[i]["source"] == "motion"), key=lambda i: candidates[i]["motion"], reverse=True)
        static = sorted((i for i in negatives if candidates[i]["source"] == "appearance"), key=lambda i: candidates[i]["area"], reverse=True)
        mixed = moving[:args.negative_cap // 2] + static[:args.negative_cap - args.negative_cap // 2]
        if len(mixed) < args.negative_cap:
            mixed.extend(i for i in moving + static if i not in mixed)
        selected.extend(mixed[:args.negative_cap])
        dt = (row["frame_times_s"][2] - row["frame_times_s"][0]) / 2
        for candidate_index in selected:
            candidate, target = candidates[candidate_index], labels[candidate_index]
            patches.append(uint8_patch(frames, candidate))
            geometry.append(candidate_geometry(candidate["x"], candidate["y"], row["corners"], dt))
            targets.append(float(target))
            records.append({"source_id": row["id"], "candidate_index": candidate_index, "positive": bool(target)})
        if row["label"]["state"] == "visible":
            for jitter in ((0, 0), (-8, 5), (7, -6)):
                candidate={"x":row["label"]["x"]+jitter[0],"y":row["label"]["y"]+jitter[1]}
                patches.append(uint8_patch(frames,candidate));geometry.append(candidate_geometry(candidate["x"],candidate["y"],row["corners"],dt));targets.append(1.)
                records.append({"source_id":row["id"],"candidate_index":None,"positive":True,"teacher_center_jitter":jitter})
        if index % 30 == 0:
            print(json.dumps({"training_rows_prepared": index, "total": len(train_rows)}), flush=True)
    if not targets or min(targets) == max(targets):
        raise ValueError("training requires positive and negative candidates")
    x = torch.stack(patches)
    g = torch.stack(geometry)
    y = torch.tensor(targets)
    positive = np.flatnonzero(np.asarray(targets) == 1)
    negative = np.flatnonzero(np.asarray(targets) == 0)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = ActiveBallPatchNet(channels=18).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=0.01)
    history = []
    print(json.dumps({"device": device, "train_rows": len(train_rows), "validation_rows": len(validation_rows), "positive_candidates": len(positive), "negative_candidates": len(negative), "proposal": proposal}), flush=True)
    for epoch in range(args.epochs):
        model.train()
        losses = []
        for _ in range(max(24, len(targets) // 64)):
            indices = np.concatenate([
                np.random.choice(positive, 32, replace=len(positive) < 32),
                np.random.choice(negative, 32, replace=len(negative) < 32),
            ])
            np.random.shuffle(indices)
            batch = x[indices].to(device).float().div_(255)
            geom = g[indices].to(device)
            truth = y[indices].to(device).mul(.9).add(.05)
            optimizer.zero_grad()
            loss = F.binary_cross_entropy_with_logits(model(batch, geom), truth)
            if not torch.isfinite(loss):
                raise ValueError("non-finite training loss")
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        history.append({"epoch": epoch + 1, "training_loss": float(np.mean(losses))})
        print(json.dumps(history[-1]), flush=True)

    ranked, validation_proposals = score_rows(model, validation_rows, device)
    operating_point = select_operating_point(validation_rows, ranked)
    args.output.mkdir(parents=True, exist_ok=True)
    checkpoint = {
        "architecture": "active-ball-patch-v3-multiscale-teacher",
        "state_dict": {key: value.detach().cpu() for key, value in model.state_dict().items()},
        "seed": SEED,
        "epochs": args.epochs,
        "device_used": device,
        "training_ids": [row["id"] for row in train_rows],
        "validation_ids": [row["id"] for row in validation_rows],
        "training_provenance": [PROVENANCE],
        "manifest_sha256": hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
        "candidate_source": "local_motion_and_appearance_v1",
        "candidate_threshold": operating_point["threshold"],
        "ambiguity_margin": operating_point["margin"],
        "operating_point": operating_point,
        "training_proposal_coverage": proposal,
    }
    temporary = args.output / "model.tmp.pt"
    torch.save(checkpoint, temporary)
    temporary.replace(args.output / "model.pt")
    (args.output / "history.json").write_text(json.dumps(history, indent=2))
    (args.output / "training-candidates.json").write_text(json.dumps(records, indent=2))
    (args.output / "validation-ranked.json").write_text(json.dumps(ranked, indent=2))
    (args.output / "validation-proposal-distances.json").write_text(json.dumps(validation_proposals, indent=2))
    print(json.dumps({"checkpoint": str(args.output / "model.pt"), "operating_point": operating_point}), flush=True)


if __name__ == "__main__":
    main()
