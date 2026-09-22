"""Starred selections as one 9:16 video (2026-09-22).

The rallies come from different matches, so different cameras: the join has
to cope with a 30 and a 60 fps source and with a camera that recorded no
sound. The render test below builds exactly that out of synthetic cuts and
runs the real render_story and ffmpeg over it.
"""

import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import worker.worker as worker


def _make_cut(path, *, rate, audio):
    command = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", f"testsrc2=size=640x360:rate={rate}:duration=6",
    ]
    if audio:
        command += [
            "-f", "lavfi", "-i",
            "sine=frequency=440:sample_rate=48000:duration=6",
            "-map", "0:v", "-map", "1:a", "-c:a", "aac",
        ]
    else:
        command += ["-map", "0:v", "-an"]
    command += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", str(rate),
                "-movflags", "+faststart", str(path)]
    subprocess.run(command, check=True)


def _point(point_id, match_id, start, end, you=0, them=0):
    return {
        "point_id": point_id,
        "match_id": match_id,
        "clip_path": f"r2://ponglens-media/points/x/{point_id}.mp4",
        "seg_start": start,
        "seg_end": end,
        "score_you": you,
        "score_them": them,
        "games_you": 0,
        "games_them": 0,
        "games_detail": [],
    }


def _manifest(points):
    return {
        "version": 1,
        "format": "story",
        "show_names": True,
        "show_logo": True,
        "points": points,
        "matches": {
            "m-a": {"you_name": "Adil", "them_name": "Jordan",
                    "show_score": True},
            "m-b": {"you_name": "Adil", "them_name": "Nathan",
                    "show_score": False},
        },
    }


class _Cursor:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, *_args, **_kwargs):
        pass

    def fetchone(self):
        return (None,)


class _Conn:
    def cursor(self):
        return _Cursor()


class SelectionManifestTest(unittest.TestCase):
    def test_accepts_a_described_selection(self):
        m = _manifest([_point("p1", "m-a", 0, 2), _point("p2", "m-b", 1, 3)])
        self.assertIsNone(worker.selection_manifest_problem(m))

    def test_refuses_what_it_cannot_render(self):
        self.assertEqual(worker.selection_manifest_problem(None),
                         "manifest is not an object")
        self.assertEqual(worker.selection_manifest_problem(_manifest([])),
                         "no points")
        orphan = _manifest([_point("p1", "m-z", 0, 2)])
        self.assertEqual(
            worker.selection_manifest_problem(orphan),
            "a point names a match the manifest does not describe")
        nameless = _manifest([{"point_id": "p1"}])
        self.assertEqual(worker.selection_manifest_problem(nameless),
                         "a point has no identity")
        many = _manifest([_point(f"p{i}", "m-a", 0, 1)
                          for i in range(worker.SELECTION_REEL_MAX_POINTS + 1)])
        self.assertEqual(worker.selection_manifest_problem(many),
                         "too many points")

    def test_each_rally_carries_its_own_match(self):
        m = _manifest([_point("p1", "m-a", 0, 2, you=3, them=5),
                       _point("p2", "m-b", 1, 3)])
        m["show_logo"] = False
        legs = worker.selection_legs(m)
        self.assertEqual([leg["match_id"] for leg in legs], ["m-a", "m-b"])
        self.assertEqual([leg["show_score"] for leg in legs], [True, False])
        self.assertEqual(legs[0]["manifest"]["them_name"], "Jordan")
        self.assertEqual(legs[1]["manifest"]["them_name"], "Nathan")
        self.assertEqual(legs[0]["manifest"]["points"][0]["score_them"], 5)
        self.assertFalse(legs[0]["manifest"]["show_logo"])
        self.assertTrue(legs[0]["manifest"]["show_names"])


class SelectionJoinGraphTest(unittest.TestCase):
    def test_crossfades_at_the_running_offset(self):
        fc, maps = worker.selection_join_graph([3.0, 4.0, 2.0], 60, True)
        self.assertEqual(fc[0], "[0:v]fps=60,settb=AVTB,setsar=1,"
                                "format=yuv420p[n0]")
        self.assertIn("[n0][n1]xfade=transition=fade:duration=0.3:"
                      "offset=2.7000[v1]", fc)
        self.assertIn("[v1][n2]xfade=transition=fade:duration=0.3:"
                      "offset=6.4000[vout]", fc)
        self.assertIn("[0:a][1:a]acrossfade=d=0.3[a1]", fc)
        self.assertIn("[a1][2:a]acrossfade=d=0.3[aout]", fc)
        self.assertEqual(maps, ["-map", "[vout]", "-map", "[aout]"])

    def test_silent_join_maps_video_only(self):
        fc, maps = worker.selection_join_graph([3.0, 4.0], 30, False)
        self.assertFalse(any("acrossfade" in f for f in fc))
        self.assertEqual(maps, ["-map", "[vout]"])


class SelectionRenderTest(unittest.TestCase):
    def test_two_cameras_become_one_story(self):
        with tempfile.TemporaryDirectory() as tmp:
            cut_a = os.path.join(tmp, "a.mp4")
            cut_b = os.path.join(tmp, "b.mp4")
            _make_cut(cut_a, rate=30, audio=True)
            _make_cut(cut_b, rate=60, audio=False)
            m = _manifest([
                _point("p1", "m-a", 0.5, 2.5, you=4, them=2),
                _point("p2", "m-b", 1.0, 3.0),
                _point("p3", "m-a", 3.0, 5.0, you=5, them=2),
            ])
            sources = (("p1", "m-a", "v1", "v1"), ("p2", "m-b", "v2", "v2"),
                       ("p3", "m-a", "v1", "v1"))
            cuts = {"m-a": cut_a, "m-b": cut_b}
            progress = []
            with patch.object(worker, "_cut_video_url",
                              side_effect=lambda _c, mid, **_k: cuts[mid]):
                out = worker.render_selection(
                    _Conn(), m, sources, tmp,
                    on_rally=lambda done, total: progress.append((done, total)))
            probe = worker._ffprobe_streams(out)
            video = next(s for s in probe["streams"]
                         if s["codec_type"] == "video")
            self.assertEqual((int(video["width"]), int(video["height"])),
                             (worker.STORY_W, worker.STORY_H))
            # One camera had no sound, so the whole video is silent.
            self.assertFalse(any(s["codec_type"] == "audio"
                                 for s in probe["streams"]))
            self.assertEqual(worker._story_fps(out), 60)
            # Three 2 s rallies, two 0.3 s crossfades.
            self.assertAlmostEqual(float(probe["format"]["duration"]), 5.4,
                                   delta=0.2)
            self.assertEqual(progress, [(1, 3), (2, 3), (3, 3)])

    def test_one_rally_is_the_single_rally_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            cut_a = os.path.join(tmp, "a.mp4")
            _make_cut(cut_a, rate=30, audio=True)
            m = _manifest([_point("p1", "m-a", 0.5, 2.5)])
            with patch.object(worker, "_cut_video_url",
                              side_effect=lambda *_a, **_k: cut_a):
                out = worker.render_selection(
                    _Conn(), m, (("p1", "m-a", "v1", "v1"),), tmp)
            self.assertTrue(out.endswith(os.path.join("rally-00", "story.mp4")))
            probe = worker._ffprobe_streams(out)
            self.assertTrue(any(s["codec_type"] == "audio"
                                for s in probe["streams"]))
            # The camera's own rate, not the still background's 25.
            self.assertEqual(worker._story_fps(out), 30)
            self.assertAlmostEqual(float(probe["format"]["duration"]), 2.0,
                                   delta=0.1)


if __name__ == "__main__":
    unittest.main()
