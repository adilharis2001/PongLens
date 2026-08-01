"""Deterministic, match-separated training for the temporal serve model."""

from __future__ import annotations

import hashlib
import io
import json
import os
import random
import subprocess
import tempfile
from collections.abc import Mapping, Sequence
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import Tensor
from torch.utils.data import DataLoader, Dataset

from worker.temporal_serve_model import PairedServeGRU, multiple_instance_loss


class _ServeDataset(Dataset):
    def __init__(self, rows: Sequence[Mapping[str, Any]]):
        self.rows = list(rows)

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> Mapping[str, Any]:
        return self.rows[index]


def _collate(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    if not rows:
        raise ValueError("cannot collate an empty batch")
    widths = {len(row["features"][0]) for row in rows}
    if len(widths) != 1:
        raise ValueError("feature widths differ within a batch")
    width = widths.pop()
    maximum = max(len(row["features"]) for row in rows)
    features = torch.zeros(len(rows), maximum, width, dtype=torch.float32)
    mask = torch.zeros(len(rows), maximum, dtype=torch.bool)
    clean_negative = torch.zeros(len(rows), maximum, dtype=torch.bool)
    targets: list[int] = []

    for batch_index, row in enumerate(rows):
        tensor = torch.as_tensor(row["features"], dtype=torch.float32)
        if tensor.ndim != 2 or tensor.shape[1] != width:
            raise ValueError("each features value must have shape [time, width]")
        length = tensor.shape[0]
        features[batch_index, :length] = tensor
        row_mask = torch.as_tensor(row.get("mask", [1] * length), dtype=torch.bool)
        if row_mask.shape != (length,):
            raise ValueError("each mask must contain one value per feature frame")
        mask[batch_index, :length] = row_mask
        if "clean_negative_mask" in row:
            negative = torch.as_tensor(row["clean_negative_mask"], dtype=torch.bool)
            if negative.shape != (length,):
                raise ValueError("clean_negative_mask must match the feature frames")
            clean_negative[batch_index, :length] = negative
        target = row["target_side"]
        if isinstance(target, str):
            target = {"near": 0, "far": 1}.get(target)
        if target not in (0, 1):
            raise ValueError("target_side must be near/far or 0/1")
        targets.append(int(target))

    return {
        "features": features,
        "mask": mask,
        "clean_negative_mask": clean_negative,
        "target_side": torch.tensor(targets, dtype=torch.long),
    }


def set_deterministic_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True, warn_only=True)
    # These small research batches are both faster and more reproducible with a
    # single BLAS worker.  This does not affect RTMPose feature extraction.
    torch.set_num_threads(1)


def _split_ids(value: Any) -> dict[str, set[str]]:
    if isinstance(value, Mapping):
        result: dict[str, set[str]] = {}
        for split in ("train", "development", "holdout"):
            rows = value.get(split, [])
            if rows and isinstance(rows[0], Mapping):
                result[split] = {str(row["match_id"]) for row in rows}
            else:
                result[split] = {str(item) for item in rows}
        return result
    raise TypeError("training splits must be a mapping")


def validate_training_splits(splits: Mapping[str, Any]) -> None:
    ids = _split_ids(splits)
    for left, right in (
        ("train", "development"),
        ("train", "holdout"),
        ("development", "holdout"),
    ):
        overlap = ids[left] & ids[right]
        if overlap:
            raise ValueError(
                f"match leakage between {left} and {right}: {', '.join(sorted(overlap))}"
            )


def _evaluate(model: PairedServeGRU, loader: DataLoader) -> float:
    model.eval()
    losses: list[float] = []
    with torch.no_grad():
        for batch in loader:
            output = model(batch["features"], batch["mask"])
            loss = multiple_instance_loss(
                output,
                batch["target_side"],
                clean_negative_mask=batch["clean_negative_mask"],
            )
            losses.append(float(loss.item()))
    if not losses:
        raise ValueError("development split is empty")
    return float(np.mean(losses))


def _git_commit() -> str | None:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _checkpoint_bytes(payload: Mapping[str, Any]) -> bytes:
    buffer = io.BytesIO()
    # Legacy serialization is stable byte-for-byte for the same ordered state
    # dictionary, making the content hash useful in repeatability checks.
    torch.save(dict(payload), buffer, _use_new_zipfile_serialization=False)
    return buffer.getvalue()


def _model_state_sha256(state: Mapping[str, Tensor], metadata: Mapping[str, Any]) -> str:
    """Hash tensor values canonically, independent of torch storage identifiers."""

    digest = hashlib.sha256()
    digest.update(json.dumps(dict(metadata), sort_keys=True).encode("utf-8"))
    for key in sorted(state):
        tensor = state[key].detach().cpu().contiguous()
        digest.update(key.encode("utf-8"))
        digest.update(str(tensor.dtype).encode("ascii"))
        digest.update(json.dumps(list(tensor.shape)).encode("ascii"))
        digest.update(tensor.numpy().tobytes(order="C"))
    return digest.hexdigest()


def _atomic_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _atomic_json(path: Path, value: Mapping[str, Any]) -> None:
    content = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")
    _atomic_bytes(path, content)


def train_model(
    dataset: Mapping[str, Any],
    *,
    seed: int = 731,
    epochs: int = 40,
    patience: int = 6,
    batch_size: int = 16,
    learning_rate: float = 1e-3,
    output_dir: Path | str | None = None,
) -> dict[str, Any]:
    """Train only on train rows and select an epoch only on development rows."""

    if epochs <= 0 or patience <= 0 or batch_size <= 0:
        raise ValueError("epochs, patience, and batch_size must be positive")
    train_rows = list(dataset.get("train", []))
    development_rows = list(dataset.get("development", []))
    if not train_rows:
        raise ValueError("train split is empty")
    if not development_rows:
        raise ValueError("development split is empty")
    validate_training_splits(dataset)

    feature_width = len(train_rows[0]["features"][0])
    for split_name in ("train", "development"):
        for row in dataset[split_name]:
            if not row.get("features") or len(row["features"][0]) != feature_width:
                raise ValueError(f"inconsistent feature width in {split_name}")

    set_deterministic_seed(seed)
    generator = torch.Generator().manual_seed(seed)
    train_loader = DataLoader(
        _ServeDataset(train_rows),
        batch_size=batch_size,
        shuffle=True,
        generator=generator,
        num_workers=0,
        collate_fn=_collate,
    )
    development_loader = DataLoader(
        _ServeDataset(development_rows),
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
        collate_fn=_collate,
    )

    model = PairedServeGRU(feature_width)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    best_loss = float("inf")
    best_epoch = 0
    best_state: dict[str, Tensor] | None = None
    history: list[dict[str, float | int]] = []
    stale_epochs = 0

    for epoch in range(1, epochs + 1):
        model.train()
        train_losses: list[float] = []
        for batch in train_loader:
            optimizer.zero_grad(set_to_none=True)
            output = model(batch["features"], batch["mask"])
            loss = multiple_instance_loss(
                output,
                batch["target_side"],
                clean_negative_mask=batch["clean_negative_mask"],
            )
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            optimizer.step()
            train_losses.append(float(loss.item()))

        development_loss = _evaluate(model, development_loader)
        history.append(
            {
                "epoch": epoch,
                "train_loss": float(np.mean(train_losses)),
                "development_loss": development_loss,
            }
        )
        if development_loss < best_loss - 1e-9:
            best_loss = development_loss
            best_epoch = epoch
            best_state = deepcopy({key: value.detach().cpu() for key, value in model.state_dict().items()})
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= patience:
                break

    if best_state is None:
        raise RuntimeError("training did not produce a checkpoint")
    model.load_state_dict(best_state)
    checkpoint = {
        "schema_version": 1,
        "feature_width": feature_width,
        "symmetric_pairs": model.symmetric_pairs,
        "model_state_dict": best_state,
        "best_epoch": best_epoch,
        "seed": seed,
    }
    checkpoint_content = _checkpoint_bytes(checkpoint)
    checkpoint_sha256 = _model_state_sha256(
        best_state,
        {
            "schema_version": 1,
            "feature_width": feature_width,
            "symmetric_pairs": model.symmetric_pairs,
            "best_epoch": best_epoch,
            "seed": seed,
        },
    )
    checkpoint_file_sha256 = hashlib.sha256(checkpoint_content).hexdigest()

    metrics: dict[str, Any] = {
        "schema_version": 1,
        "best_epoch": best_epoch,
        "development_loss": best_loss,
        "epochs_completed": len(history),
        "history": history,
        "checkpoint_sha256": checkpoint_sha256,
        "checkpoint_file_sha256": checkpoint_file_sha256,
    }
    metadata = dict(dataset.get("metadata", {}))
    split_ids = _split_ids(dataset)
    provenance: dict[str, Any] = {
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": _git_commit(),
        "manifest_sha256": metadata.get("manifest_sha256"),
        "feature_extractor_version": metadata.get("extractor_version"),
        "rtmpose_checkpoint_sha256": metadata.get("rtmpose_checkpoint_sha256"),
        "seed": seed,
        "model": {
            "type": "PairedServeGRU",
            "feature_width": feature_width,
            "hidden_width": 64,
            "layers": 2,
            "bidirectional": True,
            "symmetric_pairs": model.symmetric_pairs,
        },
        "dependencies": {
            "python": f"{os.sys.version_info.major}.{os.sys.version_info.minor}.{os.sys.version_info.micro}",
            "numpy": np.__version__,
            "torch": torch.__version__,
        },
        "split_match_ids": {
            split: sorted(values) for split, values in split_ids.items()
        },
    }

    if output_dir is not None:
        destination = Path(output_dir)
        _atomic_bytes(destination / "checkpoint.pt", checkpoint_content)
        _atomic_json(destination / "training.json", metrics)
        _atomic_json(destination / "provenance.json", provenance)

    # The live model is intentionally private/in-memory; serialized JSON remains
    # free of tensors and all holdout labels.
    return {**metrics, "provenance": provenance, "_model": model}


__all__ = ["set_deterministic_seed", "train_model", "validate_training_splits"]
