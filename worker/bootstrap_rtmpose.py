#!/usr/bin/env python3
"""Install the isolated RTMPose runtime and exact verified checkpoint."""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import tempfile
import urllib.request
import venv
import zipfile
from pathlib import Path

if __package__:
    from .match_structure import EXPECTED_CHECKPOINT_SHA256
else:
    from match_structure import EXPECTED_CHECKPOINT_SHA256


DEFAULT_CHECKPOINT_URL = (
    "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/"
    "onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-256x192-"
    "e48f03d0_20230504.zip"
)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_checkpoint(path: Path, expected_sha256: str) -> str:
    if not path.is_file() or path.stat().st_size <= 0:
        raise ValueError(f"checkpoint is missing or empty: {path}")
    actual = file_sha256(path)
    if actual != expected_sha256:
        raise ValueError(
            "checkpoint SHA-256 mismatch: "
            f"expected {expected_sha256}, got {actual}"
        )
    return actual


def bootstrap(
    root: Path,
    requirements: Path,
    url: str = DEFAULT_CHECKPOINT_URL,
    expected_sha256: str = EXPECTED_CHECKPOINT_SHA256,
) -> tuple[Path, Path]:
    root.mkdir(parents=True, exist_ok=True)
    environment = root / "venv"
    python = environment / "bin" / "python"
    model = root / "end2end.onnx"
    if python.is_file() and model.is_file():
        verify_checkpoint(model, expected_sha256)
        return python, model

    if not python.is_file():
        venv.EnvBuilder(with_pip=True).create(environment)
        subprocess.run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "-r",
                str(requirements),
            ],
            check=True,
        )

    with tempfile.TemporaryDirectory(
        prefix="ponglens-rtmpose-bootstrap-"
    ) as raw:
        temporary = Path(raw)
        archive = temporary / "checkpoint.zip"
        urllib.request.urlretrieve(url, archive)
        with zipfile.ZipFile(archive) as source:
            candidates = [
                name
                for name in source.namelist()
                if Path(name).name == "end2end.onnx"
            ]
            if len(candidates) != 1:
                raise ValueError(
                    "RTMPose archive must contain exactly one end2end.onnx"
                )
            extracted = temporary / "end2end.onnx"
            with source.open(candidates[0]) as incoming, extracted.open(
                "wb"
            ) as outgoing:
                shutil.copyfileobj(incoming, outgoing)
        verify_checkpoint(extracted, expected_sha256)
        extracted.replace(model)
    return python, model


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument(
        "--requirements",
        type=Path,
        default=Path(__file__).with_name("requirements-rtmpose.txt"),
    )
    parser.add_argument("--url", default=DEFAULT_CHECKPOINT_URL)
    parser.add_argument(
        "--sha256",
        default=EXPECTED_CHECKPOINT_SHA256,
    )
    args = parser.parse_args()
    python, model = bootstrap(
        args.root,
        args.requirements,
        args.url,
        args.sha256,
    )
    print(f"python={python}")
    print(f"model={model}")


if __name__ == "__main__":
    main()
