"""The second detection pass on a vision-calibrated table (2026-09-06).

The decision is pure and tested directly; the fail-open path is exercised
with the detector and the points stage replaced by stubs.
"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import worker                                                 # noqa: E402

# Anton's short match as production stored it: the vision calibrator's
# net-post diamond on the PingPod W37 booth, shape 0.49, the case the
# second pass exists for.
VISION = {"ok": True, "source": "vision",
          "table_corners_px": {"A_near_1": [846.0, 571.2],
                               "B_near_2": [1112.4, 608.4],
                               "C_far_2": [1317.6, 562.8],
                               "D_far_1": [1111.2, 534.0]}}
KEYPOINTS = dict(VISION, source="keypoints")
FULL = {"box": None, "corners_from": None, "reason": "no table"}
CROPPED = {"box": [468, 174, 1128, 634], "corners_from": "keypoints"}


class Decision(unittest.TestCase):

    def test_the_case_it_exists_for(self):
        wanted, why = worker.second_pass_wanted(True, FULL, VISION)
        self.assertTrue(wanted, why)

    def test_never_when_the_crop_is_off(self):
        self.assertFalse(worker.second_pass_wanted(False, FULL, VISION)[0])

    def test_never_when_the_first_pass_already_cropped(self):
        self.assertFalse(worker.second_pass_wanted(True, CROPPED, VISION)[0])

    def test_never_for_a_keypoint_table(self):
        # the keypoint rung ran before detection; if it declined then, a
        # second pass has nothing new to crop to
        self.assertFalse(worker.second_pass_wanted(True, FULL, KEYPOINTS)[0])

    def test_never_without_a_table(self):
        self.assertFalse(worker.second_pass_wanted(True, FULL, None)[0])
        self.assertFalse(worker.second_pass_wanted(True, FULL, {"ok": False})[0])

    def test_never_when_the_table_reads_end_on(self):
        side = dict(FULL, reason="end-on table")
        self.assertFalse(worker.second_pass_wanted(True, side, VISION)[0])
        endon = dict(VISION, table_corners_px={
            "A_near_1": [868.2, 741.3], "B_near_2": [1260.3, 699.9],
            "C_far_2": [1036.1, 604.4], "D_far_1": [804.9, 621.0]})
        self.assertFalse(worker.second_pass_wanted(True, FULL, endon)[0])


class Note(unittest.TestCase):

    def test_the_sentence_says_what_the_detector_saw(self):
        self.assertEqual(worker.detections_note_from_sidecar(CROPPED),
                         "detections: crop 1128x634 at (468,174), corners "
                         "from keypoints")
        self.assertEqual(worker.detections_note_from_sidecar(FULL),
                         "detections: full frame (no table)")
        self.assertEqual(worker.detections_note_from_sidecar({}),
                         "detections: full frame")


class FailOpen(unittest.TestCase):

    def _workdir(self, d):
        outdir = os.path.join(d, "points_out")
        os.makedirs(outdir)
        with open(os.path.join(outdir, "match.json"), "w") as fh:
            json.dump({"calibration": VISION, "notes": ["first"],
                       "points": [{"idx": 0}]}, fh)
        with open(os.path.join(outdir, "calibration.json"), "w") as fh:
            json.dump({"corners_px": VISION["table_corners_px"]}, fh)
        det = os.path.join(d, "blurball.jsonl")
        with open(det, "w") as fh:
            fh.write('{"f": 0, "x": 1.0, "y": 2.0}\n')
        with open(os.path.join(d, worker.BALL_CROP_SIDECAR), "w") as fh:
            json.dump(FULL, fh)
        return outdir, det

    def test_a_crashing_detector_leaves_the_first_pass_in_place(self):
        with tempfile.TemporaryDirectory() as d:
            outdir, det = self._workdir(d)
            with mock.patch.object(worker, "pulse_stage"), \
                    mock.patch.object(worker, "detect_ball",
                                      side_effect=RuntimeError("boom")):
                got = worker.rerun_points_on_vision_crop(
                    "in.mp4", det, d, {}, ball_crop=True, points_kwargs={})
            self.assertEqual(got, outdir)
            with open(os.path.join(outdir, "match.json")) as fh:
                mj = json.load(fh)
            self.assertEqual(mj["points"], [{"idx": 0}])
            self.assertIn("second pass failed (boom); kept the full-frame "
                          "points", mj["notes"])
            with open(det) as fh:
                self.assertEqual(fh.read(), '{"f": 0, "x": 1.0, "y": 2.0}\n')
            self.assertFalse(os.path.exists(outdir + ".fullframe"))

    def test_a_second_pass_that_finds_no_box_is_undone(self):
        with tempfile.TemporaryDirectory() as d:
            outdir, det = self._workdir(d)

            def fake_detect(video, workdir, **kw):
                with open(os.path.join(workdir, worker.BALL_CROP_SIDECAR), "w") as fh:
                    json.dump({"box": None, "reason": "no usable box"}, fh)
                return det

            with mock.patch.object(worker, "pulse_stage"), \
                    mock.patch.object(worker, "detect_ball", side_effect=fake_detect), \
                    mock.patch.object(worker, "run_points_subprocess") as rps:
                got = worker.rerun_points_on_vision_crop(
                    "in.mp4", det, d, {}, ball_crop=True, points_kwargs={})
            rps.assert_not_called()
            with open(os.path.join(got, "match.json")) as fh:
                self.assertIn("kept the full-frame points",
                              " ".join(json.load(fh)["notes"]))

    def test_a_good_second_pass_replaces_the_points(self):
        with tempfile.TemporaryDirectory() as d:
            outdir, det = self._workdir(d)
            seen = {}

            def fake_detect(video, workdir, **kw):
                with open(os.path.join(workdir, worker.BALL_CROP_SIDECAR), "w") as fh:
                    json.dump({"box": [10, 20, 300, 200], "corners_from": "job"}, fh)
                return det

            def fake_points(video, blurball, workdir, options, **kw):
                seen.update(kw)
                os.makedirs(outdir)
                with open(os.path.join(outdir, "match.json"), "w") as fh:
                    json.dump({"notes": [kw["detections_note"]],
                               "points": [{"idx": 0}, {"idx": 1}]}, fh)
                return outdir

            with mock.patch.object(worker, "pulse_stage"), \
                    mock.patch.object(worker, "detect_ball", side_effect=fake_detect), \
                    mock.patch.object(worker, "run_points_subprocess", side_effect=fake_points):
                got = worker.rerun_points_on_vision_crop(
                    "in.mp4", det, d, {}, ball_crop=True,
                    points_kwargs={"pipeline": "v2"})
            self.assertEqual(got, outdir)
            self.assertEqual(seen["pipeline"], "v2")
            self.assertEqual(seen["calibration_json"],
                             os.path.join(outdir + ".fullframe", "calibration.json"))
            self.assertEqual(seen["detections_note"],
                             "detections: crop 300x200 at (10,20), corners from "
                             "job, second pass")
            with open(os.path.join(outdir, "match.json")) as fh:
                self.assertEqual(len(json.load(fh)["points"]), 2)
            self.assertTrue(os.path.isdir(outdir + ".fullframe"))
