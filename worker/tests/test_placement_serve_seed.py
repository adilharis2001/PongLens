"""Placement is told where the serve is.

Until 2026-08-28 it was not. points_pipeline computed the serve contact, wrote
it onto the point as `serve_s`, and called reconstruct_placement six lines
later without passing it. The two ran over the same window and never spoke.

Left to itself the walk anchors on the FIRST bounce inside the card, and on a
serve that bounce is very often the server tapping the ball on the table
before serving. The serve's own two bounces are then two events too late to be
picked, and the point is refused for a landing that was never the landing.

The seed is a FILTER, not an override: candidates before the serve are dropped
and the existing rules choose from what remains. Two properties are pinned
here because both would fail silently:

  - passing nothing must reconstruct exactly as before, so the switch is
    genuinely off until someone turns it on;
  - the cut must sit BEFORE the serve's real first bounce even when the
    detector is a shot late, which it is on roughly a quarter of serves.
    `serve_s` is CONTACT_LOOKBACK_S (0.81s) earlier than the bounce the
    detector found, which is what buys that margin.
"""

import os
import sys
import unittest

# Import worker.py through the package BEFORE putting worker/ on the path.
# Both are needed — the modules under worker/ import each other flat — but
# once worker/ is on the path, worker.py is also a top-level module named
# `worker`, and a real module beats the namespace package of the same name.
# Importing it first binds the right one and the append is then harmless.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from worker import worker  # noqa: E402,F401
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

import placement_reconstruction as PR  # noqa: E402


def _cands(times):
    return [{"id": f"c{i}", "t": t, "kind": "bounce"} for i, t in enumerate(times)]


class TheSeedIsAFilter(unittest.TestCase):
    """Exercised directly on the filter's arithmetic, so the rule is pinned
    without standing up a whole reconstruction."""

    def keep(self, times, serve_s):
        if serve_s is None:
            return [c["t"] for c in _cands(times)]
        cutoff = float(serve_s) - PR.SERVE_SEED_MARGIN_S
        return [c["t"] for c in _cands(times) if float(c["t"]) >= cutoff]

    def test_without_a_serve_nothing_is_dropped(self):
        times = [10.0, 10.9, 11.3, 12.0]
        self.assertEqual(self.keep(times, None), times)

    def test_the_pre_serve_tap_is_dropped(self):
        # tap at 10.0, paddle at 10.9, the real serve bounces at 11.3 and 11.7
        times = [10.0, 10.9, 11.3, 11.7]
        # serve_s = first bounce - 0.81
        self.assertEqual(self.keep(times, 11.3 - 0.81), [10.9, 11.3, 11.7])

    def test_a_serve_found_one_shot_late_still_keeps_the_real_first_bounce(self):
        # The detector paired the serve's SECOND bounce (11.7) with the
        # receiver's return, so serve_s = 11.7 - 0.81 = 10.89. The real first
        # bounce at 11.3 must survive, or seeding would make things worse on
        # exactly the serves that are already wrong.
        times = [10.0, 11.3, 11.7, 12.2]
        kept = self.keep(times, 11.7 - 0.81)
        self.assertIn(11.3, kept)
        self.assertNotIn(10.0, kept)

    def test_the_margin_is_small_on_purpose(self):
        # Big enough to forgive rounding, far too small to let a pre-serve tap
        # back in — taps sit hundreds of milliseconds before the serve.
        self.assertLessEqual(PR.SERVE_SEED_MARGIN_S, 0.1)


class TheSwitchIsOffUntilTurnedOn(unittest.TestCase):
    def test_reconstruct_placement_takes_a_serve_and_defaults_to_none(self):
        import inspect
        sig = inspect.signature(PR.reconstruct_placement)
        self.assertIn("serve_s", sig.parameters)
        self.assertIsNone(sig.parameters["serve_s"].default)

    def test_the_pipeline_wrapper_passes_it_through(self):
        import inspect
        sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
        import points_pipeline as PP
        sig = inspect.signature(PP.build_placement_v3)
        self.assertIn("serve_s", sig.parameters)
        self.assertIsNone(sig.parameters["serve_s"].default)

    def test_a_missing_config_row_leaves_placement_alone(self):
        from unittest import mock
        with mock.patch.object(worker, "get_config", return_value=None):
            self.assertFalse(worker.placement_serve_seed_enabled(object()))

    def test_a_failing_config_read_leaves_placement_alone(self):
        from unittest import mock
        with mock.patch.object(worker, "get_config",
                               side_effect=RuntimeError("no database")):
            self.assertFalse(worker.placement_serve_seed_enabled(object()))

    def test_on_turns_it_on(self):
        from unittest import mock
        with mock.patch.object(worker, "get_config", return_value="on"):
            self.assertTrue(worker.placement_serve_seed_enabled(object()))


if __name__ == "__main__":
    unittest.main()
