import json
import tempfile
import unittest
from pathlib import Path

from worker.temporal_serve_manifest import (
    build_manifest,
    validate_manifest,
    write_manifest_atomic,
)


def _point(match_number: int, point_number: int) -> dict:
    return {
        "id": f"point-{match_number:02d}-{point_number:02d}",
        "idx": point_number + 1,
        "t0": float(point_number),
        "confirmed_winner": "user" if point_number % 2 == 0 else "opponent",
        "is_let": False,
        "server_override": None,
        "game_end_override": None,
        "clip_path": f"r2://media/point-{match_number:02d}-{point_number:02d}.mp4",
        "clip_sha256": f"{match_number:02x}{point_number:02x}".ljust(64, "a"),
        "placement": {"version": 3},
    }


def _match(number: int, *, chris: bool = False) -> dict:
    return {
        "id": "new-chris" if chris else f"match-{number:02d}",
        "label": "Chris" if chris else f"Opponent {number:02d}",
        "opponent_name": "Chris" if chris else f"Opponent {number:02d}",
        "created_at": (
            "2026-07-30T22:15:00Z"
            if chris
            else f"2026-07-{(number % 28) + 1:02d}T12:00:00Z"
        ),
        "first_server": "user" if number % 2 == 0 else "opponent",
        "first_server_source": "user",
        "user_side": "near",
        "calibration": {
            "ok": True,
            "table_corners_px": {
                "near_left": [0, 100],
                "near_right": [200, 100],
                "far_left": [40, 20],
                "far_right": [160, 20],
            },
        },
        "points": [_point(number, point) for point in range(20)],
    }


class FakeProduction:
    def __init__(self, matches):
        self.matches = matches

    def list_temporal_serve_matches(self):
        return list(self.matches)


def _eligible_matches(count: int) -> list[dict]:
    matches = [_match(number) for number in range(count - 1)]
    matches.append(_match(count - 1, chris=True))
    return matches


class ManifestTests(unittest.TestCase):
    def test_chris_canary_date_is_interpreted_in_uploader_timezone(self):
        matches = _eligible_matches(12)
        chris = next(match for match in matches if match["id"] == "new-chris")
        chris["created_at"] = "2026-07-31T02:24:17+00:00"

        manifest = build_manifest(
            FakeProduction(matches),
            target_points=240,
            minimum_matches=12,
            chris_date="2026-07-30",
            canary_timezone="America/New_York",
        )

        self.assertIn("new-chris", {
            item["match_id"] for item in manifest["splits"]["holdout"]
        })

    def test_split_is_by_match_and_new_chris_is_holdout(self):
        manifest = build_manifest(
            FakeProduction(_eligible_matches(30)),
            target_points=600,
            minimum_matches=30,
            chris_date="2026-07-30",
        )

        splits = {
            name: {item["match_id"] for item in manifest["splits"][name]}
            for name in ("train", "development", "holdout")
        }
        self.assertFalse(splits["train"] & splits["development"])
        self.assertFalse(splits["train"] & splits["holdout"])
        self.assertFalse(splits["development"] & splits["holdout"])
        self.assertIn("new-chris", splits["holdout"])
        self.assertEqual(len(splits["holdout"]), 10)
        self.assertEqual(manifest["status"], "complete")
        self.assertEqual(manifest["counts"]["points"], 600)

    def test_rotation_truth_is_separate_from_blinded_model_input(self):
        manifest = build_manifest(
            FakeProduction(_eligible_matches(30)),
            target_points=600,
            minimum_matches=30,
            chris_date="2026-07-30",
        )
        first_match = manifest["splits"]["train"][0]
        first = first_match["points"][0]
        second = first_match["points"][1]
        third = first_match["points"][2]

        self.assertIn(first["evaluation"]["expected_server_side"], {"near", "far"})
        self.assertEqual(
            first["evaluation"]["expected_server_side"],
            second["evaluation"]["expected_server_side"],
        )
        self.assertNotEqual(
            second["evaluation"]["expected_server_side"],
            third["evaluation"]["expected_server_side"],
        )
        serialized = json.dumps(first["model_input"])
        self.assertNotIn("first_server", serialized)
        self.assertNotIn("expected_server_side", serialized)
        self.assertNotIn("confirmed_winner", serialized)

    def test_manifest_rejects_truth_inside_model_input(self):
        manifest = build_manifest(
            FakeProduction(_eligible_matches(30)),
            target_points=600,
            minimum_matches=30,
            chris_date="2026-07-30",
        )
        manifest["splits"]["train"][0]["points"][0]["model_input"] = {
            "first_server": "near"
        }

        with self.assertRaisesRegex(ValueError, "forbidden model input"):
            validate_manifest(manifest)

    def test_fewer_than_minimum_matches_is_preliminary(self):
        manifest = build_manifest(
            FakeProduction(_eligible_matches(12)),
            target_points=240,
            minimum_matches=30,
            chris_date="2026-07-30",
        )

        self.assertEqual(manifest["status"], "preliminary")
        self.assertEqual(manifest["counts"]["matches"], 12)
        self.assertIn("new-chris", {
            item["match_id"] for item in manifest["splits"]["holdout"]
        })

    def test_atomic_writer_round_trips_a_valid_manifest(self):
        manifest = build_manifest(
            FakeProduction(_eligible_matches(30)),
            target_points=600,
            minimum_matches=30,
            chris_date="2026-07-30",
        )
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "manifest.json"
            write_manifest_atomic(path, manifest)
            self.assertEqual(json.loads(path.read_text()), manifest)
            self.assertFalse((Path(raw) / ".manifest.json.tmp").exists())


if __name__ == "__main__":
    unittest.main()
