"""The gate that refuses professionally produced match footage.

Both halves of this gate exist because the other one, on its own, rejected
a video a real person uploaded. That is measured, not hypothetical
(2026-08-22, 26 real videos and 6 broadcasts):

  - the vision half alone called a real under-13 tournament a broadcast on
    12 of 12 frames: a parent's tripod, an umpire at a flip scoreboard and
    equipment-sponsor barriers read as "tournament";
  - the cut half alone flagged a player's own highlights reel at 14 frames,
    inside the broadcast band of 13 to 34.

So the rule is an AND, and the tests below pin it as one. A change that
lets either half reject on its own is the change that starts turning away
paying players.
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from worker import worker  # noqa: E402


class ThresholdsMatchTheMeasurements(unittest.TestCase):
    """The numbers are not round for a reason; each sits in a measured gap."""

    def test_cut_threshold_sits_between_real_footage_and_broadcast(self):
        # real footage topped out at 2 frames, broadcast bottomed at 13
        self.assertGreater(worker.BROADCAST_CUT_FRAMES, 2)
        self.assertLess(worker.BROADCAST_CUT_FRAMES, 13)

    def test_vision_threshold_sits_between_real_footage_and_broadcast(self):
        """Only videos that cleared the cut half reach this number, so it
        separates a player's own edit (median 0 on 9 trials of 9) from a
        broadcast. The thin case is a highlights compilation of pro
        rallies, which read as low as a median of 3."""
        self.assertGreater(worker.BROADCAST_MIN_VISION, 1)
        self.assertLessEqual(worker.BROADCAST_MIN_VISION, 3)

    def test_the_vision_half_is_polled_more_than_once(self):
        """One bad roll flips every frame in the batch at once. A real
        PingPod session came back 12 of 12 on one trial of three."""
        self.assertGreaterEqual(worker.BROADCAST_VISION_TRIALS, 3)
        self.assertEqual(worker.BROADCAST_VISION_TRIALS % 2, 1,
                         "an even number of trials has no median")

    def test_the_two_gates_refuse_with_different_words(self):
        self.assertNotEqual(worker.BROADCAST_REJECT_MSG,
                            worker.CONTENT_CHECK_REJECT_MSG)
        self.assertIn(worker.BROADCAST_REJECT_MSG, worker.GATE_REJECT_MSGS)
        self.assertIn(worker.CONTENT_CHECK_REJECT_MSG,
                      worker.GATE_REJECT_MSGS)


class BothSignalsAreRequired(unittest.TestCase):
    def _run(self, cuts, votes, examined=1196, frames=12):
        with mock.patch.object(worker, "SKIP_BROADCAST_CHECK", False), \
             mock.patch.object(worker, "OPENAI_API_KEY", "k"), \
             mock.patch.object(worker, "_camera_cut_frames",
                               return_value=(cuts, examined)), \
             mock.patch.object(worker, "_sample_frames",
                               return_value=["f"] * frames), \
             mock.patch.object(worker, "_broadcast_vision_votes",
                               return_value=votes) as vision:
            got = worker.looks_like_broadcast("v.mp4", "/tmp")
        return got, vision

    def test_a_real_broadcast_is_refused(self):
        got, _ = self._run(cuts=27, votes=[11, 12, 12])
        self.assertTrue(got)

    def test_the_lowest_measured_broadcast_is_still_refused(self):
        """Top 14 Impossible Rallies, the thin case. Two frame samples of
        the same video read 4/6/7 and 8/3/3; both must still refuse."""
        for votes in ([4, 6, 7], [8, 3, 3]):
            with self.subTest(votes=votes):
                got, _ = self._run(cuts=15, votes=votes)
                self.assertTrue(got)

    def test_a_players_own_highlights_reel_is_accepted(self):
        """Cuts alone would reject this. The vision half is what saves it,
        and it is the reason the gate is an AND."""
        got, _ = self._run(cuts=14, votes=[0, 0, 0])
        self.assertFalse(got)

    def test_a_real_tournament_never_reaches_the_vision_call(self):
        """The under-13 tournament scored 1 cut. The cheap half answers
        first, so a video like it costs nothing at all to clear."""
        got, vision = self._run(cuts=1, votes=[12, 12, 12])
        self.assertFalse(got)
        vision.assert_not_called()

    def test_an_ordinary_upload_never_reaches_the_vision_call(self):
        got, vision = self._run(cuts=0, votes=[0, 0, 0])
        self.assertFalse(got)
        vision.assert_not_called()

    def test_one_stray_high_trial_does_not_decide_it(self):
        """The observed flip was 12/0/0 on a real PingPod session."""
        got, _ = self._run(cuts=9, votes=[12, 0, 0])
        self.assertFalse(got)

    def test_one_stray_low_trial_does_not_rescue_a_broadcast(self):
        got, _ = self._run(cuts=26, votes=[0, 12, 12])
        self.assertTrue(got)


class FailsOpen(unittest.TestCase):
    """Every uncertain answer must let the video through. Turning away a
    player's own match is worse than processing a broadcast."""

    def test_the_kill_switch_short_circuits(self):
        with mock.patch.object(worker, "SKIP_BROADCAST_CHECK", True), \
             mock.patch.object(worker, "_camera_cut_frames") as cuts:
            self.assertFalse(worker.looks_like_broadcast("v.mp4", "/tmp"))
        cuts.assert_not_called()

    def test_nothing_decoded_is_not_a_broadcast(self):
        with mock.patch.object(worker, "SKIP_BROADCAST_CHECK", False), \
             mock.patch.object(worker, "_camera_cut_frames",
                               return_value=(0, 0)):
            self.assertFalse(worker.looks_like_broadcast("v.mp4", "/tmp"))

    def test_a_missing_api_key_is_not_a_broadcast(self):
        with mock.patch.object(worker, "SKIP_BROADCAST_CHECK", False), \
             mock.patch.object(worker, "OPENAI_API_KEY", ""), \
             mock.patch.object(worker, "_camera_cut_frames",
                               return_value=(30, 1196)):
            self.assertFalse(worker.looks_like_broadcast("v.mp4", "/tmp"))

    def test_a_raising_vision_call_is_not_a_broadcast(self):
        with mock.patch.object(worker, "SKIP_BROADCAST_CHECK", False), \
             mock.patch.object(worker, "OPENAI_API_KEY", "k"), \
             mock.patch.object(worker, "_camera_cut_frames",
                               return_value=(30, 1196)), \
             mock.patch.object(worker, "_sample_frames",
                               return_value=["f"] * 12), \
             mock.patch.object(worker, "_broadcast_vision_votes",
                               side_effect=RuntimeError("502")):
            self.assertFalse(worker.looks_like_broadcast("v.mp4", "/tmp"))

    def test_too_few_frames_is_not_a_broadcast(self):
        with mock.patch.object(worker, "SKIP_BROADCAST_CHECK", False), \
             mock.patch.object(worker, "OPENAI_API_KEY", "k"), \
             mock.patch.object(worker, "_camera_cut_frames",
                               return_value=(30, 1196)), \
             mock.patch.object(worker, "_sample_frames",
                               return_value=["f", "f"]):
            self.assertFalse(worker.looks_like_broadcast("v.mp4", "/tmp"))


class FramesDoNotCollide(unittest.TestCase):
    def test_the_two_gates_sample_into_different_directories(self):
        """Both gates sample the same video moments apart, at identical
        filenames. Sharing a directory means the second silently overwrites
        the first."""
        import inspect
        src = inspect.getsource(worker.looks_like_broadcast)
        self.assertIn('subdir="broadcast_check"', src)
        self.assertEqual(
            inspect.signature(worker._sample_frames)
            .parameters["subdir"].default, "content_check")


if __name__ == "__main__":
    unittest.main()
