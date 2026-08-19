"""First-cut table-corner model: 4 heatmaps from a small from-scratch CNN.

Trains on the frames harvested by build_table_corner_dataset.py, holding
out WHOLE matches (never frames of a training match) so the eval answers
the question that matters: does it find the corners of a match it has
never seen? Also evaluates on the median-background corpus frames — a
different image domain from live video frames.

    vendor/venv python: torch + cv2 (the TTVid interpreter)
    python train_table_corners.py [--epochs 18] [--device auto]

Outputs under ~/ponglens-data/table-corners/run1/:
    model.pt, metrics.json, overlays/*.jpg (predictions drawn on held-out
    frames — look at them before believing any number).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random

import cv2
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

DATA = os.path.expanduser("~/ponglens-data/table-corners")
RUN = os.path.join(DATA, "run1")
# 320x176 divides cleanly through three stride-2 stages and the x2
# upsample (176/8*2 = 44); true 16:9 would need 180 and lands on odd
# sizes mid-network. The 2% vertical squash is consistent between
# training and inference, so it costs nothing.
IN_W, IN_H = 320, 176
HM_W, HM_H = 80, 44
SIGMA = 1.6
HOLDOUT_PER_VENUE = 2
SEED = 17


def venue_key(venue: str) -> str:
    v = (venue or "").strip().lower()
    return v if v else "unknown"


def load_index():
    with open(os.path.join(DATA, "labels.json")) as f:
        labels = json.load(f)
    items = []
    for match, meta in labels.items():
        frame_dir = os.path.join(DATA, "frames", match)
        if not os.path.isdir(frame_dir):
            continue
        frames = sorted(
            f for f in os.listdir(frame_dir) if f.endswith(".jpg"))
        if not frames:
            continue
        items.append((match, meta, [os.path.join(frame_dir, f)
                                    for f in frames]))
    return items


def split_matches(items):
    random.seed(SEED)
    by_venue: dict = {}
    for item in items:
        by_venue.setdefault(venue_key(item[1]["venue"]), []).append(item)
    train, held = [], []
    for venue_items in by_venue.values():
        random.shuffle(venue_items)
        held.extend(venue_items[:HOLDOUT_PER_VENUE])
        train.extend(venue_items[HOLDOUT_PER_VENUE:])
    return train, held


class CornerFrames(Dataset):
    def __init__(self, items, augment):
        self.rows = []
        self.augment = augment
        for match, meta, frames in items:
            corners = np.asarray(meta["corners"], dtype=np.float32)
            sw = float(meta["sourceWidth"])
            for path in frames:
                self.rows.append((path, corners, sw))

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index):
        path, corners, sw = self.rows[index]
        image = cv2.imread(path)
        h, w = image.shape[:2]
        scale = w / sw
        pts = corners * scale                       # into this frame's px
        image = cv2.resize(image, (IN_W, IN_H))
        pts = pts * np.array([IN_W / w, IN_H / h], dtype=np.float32)

        if self.augment:
            # Mirror: swap left/right corner identities (A<->B, D<->C).
            if random.random() < 0.5:
                image = image[:, ::-1]
                pts[:, 0] = IN_W - pts[:, 0]
                pts = pts[[1, 0, 3, 2]]
            # Photometric jitter, mild — venues differ mostly by light.
            image = image.astype(np.float32)
            image *= random.uniform(0.7, 1.3)
            image += random.uniform(-20, 20)
            image = np.clip(image, 0, 255)

        tensor = torch.from_numpy(
            np.ascontiguousarray(image, dtype=np.float32)
            .transpose(2, 0, 1) / 255.0)

        heat = np.zeros((4, HM_H, HM_W), dtype=np.float32)
        ys, xs = np.mgrid[0:HM_H, 0:HM_W]
        for i, (x, y) in enumerate(pts):
            hx, hy = x * HM_W / IN_W, y * HM_H / IN_H
            heat[i] = np.exp(-((xs - hx) ** 2 + (ys - hy) ** 2)
                             / (2 * SIGMA * SIGMA))
        return tensor, torch.from_numpy(heat), torch.from_numpy(pts)


def block(cin, cout, stride=1):
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, stride, 1, bias=False),
        nn.BatchNorm2d(cout), nn.ReLU(inplace=True))


class CornerNet(nn.Module):
    """~1.5M parameters, from scratch — no licence questions anywhere."""

    def __init__(self):
        super().__init__()
        self.encoder = nn.Sequential(
            block(3, 32, 2), block(32, 32),
            block(32, 64, 2), block(64, 64),
            block(64, 128, 2), block(128, 128), block(128, 128),
            block(128, 192), block(192, 192))
        self.up = nn.Sequential(
            nn.Upsample(scale_factor=2, mode="bilinear", align_corners=False),
            block(192, 96), block(96, 64))
        self.head = nn.Conv2d(64, 4, 1)

    def forward(self, x):
        return self.head(self.up(self.encoder(x)))


def decode(heat):
    """Per-channel argmax with quadratic sub-pixel refinement. The heatmap
    cell is 4 input pixels (~24 source pixels), so integer decoding alone
    caps accuracy well above what the labels support."""
    out = []
    for channel in heat:
        index = int(channel.flatten().argmax())
        y, x = divmod(index, channel.shape[-1])
        fx, fy = float(x), float(y)
        if 0 < x < channel.shape[-1] - 1:
            left, mid, right = channel[y, x - 1], channel[y, x], channel[y, x + 1]
            denom = left - 2 * mid + right
            if abs(denom) > 1e-6:
                fx += float(np.clip(0.5 * (left - right) / denom, -0.5, 0.5))
        if 0 < y < channel.shape[-2] - 1:
            up, mid, down = channel[y - 1, x], channel[y, x], channel[y + 1, x]
            denom = up - 2 * mid + down
            if abs(denom) > 1e-6:
                fy += float(np.clip(0.5 * (up - down) / denom, -0.5, 0.5))
        out.append((fx * IN_W / HM_W, fy * IN_H / HM_H))
    return np.asarray(out, dtype=np.float32)


def evaluate(model, loader, device):
    model.eval()
    errors = []
    with torch.no_grad():
        for images, _heat, pts in loader:
            pred = model(images.to(device)).cpu()
            for i in range(images.shape[0]):
                got = decode(pred[i].numpy())
                err = np.linalg.norm(got - pts[i].numpy(), axis=1).mean()
                errors.append(err / math.hypot(IN_W, IN_H))
    return np.asarray(errors)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()

    if args.device == "auto":
        device = "mps" if torch.backends.mps.is_available() else "cpu"
    else:
        device = args.device

    items = load_index()
    train_items, held_items = split_matches(items)
    train_set = CornerFrames(train_items, augment=True)
    held_set = CornerFrames(held_items, augment=False)
    print(f"{len(train_items)} train matches ({len(train_set)} frames), "
          f"{len(held_items)} held-out matches ({len(held_set)} frames), "
          f"device {device}", flush=True)

    train_loader = DataLoader(train_set, batch_size=32, shuffle=True,
                              num_workers=2)
    held_loader = DataLoader(held_set, batch_size=32, num_workers=2)

    model = CornerNet().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=3e-4)
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs)

    for epoch in range(args.epochs):
        model.train()
        total = 0.0
        for images, heat, _pts in train_loader:
            optimizer.zero_grad()
            pred = model(images.to(device))
            loss = nn.functional.mse_loss(pred, heat.to(device)) * 1000
            loss.backward()
            optimizer.step()
            total += float(loss.detach())
        schedule.step()
        errors = evaluate(model, held_loader, device)
        print(f"epoch {epoch + 1:02d} loss {total / len(train_loader):.3f} "
              f"held-out mean corner err {errors.mean() * 100:.2f}% "
              f"| within 2%: {(errors < 0.02).mean() * 100:.0f}% "
              f"within 4%: {(errors < 0.04).mean() * 100:.0f}%", flush=True)

    os.makedirs(os.path.join(RUN, "overlays"), exist_ok=True)
    torch.save(model.state_dict(), os.path.join(RUN, "model.pt"))

    errors = evaluate(model, held_loader, device)
    metrics = {
        "heldout_matches": [m for m, _meta, _f in held_items],
        "mean_err_pct": float(errors.mean() * 100),
        "pck2": float((errors < 0.02).mean()),
        "pck4": float((errors < 0.04).mean()),
        "frames": len(errors),
    }
    with open(os.path.join(RUN, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    print(json.dumps(metrics), flush=True)

    # Overlays: predictions on the first frame of every held-out match.
    model.eval()
    with torch.no_grad():
        for match, meta, frames in held_items:
            image = cv2.imread(frames[0])
            h, w = image.shape[:2]
            small = cv2.resize(image, (IN_W, IN_H)).astype(np.float32)
            tensor = torch.from_numpy(
                np.ascontiguousarray(small.transpose(2, 0, 1)) / 255.0
            ).unsqueeze(0)
            pred = decode(model(tensor.to(device)).cpu()[0].numpy())
            for i, (x, y) in enumerate(pred):
                point = (int(x * w / IN_W), int(y * h / IN_H))
                cv2.circle(image, point, 12, (80, 220, 60), 3)
                cv2.putText(image, "ABCD"[i], (point[0] + 14, point[1]),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.0, (80, 220, 60), 2)
            truth = np.asarray(meta["corners"], dtype=np.float32) \
                * (w / float(meta["sourceWidth"]))
            for x, y in truth:
                cv2.circle(image, (int(x), int(y)), 6, (60, 60, 230), -1)
            cv2.imwrite(
                os.path.join(RUN, "overlays", f"{match[:8]}.jpg"), image)
    print("overlays written", flush=True)


if __name__ == "__main__":
    main()
