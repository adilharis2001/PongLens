import hashlib
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker.bootstrap_service_motion_rtmpose import (
    MODEL_URL,
    SOURCE_URL,
    bootstrap_environment,
    resolve_model,
    resolve_source,
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ModelProvenanceTests(unittest.TestCase):
    def test_runtime_pins_full_mmcv_build_dependencies(self):
        requirements = (
            Path(__file__).parents[1]
            / "requirements-service-motion-rtmpose.txt"
        ).read_text().splitlines()

        self.assertIn("setuptools==80.9.0", requirements)
        self.assertIn("Cython==3.0.11", requirements)
        self.assertNotIn("mmcv==2.2.0", requirements)
        self.assertFalse(any(line.startswith("mmcv-lite") for line in requirements))
        self.assertNotIn("mmpose==1.3.2", requirements)
        self.assertNotIn("xtcocotools==1.14.3", requirements)
        self.assertFalse(any(line.startswith("chumpy") for line in requirements))

    def test_existing_partial_environment_retries_requirements(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            python = root / "venv" / "bin" / "python"
            python.parent.mkdir(parents=True)
            python.touch()
            requirements = root / "requirements.txt"
            requirements.write_text("setuptools==80.9.0\n")

            with patch("subprocess.run") as run:
                resolved = bootstrap_environment(root, requirements)

            self.assertEqual(resolved, python)
            self.assertEqual(
                run.call_args_list[0].args[0],
                [
                    str(python), "-m", "pip", "install",
                    "-r", str(requirements),
                ],
            )
            self.assertEqual(
                run.call_args_list[1].args[0],
                [
                    str(python), "-m", "pip", "install",
                    "--no-build-isolation", "mmcv==2.1.0",
                ],
            )
            self.assertEqual(
                run.call_args_list[2].args[0],
                [
                    str(python), "-m", "pip", "install",
                    "--no-build-isolation", "xtcocotools==1.14.3",
                ],
            )
            self.assertEqual(
                run.call_args_list[3].args[0],
                [
                    str(python), "-m", "pip", "install",
                    "--no-build-isolation", "chumpy==0.70",
                ],
            )
            self.assertEqual(
                run.call_args_list[4].args[0],
                [
                    str(python), "-m", "pip", "install",
                    "--no-deps", "mmdet==3.2.0",
                ],
            )
            self.assertEqual(
                run.call_args_list[5].args[0],
                [
                    str(python), "-m", "pip", "install",
                    "--no-deps", "mmpose==1.3.2",
                ],
            )

    def test_first_resolution_records_digest_and_commercial_provenance(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)

            def downloader(url: str, destination: Path) -> None:
                self.assertEqual(url, MODEL_URL)
                destination.write_bytes(b"official checkpoint fixture")

            model, provenance = resolve_model(
                root,
                downloader=downloader,
            )

            self.assertEqual(provenance["model"]["sha256"], sha256(model))
            self.assertEqual(provenance["model"]["url"], MODEL_URL)
            self.assertEqual(provenance["license"], "Apache-2.0")
            self.assertIn("commercial_use_url", provenance)
            self.assertEqual(
                json.loads((root / "provenance.json").read_text()),
                provenance,
            )

    def test_existing_checkpoint_must_match_recorded_digest(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)

            def downloader(_url: str, destination: Path) -> None:
                destination.write_bytes(b"checkpoint")

            model, _ = resolve_model(root, downloader=downloader)
            model.write_bytes(b"changed")

            with self.assertRaisesRegex(ValueError, "digest"):
                resolve_model(root, downloader=downloader)

    def test_pinned_source_archive_yields_exact_config(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)

            def downloader(url: str, destination: Path) -> None:
                self.assertEqual(url, SOURCE_URL)
                source = root / "source"
                config = (
                    source
                    / "mmpose-1.3.2"
                    / "configs"
                    / "body_2d_keypoint"
                    / "rtmpose"
                    / "coco"
                    / "rtmpose-m_8xb256-420e_coco-256x192.py"
                )
                config.parent.mkdir(parents=True)
                config.write_text("model = dict(type='TopdownPoseEstimator')\n")
                with tarfile.open(destination, "w:gz") as archive:
                    archive.add(
                        source / "mmpose-1.3.2",
                        arcname="mmpose-1.3.2",
                    )

            config, provenance = resolve_source(
                root,
                downloader=downloader,
            )

            self.assertTrue(config.is_file())
            self.assertEqual(provenance["source"]["url"], SOURCE_URL)
            self.assertEqual(
                provenance["source"]["sha256"],
                sha256(root / "mmpose-v1.3.2.tar.gz"),
            )


if __name__ == "__main__":
    unittest.main()
