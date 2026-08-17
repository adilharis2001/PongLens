"""Where a finished match's placement lifecycle lands.

The rule this pins is a promise to the player: never offer a retry that
cannot succeed. Before the 2026-08-17 detector change, a video whose table
nobody could find was marked retry_available, so the player spent their one
placement request on a second run of the identical ladder and waited for it
to fail the same way.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from worker.worker import placement_outcome  # noqa: E402

FOUND = {"ok": True, "table_corners_px": {}, "source": "keypoints"}
NOT_FOUND = {"ok": False}


class PlacementOutcomeTest(unittest.TestCase):
    def test_placement_not_asked_for(self):
        self.assertEqual(
            placement_outcome(requested=False, mapped_points=0,
                              calibration=NOT_FOUND),
            ("not_requested", None),
        )

    def test_a_drawable_point_is_ready(self):
        self.assertEqual(
            placement_outcome(requested=True, mapped_points=12,
                              calibration=FOUND),
            ("ready", None),
        )

    def test_no_table_is_terminal_and_offers_nothing(self):
        status, code = placement_outcome(
            requested=True, mapped_points=0, calibration=NOT_FOUND)
        self.assertEqual(status, "final_failed")
        self.assertEqual(code, "no_table_found")

    def test_a_found_table_with_no_landings_keeps_the_retry(self):
        """A tracking failure, not a calibration one. A second pass over the
        same video genuinely can come out differently."""
        status, code = placement_outcome(
            requested=True, mapped_points=0, calibration=FOUND)
        self.assertEqual(status, "retry_available")
        self.assertEqual(code, "no_mappable_points")

    def test_a_missing_calibration_block_counts_as_no_table(self):
        """An older or truncated match.json must not be read as success."""
        for calibration in (None, {}, "ok", []):
            with self.subTest(calibration=calibration):
                status, code = placement_outcome(
                    requested=True, mapped_points=0, calibration=calibration)
                self.assertEqual(status, "final_failed")
                self.assertEqual(code, "no_table_found")

    def test_mapped_points_win_over_a_missing_calibration_block(self):
        """If landings were drawn, the maps exist and the player should see
        them whatever the calibration block says about itself."""
        self.assertEqual(
            placement_outcome(requested=True, mapped_points=3,
                              calibration=None),
            ("ready", None),
        )


if __name__ == "__main__":
    unittest.main()
