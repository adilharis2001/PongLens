#!/usr/bin/env python3
"""Install the isolated, provenance-pinned service-motion pose runtime."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
from typing import Any, Callable
import urllib.request
import venv


MODEL_URL = (
    "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/"
    "rtmpose-m_simcc-coco_pt-aic-coco_420e-256x192-"
    "d8dd5ca4_20230127.pth"
)
SOURCE_URL = (
    "https://github.com/open-mmlab/mmpose/archive/refs/tags/v1.3.2.tar.gz"
)
MODEL_CATALOGUE_URL = (
    "https://github.com/open-mmlab/mmpose/blob/main/configs/"
    "body_2d_keypoint/rtmpose/coco/rtmpose_coco.md"
)
LICENSE_URL = "https://github.com/open-mmlab/mmpose/blob/main/LICENSE"
COMMERCIAL_USE_URL = (
    "https://github.com/open-mmlab/mmpose/issues/2393"
)
CONFIG_RELATIVE_PATH = Path(
    "mmpose-1.3.2/configs/body_2d_keypoint/rtmpose/coco/"
    "rtmpose-m_8xb256-420e_coco-256x192.py"
)


Downloader = Callable[[str, Path], None]


def _download(url: str, destination: Path) -> None:
    urllib.request.urlretrieve(url, destination)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_provenance(root: Path) -> dict[str, Any]:
    path = root / "provenance.json"
    if not path.is_file():
        return {
            "version": 1,
            "license": "Apache-2.0",
            "catalogue_url": MODEL_CATALOGUE_URL,
            "license_url": LICENSE_URL,
            "commercial_use_url": COMMERCIAL_USE_URL,
        }
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError("pose provenance must be a JSON object")
    return payload


def _write_provenance(root: Path, payload: dict[str, Any]) -> None:
    temporary = root / ".provenance.json.tmp"
    temporary.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n"
    )
    temporary.replace(root / "provenance.json")


def _verified_existing(
    path: Path,
    record: Any,
    label: str,
) -> bool:
    if not path.is_file() or not isinstance(record, dict):
        return False
    expected = str(record.get("sha256") or "")
    actual = file_sha256(path)
    if not expected or actual != expected:
        raise ValueError(
            f"{label} digest changed: expected {expected}, got {actual}"
        )
    return True


def resolve_model(
    root: Path,
    url: str = MODEL_URL,
    *,
    downloader: Downloader = _download,
) -> tuple[Path, dict[str, Any]]:
    """Download once, then require the recorded checkpoint digest."""

    root.mkdir(parents=True, exist_ok=True)
    model = root / "model.pth"
    provenance = _read_provenance(root)
    if _verified_existing(model, provenance.get("model"), "model"):
        return model, provenance
    if model.exists() or provenance.get("model"):
        raise ValueError("model and recorded digest must appear together")
    with tempfile.TemporaryDirectory(
        prefix="ponglens-service-motion-model-"
    ) as raw:
        incoming = Path(raw) / "model.pth"
        downloader(url, incoming)
        if not incoming.is_file() or incoming.stat().st_size <= 0:
            raise ValueError("downloaded model is missing or empty")
        digest = file_sha256(incoming)
        shutil.copyfile(incoming, model)
    provenance["model"] = {
        "url": url,
        "sha256": digest,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "family": "RTMPose",
        "name": "RTMPose-M COCO 256x192",
    }
    _write_provenance(root, provenance)
    return model, provenance


def _safe_extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with tarfile.open(archive, "r:gz") as source:
        for member in source.getmembers():
            candidate = (destination / member.name).resolve()
            if candidate != root and root not in candidate.parents:
                raise ValueError("source archive path escapes destination")
        source.extractall(destination, filter="data")


def resolve_source(
    root: Path,
    url: str = SOURCE_URL,
    *,
    downloader: Downloader = _download,
) -> tuple[Path, dict[str, Any]]:
    """Resolve the exact MMPose config from a pinned release archive."""

    root.mkdir(parents=True, exist_ok=True)
    archive = root / "mmpose-v1.3.2.tar.gz"
    source_root = root / "source"
    config = source_root / CONFIG_RELATIVE_PATH
    provenance = _read_provenance(root)
    if _verified_existing(archive, provenance.get("source"), "source"):
        if not config.is_file():
            _safe_extract(archive, source_root)
        if not config.is_file():
            raise ValueError("pinned MMPose config is missing")
        return config, provenance
    if archive.exists() or provenance.get("source"):
        raise ValueError("source archive and digest must appear together")
    downloader(url, archive)
    if not archive.is_file() or archive.stat().st_size <= 0:
        raise ValueError("downloaded source archive is missing or empty")
    digest = file_sha256(archive)
    _safe_extract(archive, source_root)
    if not config.is_file():
        raise ValueError("pinned MMPose config is missing")
    provenance["source"] = {
        "url": url,
        "sha256": digest,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "version": "1.3.2",
    }
    _write_provenance(root, provenance)
    return config, provenance


def bootstrap_environment(root: Path, requirements: Path) -> Path:
    environment = root / "venv"
    python = environment / "bin" / "python"
    if not python.is_file():
        venv.EnvBuilder(with_pip=True).create(environment)
        subprocess.run(
            [str(python), "-m", "pip", "install", "--upgrade", "pip"],
            check=True,
        )
    subprocess.run(
        [str(python), "-m", "pip", "install", "-r", str(requirements)],
        check=True,
    )
    # The official COCO PyTorch checkpoint is loaded through MMPose's model
    # registry, which imports one native MMCV operator from an unrelated
    # transformer head. macOS ARM wheels are not published for this release,
    # so build the compatible Apache-2.0 package after NumPy and the legacy
    # setuptools API it expects are present.
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--no-build-isolation",
            "mmcv==2.1.0",
        ],
        check=True,
    )
    # xtcocotools' source package imports NumPy while preparing its wheel but
    # does not declare NumPy as a build-system dependency. Build it only after
    # the pinned runtime NumPy has been installed above.
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--no-build-isolation",
            "xtcocotools==1.14.3",
        ],
        check=True,
    )
    # Chumpy has the same legacy build-isolation problem: its setup imports
    # pip directly. Build it only after the pinned runtime toolchain exists.
    # RTMPose 2D does not execute it, but installing MMPose's declared
    # dependency keeps the isolated environment internally consistent.
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--no-build-isolation",
            "chumpy==0.70",
        ],
        check=True,
    )
    # MMPose 1.3.2 imports a small set of MMDetection utility types while
    # registering every bundled head, even though RTMPose-M does not perform
    # object detection. Keep the compatible Apache-2.0 package exact and
    # dependency-free; its detector models and native operators are unused.
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--no-deps",
            "mmdet==3.2.0",
        ],
        check=True,
    )
    # Install the exact MMPose wheel without re-resolving its legacy packages;
    # every declared runtime dependency was installed explicitly above.
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--no-deps",
            "mmpose==1.3.2",
        ],
        check=True,
    )
    return python


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument(
        "--requirements",
        type=Path,
        default=Path(__file__).with_name(
            "requirements-service-motion-rtmpose.txt"
        ),
    )
    args = parser.parse_args()
    python = bootstrap_environment(args.root, args.requirements)
    model, _ = resolve_model(args.root)
    config, provenance = resolve_source(args.root)
    print(f"python={python}")
    print(f"model={model}")
    print(f"config={config}")
    print(f"model_sha256={provenance['model']['sha256']}")
    print(f"source_sha256={provenance['source']['sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
