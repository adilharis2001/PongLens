import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from worker.bootstrap_rtmpose import (
    require_supported_python,
    verify_checkpoint,
)


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_wrong_checkpoint_is_rejected_before_active_model_changes(self):
        active = self.root / "active.onnx"
        active.write_bytes(b"known-good")
        candidate = self.root / "candidate.onnx"
        candidate.write_bytes(b"wrong")

        with self.assertRaisesRegex(ValueError, "SHA-256"):
            verify_checkpoint(candidate, "0" * 64)

        self.assertEqual(active.read_bytes(), b"known-good")

    def test_command_runs_by_file_path_without_importing_worker_daemon(self):
        script = Path(__file__).resolve().parents[1] / "bootstrap_rtmpose.py"

        result = subprocess.run(
            [sys.executable, str(script), "--help"],
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--requirements", result.stdout)

    def test_bootstrap_rejects_python_without_pinned_numpy_wheels(self):
        with self.assertRaisesRegex(RuntimeError, "Python 3.11"):
            require_supported_python((3, 9))

        require_supported_python((3, 12))


if __name__ == "__main__":
    unittest.main()
