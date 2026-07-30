import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from worker.extract_service_motion_rtmpose import (
    extract_pose_window,
    window_frame_indices,
)


class FrameWindowTests(unittest.TestCase):
    def test_window_is_bounded_and_sampled_at_fifteen_fps(self):
        frames = window_frame_indices(
            first_bounce_t=2.0,
            fps=30.0,
            frame_count=120,
            sample_fps=15.0,
        )

        self.assertEqual(frames[0], 24)
        self.assertEqual(frames[-1], 62)
        self.assertTrue(all(right - left == 2 for left, right in zip(
            frames,
            frames[1:],
        )))
        self.assertLessEqual(len(frames), 20)

    def test_window_clamps_to_video_bounds(self):
        self.assertEqual(
            window_frame_indices(
                first_bounce_t=0.2,
                fps=25.0,
                frame_count=8,
                sample_fps=15.0,
            ),
            [0, 2, 4, 6],
        )

    def test_extended_window_preserves_original_core_sampling_phase(self):
        frames = window_frame_indices(
            first_bounce_t=2.0,
            fps=25.0,
            frame_count=100,
            sample_fps=15.0,
        )

        core = [frame for frame in frames if frame >= 25]
        self.assertEqual(core[:4], [25, 27, 29, 31])


class FakePoseModel:
    def __call__(self, image, bboxes):
        del image
        people = len(bboxes)
        keypoints = np.zeros((people, 17, 2), dtype=np.float32)
        scores = np.full((people, 17), 0.9, dtype=np.float32)
        for index, box in enumerate(bboxes):
            keypoints[index, :, 0] = (box[0] + box[2]) / 2.0
            keypoints[index, :, 1] = np.linspace(
                box[1],
                box[3],
                17,
            )
        return keypoints, scores


class PoseWindowExtractionTests(unittest.TestCase):
    def test_extracts_only_requested_pose_summaries_and_compute(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            video = root / "clip.mp4"
            writer = cv2.VideoWriter(
                str(video),
                cv2.VideoWriter_fourcc(*"mp4v"),
                30.0,
                (96, 64),
            )
            self.assertTrue(writer.isOpened())
            try:
                for value in range(12):
                    writer.write(
                        np.full(
                            (64, 96, 3),
                            value * 8,
                            dtype=np.uint8,
                        )
                    )
            finally:
                writer.release()

            poses, compute = extract_pose_window(
                video,
                frame_indices=[2, 4, 6],
                regions={
                    "near": [0, 20, 48, 64],
                    "far": [48, 0, 96, 44],
                },
                pose_model=FakePoseModel(),
            )

            self.assertEqual(sorted(poses), [2, 4, 6])
            self.assertEqual(set(poses[2]), {"near", "far"})
            self.assertEqual(len(poses[2]["near"]["kpts"]), 17)
            self.assertEqual(compute["decoded_frames"], 3)
            self.assertEqual(compute["posed_frames"], 6)
            self.assertGreaterEqual(compute["elapsed_s"], 0)
            self.assertGreaterEqual(compute["peak_rss_mb"], 0)
            self.assertNotIn("frames", compute)
            self.assertNotIn("images", compute)


if __name__ == "__main__":
    unittest.main()
