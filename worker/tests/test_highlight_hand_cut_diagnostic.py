"""The hand-cut route through highlight_backfill.

Three defects reached the first hand-cut highlights job in production
(2026-09-25) because nothing exercised this route end to end: Decimal point
times read as unmarked, the original downloaded to a str where a Path was
required, and the points pipeline run without the plays cut mode, which is
the only mode v2 (and so the evidence dump) runs in.
"""

import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

try:
    from worker import highlight_backfill as hb
except ImportError:  # run from inside worker/
    import highlight_backfill as hb


def _fake_worker():
    return SimpleNamespace(
        VENV_PY="/py",
        POINTS_PIPELINE="/points_pipeline.py",
        serve_motif_settings=lambda conn: ("0.1", "0.5"),
    )


class DiagnosticCommandTests(unittest.TestCase):
    def _run(self, **kwargs):
        seen = {}

        def fake_run(command, **_):
            seen["command"] = command

        with tempfile.TemporaryDirectory() as workdir, \
                patch.object(hb.subprocess, "run", side_effect=fake_run):
            result = hb._diagnostic_from_detections(
                _fake_worker(), None, {"match_id": "m", "job_options": {}},
                "/video.mp4", workdir, "/tracking.jsonl", **kwargs)
        return seen["command"], result

    def test_hand_cut_runs_v2_in_the_plays_cut_mode(self):
        command, _ = self._run(cut_mode="plays")
        self.assertIn("--pipeline", command)
        self.assertEqual(command[command.index("--pipeline") + 1], "v2")
        self.assertEqual(command[command.index("--cut-mode") + 1], "plays")
        self.assertIn("--evidence-dump", command)

    def test_automatic_route_is_unchanged(self):
        command, _ = self._run()
        self.assertNotIn("--cut-mode", command)

    def test_no_dump_means_no_cards(self):
        _, result = self._run(cut_mode="plays")
        self.assertEqual(result, {"cards": [], "meta": {"route": None}})


class DownloadTargetTests(unittest.TestCase):
    def test_hand_cut_route_downloads_to_a_path(self):
        source = Path(hb.__file__).read_text()
        start = source.index("def _hand_cut_diagnostic(")
        body = source[start:source.index("\ndef ", start + 1)]
        self.assertIn('Path(workdir) / "source.mp4"', body)
        self.assertIn('cut_mode="plays"', body)


if __name__ == "__main__":
    unittest.main()
