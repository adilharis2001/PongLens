"""YouTube refuses a rendition; the import steps down instead of failing.

Context in the YTDLP_HEIGHTS comment: 1080p started 403-ing partway
through a download while the same video's 720p rendition completed. The
ladder must retry lower for THAT failure and only that failure — a
private or age-restricted video has to surface immediately.
"""
import os
import tempfile
import unittest
from unittest import mock

from worker import worker as W


class StreamRefusedTest(unittest.TestCase):
    def test_recognises_a_cut_off_stream(self):
        self.assertTrue(W._stream_refused(
            "yt-dlp failed (rc=1): ERROR: unable to download video data: "
            "HTTP Error 403: Forbidden"))
        self.assertTrue(W._stream_refused("HTTP Error 403: Forbidden"))

    def test_ignores_unrelated_failures(self):
        self.assertFalse(W._stream_refused(
            "yt-dlp not found at /opt/homebrew/bin/yt-dlp"))
        self.assertFalse(W._stream_refused("Video unavailable"))


class HeightLadderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.local = os.path.join(self.tmp, "input.mp4")

    def _run_with(self, side_effect):
        with mock.patch.object(W, "_run_ytdlp", side_effect=side_effect) as m:
            height = W._download_video("u", self.local, self.tmp)
        return height, m

    def test_first_rung_wins_when_youtube_cooperates(self):
        height, m = self._run_with(lambda *a, **k: None)
        self.assertEqual(height, W.YTDLP_HEIGHTS[0])
        self.assertEqual(m.call_count, 1)

    def test_steps_down_when_the_stream_is_cut_off(self):
        calls = []

        def side_effect(args, timeout):
            calls.append(args)
            if len(calls) == 1:
                raise RuntimeError("ERROR: unable to download video data: "
                                   "HTTP Error 403: Forbidden")

        height, m = self._run_with(side_effect)
        self.assertEqual(height, W.YTDLP_HEIGHTS[1])
        self.assertEqual(m.call_count, 2)
        # the second attempt really did ask for the lower rendition
        self.assertIn(f"height<={W.YTDLP_HEIGHTS[1]}", " ".join(calls[1]))

    def test_a_real_problem_is_not_retried(self):
        def side_effect(args, timeout):
            raise W.UserFacingError("That video is private or unavailable.")

        with mock.patch.object(W, "_run_ytdlp", side_effect=side_effect) as m:
            with self.assertRaises(W.UserFacingError):
                W._download_video("u", self.local, self.tmp)
        self.assertEqual(m.call_count, 1)

    def test_every_rung_refused_raises(self):
        def side_effect(args, timeout):
            raise RuntimeError("HTTP Error 403: Forbidden")

        with mock.patch.object(W, "_run_ytdlp", side_effect=side_effect) as m:
            with self.assertRaises(RuntimeError):
                W._download_video("u", self.local, self.tmp)
        self.assertEqual(m.call_count, len(W.YTDLP_HEIGHTS))

    def test_partial_files_are_cleared_between_attempts(self):
        junk = os.path.join(self.tmp, "input.f137.mp4.part")
        open(junk, "w").close()
        seen = []

        def side_effect(args, timeout):
            seen.append(os.path.exists(junk))
            if len(seen) == 1:
                raise RuntimeError("HTTP Error 403: Forbidden")

        with mock.patch.object(W, "_run_ytdlp", side_effect=side_effect):
            W._download_video("u", self.local, self.tmp)
        # the leftover was gone before both attempts
        self.assertEqual(seen, [False, False])


if __name__ == "__main__":
    unittest.main()
