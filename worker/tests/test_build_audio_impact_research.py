from collections import Counter
from copy import deepcopy
from pathlib import Path
import subprocess
import sys
import unittest

from botocore.exceptions import ClientError

from worker.build_audio_impact_research import (
    BATCH_SLUG,
    available_source_fingerprint,
    build_cohort_manifest,
    canonical_hash,
    choose_recordings,
    round_b_acquisition_inputs,
    recording_raw_identity,
    recent_venue_matches,
    rest_get_all,
    select_round_points,
    validate_existing_seed,
    venue_category,
    verified_manifest,
)


VENUES = ("pingpod", "westchester", "lyttc")


def point(recording_id, number, *, acquisition_score=None):
    return {
        "id": f"point-{recording_id}-{number:02d}",
        "match_id": recording_id,
        "idx": number,
        "source_time_s": float(number * 10),
        "clip_path": f"r2://ponglens-media/points/{recording_id}/{number}.mp4",
        "acquisition_score": (
            float(acquisition_score)
            if acquisition_score is not None
            else float(number)
        ),
    }


def recording(venue, number, *, played_day=None, source_hash=None, cropped=False, count=20):
    recording_id = f"{venue}-{number}"
    return {
        "id": recording_id,
        "opponent_name": f"Opponent {number}{' (cropped)' if cropped else ''}",
        "venue": {
            "pingpod": "PingPod",
            "westchester": "Westchester TTC",
            "lyttc": "LYTTC",
        }[venue],
        "venue_category": venue,
        "played_at": f"2026-08-{played_day or 30 - number:02d}T12:00:00+00:00",
        "status": "ready",
        "raw_identity": f"r2://raw/{recording_id}.mov",
        "source_sha256": source_hash or f"{number + VENUES.index(venue) * 20:064x}",
        "points": [point(recording_id, index) for index in range(1, count + 1)],
    }


class VenueTests(unittest.TestCase):
    def test_normalizes_the_three_explicit_venue_families(self):
        self.assertEqual(venue_category("PingPod W37"), "pingpod")
        self.assertEqual(venue_category("Westchester TTC"), "westchester")
        self.assertEqual(venue_category("LYTTC"), "lyttc")
        self.assertIsNone(venue_category("Koko FitClub"))

    def test_builder_can_be_invoked_directly_from_the_repository_root(self):
        script = Path(__file__).resolve().parents[1] / "build_audio_impact_research.py"

        completed = subprocess.run(
            [sys.executable, str(script), "--help"],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("--seed", completed.stdout)

    def test_raw_identity_prefers_match_retention_and_falls_back_to_legacy_job_input(self):
        self.assertEqual(
            recording_raw_identity(
                {"raw_path": "r2://raw/match.mov"},
                {"input_path": "r2://raw/job.mov"},
            ),
            "r2://raw/match.mov",
        )
        self.assertEqual(
            recording_raw_identity(
                {"raw_path": None},
                {"input_path": "r2://raw/job.mov"},
            ),
            "r2://raw/job.mov",
        )

    def test_missing_retained_raw_media_is_ineligible_instead_of_aborting_inventory(self):
        class MissingR2:
            def head_object(self, **_kwargs):
                raise ClientError(
                    {"Error": {"Code": "404", "Message": "Not Found"}},
                    "HeadObject",
                )

        production = type("Production", (), {"r2": MissingR2()})()

        self.assertIsNone(
            available_source_fingerprint(
                production,
                "r2://ponglens-raw/user/missing.mov",
            )
        )

    def test_live_inventory_caps_each_venue_before_the_point_query(self):
        matches = []
        for venue in VENUES:
            for number in range(20):
                matches.append(
                    {
                        "id": f"{venue}-{number}",
                        "venue": venue,
                        "played_at": f"2026-08-{number + 1:02d}T12:00:00+00:00",
                    }
                )

        recent = recent_venue_matches(matches, per_venue=12)

        self.assertEqual(Counter(venue_category(item["venue"]) for item in recent), Counter({venue: 12 for venue in VENUES}))
        self.assertTrue(all(any(item["id"] == f"{venue}-19" for item in recent) for venue in VENUES))

    def test_point_inventory_pages_past_the_hosted_api_thousand_row_cap(self):
        calls = []

        class Response:
            def __init__(self, rows):
                self.rows = rows

            def raise_for_status(self):
                return None

            def json(self):
                return self.rows

        def get(_url, *, headers, params, timeout):
            calls.append((headers["Range"], params, timeout))
            page = len(calls) - 1
            count = 1000 if page < 2 else 500
            return Response([{"id": page * 1000 + index} for index in range(count)])

        production = type(
            "Production",
            (),
            {"supabase_url": "https://example.test", "headers": {"apikey": "test"}},
        )()

        rows = rest_get_all(
            production,
            "points",
            request_get=get,
            select="id",
        )

        self.assertEqual(len(rows), 2500)
        self.assertEqual([item[0] for item in calls], ["0-999", "1000-1999", "2000-2999"])


class CohortTests(unittest.TestCase):
    def test_selects_three_newest_unique_non_cropped_recordings_per_venue(self):
        rows = []
        for venue in VENUES:
            rows.extend(recording(venue, number) for number in range(1, 5))
        rows.extend(
            [
                recording("westchester", 0, cropped=True),
                recording("pingpod", 0, source_hash=recording("pingpod", 1)["source_sha256"]),
                recording("lyttc", 9, count=9),
            ]
        )

        selected = choose_recordings(rows)

        self.assertEqual(len(selected), 9)
        self.assertEqual(Counter(item["venue_category"] for item in selected), Counter({venue: 3 for venue in VENUES}))
        self.assertEqual(len({item["source_sha256"] for item in selected}), 9)
        self.assertTrue(all("cropped" not in item["opponent_name"].lower() for item in selected))

    def test_duplicate_raw_identity_is_excluded_even_when_hash_metadata_differs(self):
        rows = []
        for venue in VENUES:
            rows.extend(recording(venue, number) for number in range(1, 5))
        duplicate = recording("pingpod", 0, source_hash="f" * 64)
        duplicate["raw_identity"] = recording("pingpod", 1)["raw_identity"]
        rows.append(duplicate)

        selected = choose_recordings(rows)

        self.assertEqual(len({item["raw_identity"] for item in selected}), 9)

    def test_missing_venue_inventory_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "exactly three"):
            choose_recordings([recording("pingpod", number) for number in range(1, 4)])

    def test_timeline_selection_is_deterministic_and_covers_the_recording(self):
        points = recording("pingpod", 1, count=100)["points"]

        first = select_round_points(points, round_name="A", seed="fixed")
        second = select_round_points(points, round_name="A", seed="fixed")

        self.assertEqual(first, second)
        self.assertEqual(len(first), 10)
        indices = [item["idx"] for item in first]
        self.assertLessEqual(min(indices), 10)
        self.assertGreaterEqual(max(indices), 91)

    def test_round_b_prefers_acquisition_score_without_using_round_c(self):
        recordings = []
        for venue in VENUES:
            recordings.extend(recording(venue, number) for number in range(1, 4))
        manifest = build_cohort_manifest(recordings)

        inputs = round_b_acquisition_inputs(manifest)

        self.assertEqual(len(inputs), 30)
        self.assertTrue(all(item["round"] == "B" for item in inputs))
        round_c_ids = {
            item["point_id"]
            for item in manifest["selected"]
            if item["round"] == "C"
        }
        self.assertTrue(round_c_ids.isdisjoint({item["point_id"] for item in inputs}))

    def test_manifest_freezes_the_exact_90_point_contract(self):
        rows = []
        for venue in VENUES:
            rows.extend(recording(venue, number) for number in range(1, 4))

        manifest = build_cohort_manifest(rows)
        verified = verified_manifest(manifest)

        self.assertEqual(verified["batch_slug"], BATCH_SLUG)
        self.assertEqual(len(verified["recordings"]), 9)
        self.assertEqual(len(verified["selected"]), 90)
        self.assertEqual(Counter(item["round"] for item in verified["selected"]), Counter({"A": 30, "B": 30, "C": 30}))
        self.assertEqual(Counter(item["venue_category"] for item in verified["selected"]), Counter({venue: 30 for venue in VENUES}))
        self.assertEqual(len({item["source_sha256"] for item in verified["recordings"]}), 9)

    def test_manifest_hash_detects_tampering(self):
        rows = []
        for venue in VENUES:
            rows.extend(recording(venue, number) for number in range(1, 4))
        manifest = build_cohort_manifest(rows)
        self.assertEqual(manifest["manifest_sha256"], canonical_hash({key: value for key, value in manifest.items() if key != "manifest_sha256"}))

        tampered = deepcopy(manifest)
        tampered["selected"][0]["point_id"] = "replacement"
        with self.assertRaisesRegex(ValueError, "hash"):
            verified_manifest(tampered)


class SeedValidationTests(unittest.TestCase):
    def test_identical_seed_is_a_noop_but_mismatch_and_submitted_overwrite_fail(self):
        manifest = {
            "manifest_sha256": "a" * 64,
            "selected": [{"point_id": "point-1"}, {"point_id": "point-2"}],
        }
        existing_sources = [
            {"source_point_id": "point-1", "prefill": {"cohort_manifest_sha256": "a" * 64}},
            {"source_point_id": "point-2", "prefill": {"cohort_manifest_sha256": "a" * 64}},
        ]
        existing_assignments = [
            {"source_point_id": "point-1", "status": "in_progress"},
            {"source_point_id": "point-2", "status": "submitted"},
        ]

        self.assertEqual(
            validate_existing_seed(manifest, existing_sources, existing_assignments),
            "noop",
        )
        changed = deepcopy(existing_sources)
        changed[0]["prefill"]["cohort_manifest_sha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "manifest"):
            validate_existing_seed(manifest, changed, existing_assignments)
        with self.assertRaisesRegex(ValueError, "submitted"):
            validate_existing_seed(
                {**manifest, "selected": [{"point_id": "point-1"}]},
                existing_sources[:1],
                existing_assignments,
            )


if __name__ == "__main__":
    unittest.main()
