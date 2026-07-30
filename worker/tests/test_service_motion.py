import copy
import unittest

from worker.service_motion import analyze_service_motion


FPS = 30.0
FIRST_BOUNCE_T = 1.0
FRAMES = list(range(0, 32, 2))


def _player(
    *,
    center_x: float,
    toss_wrist_y: float,
    racket_wrist_x: float,
    racket_wrist_y: float,
) -> dict:
    keypoints = [[center_x, 100.0, 0.95] for _ in range(17)]
    keypoints[5] = [center_x - 18.0, 100.0, 0.95]
    keypoints[6] = [center_x + 18.0, 100.0, 0.95]
    keypoints[7] = [center_x - 22.0, 118.0, 0.95]
    keypoints[8] = [center_x + 22.0, 118.0, 0.95]
    keypoints[9] = [center_x - 20.0, toss_wrist_y, 0.95]
    keypoints[10] = [
        racket_wrist_x,
        racket_wrist_y,
        0.95,
    ]
    keypoints[11] = [center_x - 12.0, 150.0, 0.95]
    keypoints[12] = [center_x + 12.0, 150.0, 0.95]
    return {
        "bbox": [center_x - 55.0, 55.0, center_x + 55.0, 180.0],
        "kpts": keypoints,
    }


def near_serve_fixture() -> tuple[dict, dict]:
    detections = {}
    poses = {}
    for frame in FRAMES:
        if frame < 8:
            toss_y = 136.0
            racket_x = 142.0
            racket_y = 136.0
            ball_x = 100.0
            ball_y = 134.0
        elif frame <= 18:
            toss_y = 136.0 - (frame - 8) * 5.2
            racket_x = 142.0
            racket_y = 136.0
            ball_x = 100.0
            ball_y = 132.0 - (frame - 8) * 5.5
        else:
            toss_y = 84.0
            racket_x = 142.0 - (frame - 18) * 4.2
            racket_y = 136.0 - (frame - 18) * 3.8
            ball_x = 100.0 + (frame - 18) * 7.0
            ball_y = 77.0 + (frame - 18) * 5.0
        detections[frame] = (ball_x, ball_y)
        poses[frame] = {
            "near": _player(
                center_x=120.0,
                toss_wrist_y=toss_y,
                racket_wrist_x=racket_x,
                racket_wrist_y=racket_y,
            ),
            "far": _player(
                center_x=320.0,
                toss_wrist_y=136.0,
                racket_wrist_x=342.0,
                racket_wrist_y=136.0,
            ),
        }
    return detections, poses


def mirror_fixture(
    detections: dict,
    poses: dict,
) -> tuple[dict, dict]:
    mirrored_poses = {
        frame: {
            "near": copy.deepcopy(frame_poses["far"]),
            "far": copy.deepcopy(frame_poses["near"]),
        }
        for frame, frame_poses in poses.items()
    }
    mirrored_detections = {
        frame: (x + 200.0, y) for frame, (x, y) in detections.items()
    }
    return mirrored_detections, mirrored_poses


def transform_fixture(
    detections: dict,
    poses: dict,
    *,
    scale: float,
    dx: float,
    dy: float,
) -> tuple[dict, dict]:
    transformed_detections = {
        frame: (x * scale + dx, y * scale + dy)
        for frame, (x, y) in detections.items()
    }
    transformed_poses = copy.deepcopy(poses)
    for frame_poses in transformed_poses.values():
        for player in frame_poses.values():
            player["bbox"] = [
                player["bbox"][0] * scale + dx,
                player["bbox"][1] * scale + dy,
                player["bbox"][2] * scale + dx,
                player["bbox"][3] * scale + dy,
            ]
            for point in player["kpts"]:
                point[0] = point[0] * scale + dx
                point[1] = point[1] * scale + dy
    return transformed_detections, transformed_poses


def add_early_preparation(
    poses: dict,
    *,
    isolated: bool = False,
) -> dict:
    prepared = copy.deepcopy(poses)
    for frame in FRAMES:
        player = prepared[frame]["near"]
        if isolated:
            progress = 1.0 if frame == 2 else 0.0
        elif frame < 4:
            progress = 0.0
        else:
            progress = min(1.0, (frame - 2) / 6.0)
        player["kpts"][5][0] -= 7.0 * progress
        player["kpts"][5][1] -= 5.0 * progress
        player["kpts"][7][0] -= 13.0 * progress
        player["kpts"][7][1] -= 9.0 * progress
    return prepared


class ServiceMotionAttributionTests(unittest.TestCase):
    def test_attributes_coherent_toss_and_racket_motion_to_near_player(self):
        detections, poses = near_serve_fixture()

        result = analyze_service_motion(
            detections,
            poses,
            FPS,
            FIRST_BOUNCE_T,
            audio_candidates=[{"t": 0.9, "confidence": 2.2}],
        )

        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["side"], "near")
        self.assertIsNotNone(result["onset_t"])
        self.assertIsNotNone(result["contact_t"])
        self.assertLess(result["onset_t"], result["contact_t"])
        self.assertLess(result["contact_t"], FIRST_BOUNCE_T)
        self.assertGreater(result["scores"]["near"], result["scores"]["far"])
        self.assertNotIn("poses", result)
        self.assertNotIn("frames", result)

    def test_accepts_research_audio_time_schema(self):
        detections, poses = near_serve_fixture()

        result = analyze_service_motion(
            detections,
            poses,
            FPS,
            FIRST_BOUNCE_T,
            audio_candidates=[{"time_s": 0.9, "confidence": 2.2}],
        )

        self.assertEqual(result["side"], "near")

    def test_attributes_mirrored_motion_to_far_player(self):
        detections, poses = near_serve_fixture()
        detections, poses = mirror_fixture(detections, poses)

        result = analyze_service_motion(
            detections,
            poses,
            FPS,
            FIRST_BOUNCE_T,
        )

        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["side"], "far")

    def test_withholds_when_both_players_raise_a_wrist_without_ball_departure(self):
        detections = {frame: (210.0, 134.0) for frame in FRAMES}
        poses = {}
        for frame in FRAMES:
            wrist_y = 136.0 - max(0, frame - 8) * 4.0
            poses[frame] = {
                "near": _player(
                    center_x=120.0,
                    toss_wrist_y=wrist_y,
                    racket_wrist_x=142.0,
                    racket_wrist_y=136.0,
                ),
                "far": _player(
                    center_x=320.0,
                    toss_wrist_y=wrist_y,
                    racket_wrist_x=342.0,
                    racket_wrist_y=136.0,
                ),
            }

        result = analyze_service_motion(
            detections,
            poses,
            FPS,
            FIRST_BOUNCE_T,
        )

        self.assertEqual(result["status"], "withheld")
        self.assertIsNone(result["side"])
        self.assertIsNone(result["onset_t"])

    def test_normalized_features_are_translation_and_scale_invariant(self):
        detections, poses = near_serve_fixture()
        transformed_detections, transformed_poses = transform_fixture(
            detections,
            poses,
            scale=1.7,
            dx=83.0,
            dy=41.0,
        )

        original = analyze_service_motion(
            detections,
            poses,
            FPS,
            FIRST_BOUNCE_T,
        )
        transformed = analyze_service_motion(
            transformed_detections,
            transformed_poses,
            FPS,
            FIRST_BOUNCE_T,
        )

        self.assertEqual(original["side"], transformed["side"])
        self.assertAlmostEqual(
            original["scores"]["near"],
            transformed["scores"]["near"],
            places=3,
        )
        self.assertEqual(original["onset_t"], transformed["onset_t"])

    def test_backtracks_through_continuous_elbow_and_shoulder_preparation(self):
        detections, poses = near_serve_fixture()
        poses = add_early_preparation(poses)

        result = analyze_service_motion(
            detections,
            poses,
            FPS,
            FIRST_BOUNCE_T,
        )

        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["version"], 2)
        self.assertAlmostEqual(result["onset_t"], 4 / FPS, places=4)
        self.assertGreaterEqual(result["contact_approach_t"], 6 / FPS)
        self.assertLess(result["onset_t"], result["contact_approach_t"])
        self.assertIn(
            "elbow",
            result["features"]["near"]["onset_families"],
        )
        self.assertIn(
            "shoulder",
            result["features"]["near"]["onset_families"],
        )

    def test_does_not_backtrack_to_disconnected_early_arm_movement(self):
        detections, poses = near_serve_fixture()
        poses = add_early_preparation(poses, isolated=True)

        result = analyze_service_motion(
            detections,
            poses,
            FPS,
            FIRST_BOUNCE_T,
        )

        self.assertEqual(result["status"], "high_confidence")
        self.assertGreater(result["onset_t"], 2 / FPS)
        self.assertLessEqual(
            result["onset_t"],
            result["contact_approach_t"],
        )


if __name__ == "__main__":
    unittest.main()
