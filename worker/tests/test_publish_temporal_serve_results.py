import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import worker.publish_temporal_serve_results as publisher

from worker.publish_temporal_serve_results import (
    BATCH_SLUG,
    DESTINATION_PREFIX,
    GOLD_PROVENANCE,
    RESULT_SAMPLE_SIZE,
    build_result_proposal,
    build_seed_rows,
    classify_prediction,
    new_assignment_rows,
    select_review_sample,
    sealed_object_fingerprint,
    validate_audit_snapshot,
    validate_experiment,
)


def result_row(
    number: int,
    outcome: str,
    *,
    match_id: str | None = None,
    confidence: float = 0.95,
) -> dict:
    truth = "near" if number % 2 == 0 else "far"
    if outcome == "correct":
        predicted = truth
        status = "high_confidence"
    elif outcome == "wrong":
        predicted = "far" if truth == "near" else "near"
        status = "high_confidence"
    else:
        predicted = None
        status = "withheld"
    resolved_match = match_id or f"match-{number % 6}"
    return {
        "source_id": f"temporal:{resolved_match}:point-{number}",
        "match_id": resolved_match,
        "source_point_idx": number,
        "evaluation": {"expected_server_side": truth},
        "temporal": {
            "near": 0.85 if number % 2 == 0 else 0.15,
            "far": 0.15 if number % 2 == 0 else 0.85,
            "onset_t": round(number / 10, 3),
        },
        "fused": {
            "status": status,
            "side": predicted,
            "confidence": confidence,
            "reason": f"{outcome}_reason",
            "evidence": {
                "chain_rank": 0.7,
                "chain_side": truth,
            },
        },
    }


def experiment_fixture(
    outcome_counts: dict[str, int] | None = None,
    *,
    match_count: int = 6,
) -> tuple[dict, dict]:
    outcome_counts = outcome_counts or {
        "correct": 12,
        "wrong": 12,
        "withheld": 12,
    }
    rows = []
    for outcome_index, outcome in enumerate(("correct", "wrong", "withheld")):
        for offset in range(outcome_counts[outcome]):
            number = outcome_index * 100 + offset
            rows.append(
                result_row(
                    number,
                    outcome,
                    match_id=f"match-{offset % match_count}",
                    confidence=round(0.99 - offset / 100, 3),
                )
            )
    points = []
    for row in rows:
        point_id = row["source_id"].rsplit(":", 1)[-1]
        points.append(
            {
                "source_id": row["source_id"],
                "source_point_id": point_id,
                "source_point_idx": row["source_point_idx"],
                "evaluation": copy.deepcopy(row["evaluation"]),
                "model_input": {
                    "clip_uri": (
                        "r2://ponglens-media/points/user/"
                        f"{row['match_id']}/{point_id}.mp4"
                    ),
                    "media_sha256": f"{row['source_point_idx']:064x}",
                    "placement": {"candidates": []},
                },
            }
        )
    manifest = {
        "experiment": "temporal-serve-scale-v1",
        "manifest_sha256": "a" * 64,
        "splits": {
            "train": [],
            "development": [],
            "holdout": [{"match_id": "sealed", "points": points}],
        },
    }
    results = {
        "experiment": "temporal-serve-scale-v1",
        "manifest_sha256": "a" * 64,
        "training": {
            "checkpoint_sha256": "b" * 64,
            "checkpoint_file_sha256": "c" * 64,
        },
        "predictions": {
            "train": [result_row(999, "correct")],
            "development": [result_row(998, "correct")],
            "holdout": rows,
        },
    }
    return manifest, results


class TemporalServeResultSelectionTests(unittest.TestCase):
    def test_classifies_only_high_confidence_calls_as_correct_or_wrong(self):
        self.assertEqual(classify_prediction(result_row(1, "correct")), "correct")
        self.assertEqual(classify_prediction(result_row(2, "wrong")), "wrong")
        self.assertEqual(classify_prediction(result_row(3, "withheld")), "withheld")

    def test_rejects_experiment_or_manifest_mismatch(self):
        manifest, results = experiment_fixture()
        validate_experiment(manifest, results)

        changed = copy.deepcopy(results)
        changed["manifest_sha256"] = "d" * 64
        with self.assertRaisesRegex(ValueError, "manifest hash"):
            validate_experiment(manifest, changed)

        changed = copy.deepcopy(results)
        changed["experiment"] = "another-experiment"
        with self.assertRaisesRegex(ValueError, "experiment"):
            validate_experiment(manifest, changed)

    def test_selects_exact_balanced_unique_holdout_sample_deterministically(self):
        manifest, results = experiment_fixture()

        first = select_review_sample(manifest, results)
        second = select_review_sample(manifest, results)

        self.assertEqual(first, second)
        self.assertEqual(len(first), 24)
        self.assertEqual(len({item["source_id"] for item in first}), 24)
        self.assertEqual(
            {outcome: sum(item["outcome"] == outcome for item in first)
             for outcome in ("correct", "wrong", "withheld")},
            {"correct": 8, "wrong": 8, "withheld": 8},
        )
        self.assertNotIn("point-999", {item["point_id"] for item in first})
        self.assertNotIn("point-998", {item["point_id"] for item in first})

    def test_first_pass_limits_each_match_to_three_per_stratum(self):
        manifest, results = experiment_fixture()
        # Make the six strongest correct rows come from one camera; only the
        # first three should survive before other matches are considered.
        correct_rows = [
            row
            for row in results["predictions"]["holdout"]
            if classify_prediction(row) == "correct"
        ]
        for row in correct_rows[:6]:
            old_source = row["source_id"]
            row["match_id"] = "dominant-camera"
            row["source_id"] = old_source.replace(
                old_source.split(":")[1], "dominant-camera", 1
            )
            for point in manifest["splits"]["holdout"][0]["points"]:
                if point["source_id"] == old_source:
                    point["source_id"] = row["source_id"]
                    break

        sample = select_review_sample(manifest, results)
        dominant_correct = [
            item
            for item in sample
            if item["outcome"] == "correct"
            and item["match_id"] == "dominant-camera"
        ]
        self.assertLessEqual(len(dominant_correct), 3)

    def test_expands_to_100_while_preserving_original_24_and_balancing_matches(self):
        manifest, results = experiment_fixture(
            {"correct": 11, "wrong": 10, "withheld": 120},
            match_count=10,
        )
        withheld = [
            row
            for row in results["predictions"]["holdout"]
            if classify_prediction(row) == "withheld"
        ]
        # Make one camera dominate the score ranking. A simple ranked fill would
        # over-sample it; the expanded cohort must still balance camera setups.
        for row in withheld:
            match_number = int(str(row["match_id"]).rsplit("-", 1)[-1])
            row["fused"]["confidence"] = 0.99 - match_number / 100

        original = select_review_sample(manifest, results, total=24)
        expanded = select_review_sample(
            manifest,
            results,
            total=RESULT_SAMPLE_SIZE,
        )

        self.assertEqual(
            [item["source_id"] for item in expanded[:24]],
            [item["source_id"] for item in original],
        )
        self.assertEqual(len({item["source_id"] for item in expanded}), 100)
        self.assertEqual(
            {
                outcome: sum(item["outcome"] == outcome for item in expanded)
                for outcome in ("correct", "wrong", "withheld")
            },
            {"correct": 11, "wrong": 10, "withheld": 79},
        )
        match_counts = {
            match_id: sum(item["match_id"] == match_id for item in expanded)
            for match_id in {item["match_id"] for item in expanded}
        }
        self.assertEqual(len(match_counts), 10)
        self.assertLessEqual(max(match_counts.values()) - min(match_counts.values()), 4)

    def test_rejects_missing_or_duplicate_sealed_sources(self):
        manifest, results = experiment_fixture()
        manifest["splits"]["holdout"][0]["points"].pop()
        with self.assertRaisesRegex(ValueError, "missing from sealed holdout"):
            select_review_sample(manifest, results)

    def test_result_proposal_preserves_model_evidence_and_provenance(self):
        manifest, results = experiment_fixture()
        item = select_review_sample(manifest, results)[0]
        proposal = build_result_proposal(
            item,
            {"duration_s": 5.25, "fps": 30.0, "frame_count": 158},
            results,
        )

        self.assertEqual(proposal["schema_version"], 1)
        self.assertEqual(proposal["video"]["fps"], 30.0)
        result = proposal["temporal_result"]
        self.assertEqual(result["outcome"], item["outcome"])
        self.assertEqual(result["expected_side"], item["expected_side"])
        self.assertEqual(result["predicted_side"], item["predicted_side"])
        self.assertEqual(result["temporal"]["near"], item["temporal_near"])
        self.assertEqual(result["temporal"]["onset_s"], item["model_onset_s"])
        self.assertEqual(result["checkpoint_sha256"], "b" * 64)
        self.assertEqual(result["manifest_sha256"], "a" * 64)
        self.assertEqual(result["truth_provenance"], GOLD_PROVENANCE)

    def test_result_proposal_translates_source_bounces_to_point_clip_time(self):
        manifest, results = experiment_fixture()
        item = select_review_sample(manifest, results)[0]
        item.update(
            {
                "clip_start_s": 179.48,
                "first_bounce_s": 181.6787,
                "second_bounce_s": 182.079,
                "chain_rank": 0.6572,
            }
        )

        proposal = build_result_proposal(
            item,
            {"duration_s": 6.6062, "fps": 29.97, "frame_count": 198},
            results,
        )

        self.assertEqual(
            proposal["temporal_result"]["placement"],
            {
                "timebase": "point_clip",
                "first_bounce_s": 2.1987,
                "second_bounce_s": 2.599,
                "chain_rank": 0.6572,
            },
        )

    def test_result_proposal_rejects_bounces_without_explicit_clip_offset(self):
        manifest, results = experiment_fixture()
        item = select_review_sample(manifest, results)[0]
        item.update({"first_bounce_s": 1.2, "second_bounce_s": 1.6})

        with self.assertRaisesRegex(ValueError, "clip_start_s"):
            build_result_proposal(
                item,
                {"duration_s": 5.0, "fps": 30.0, "frame_count": 150},
                results,
            )

    def test_seed_rows_use_separate_stable_batch_and_read_only_assignments(self):
        manifest, results = experiment_fixture()
        selected = select_review_sample(manifest, results)
        videos = {
            item["source_id"]: {
                "duration_s": 5.0,
                "fps": 30.0,
                "frame_count": 150,
                "media_sha256": item["media_sha256"],
            }
            for item in selected
        }

        first = build_seed_rows(selected, results, videos, ["reviewer-a", "reviewer-b"])
        second = build_seed_rows(selected, results, videos, ["reviewer-a", "reviewer-b"])

        self.assertEqual(first, second)
        self.assertEqual(first["batch"]["slug"], BATCH_SLUG)
        self.assertEqual(first["batch"]["status"], "draft")
        self.assertEqual(len(first["sources"]), 24)
        self.assertEqual(len(first["gold"]), 24)
        self.assertEqual(len(first["assignments"]), 48)
        self.assertTrue(
            all(
                row["media_key"].startswith(f"{DESTINATION_PREFIX}/")
                for row in first["sources"]
            )
        )
        self.assertTrue(
            all(row["provenance"] == GOLD_PROVENANCE for row in first["gold"])
        )
        self.assertTrue(
            all(row["status"] == "not_started" for row in first["assignments"])
        )

    def test_seed_rows_accept_the_full_100_point_review_cohort(self):
        manifest, results = experiment_fixture(
            {"correct": 11, "wrong": 10, "withheld": 120},
            match_count=10,
        )
        selected = select_review_sample(
            manifest,
            results,
            total=RESULT_SAMPLE_SIZE,
        )
        videos = {
            item["source_id"]: {
                "duration_s": 5.0,
                "fps": 30.0,
                "frame_count": 150,
                "media_sha256": item["media_sha256"],
            }
            for item in selected
        }

        rows = build_seed_rows(selected, results, videos, ["reviewer-a"])

        self.assertEqual(len(rows["sources"]), 100)
        self.assertEqual(len(rows["gold"]), 100)
        self.assertEqual(len(rows["assignments"]), 100)

    def test_only_inserts_missing_assignments_so_existing_feedback_is_preserved(self):
        proposed = [
            {"id": "assignment-1", "status": "not_started"},
            {"id": "assignment-2", "status": "not_started"},
            {"id": "assignment-3", "status": "not_started"},
        ]

        self.assertEqual(
            new_assignment_rows(proposed, [{"id": "assignment-1"}]),
            proposed[1:],
        )

    def test_seed_rows_use_each_downloaded_clips_source_offset(self):
        manifest, results = experiment_fixture()
        selected = select_review_sample(manifest, results)
        selected[0].update(
            {
                "first_bounce_s": 181.6787,
                "second_bounce_s": 182.079,
            }
        )
        videos = {
            item["source_id"]: {
                "duration_s": 6.6062,
                "fps": 29.97,
                "frame_count": 198,
                "media_sha256": item["media_sha256"],
                "clip_start_s": 179.48,
            }
            for item in selected
        }

        rows = build_seed_rows(selected, results, videos, ["reviewer-a"])
        placement = rows["sources"][0]["proposal"]["temporal_result"]["placement"]

        self.assertEqual(placement["first_bounce_s"], 2.1987)
        self.assertEqual(placement["second_bounce_s"], 2.599)

    def test_seed_rows_derive_clip_start_from_point_and_match_cut_settings(self):
        manifest, results = experiment_fixture()
        selected = select_review_sample(manifest, results)
        selected[0].update(
            {
                "first_bounce_s": 181.6787,
                "second_bounce_s": 182.079,
            }
        )
        videos = {
            item["source_id"]: {
                "duration_s": 6.6062,
                "fps": 29.97,
                "frame_count": 198,
                "media_sha256": item["media_sha256"],
                "point_t0_s": 180.48,
                "pre_roll_s": 1.0,
                "tight_start": False,
            }
            for item in selected
        }

        rows = build_seed_rows(selected, results, videos, ["reviewer-a"])
        placement = rows["sources"][0]["proposal"]["temporal_result"]["placement"]

        self.assertEqual(placement["first_bounce_s"], 2.1987)
        self.assertEqual(placement["second_bounce_s"], 2.599)

    def test_audit_rejects_incomplete_or_unbalanced_publication(self):
        outcome_ranges = {
            "correct": range(0, 11),
            "wrong": range(11, 21),
            "withheld": range(21, 100),
        }
        snapshot = {
            "batch_status": "active",
            "sources": [
                {
                    "id": f"source-{index}",
                    "source_point_id": f"point-{index}",
                    "outcome": outcome,
                    "duration_s": 5.0,
                    "proposal": {
                        "temporal_result": {
                            "placement": {
                                "timebase": "point_clip",
                                "first_bounce_s": 1.2,
                                "second_bounce_s": 1.6,
                            }
                        }
                    },
                }
                for outcome in ("correct", "wrong", "withheld")
                for index in outcome_ranges[outcome]
            ],
            "gold_source_ids": [f"source-{index}" for index in range(100)],
            "assignment_counts": {"reviewer-a": 100},
        }
        self.assertEqual(validate_audit_snapshot(snapshot)["outcomes"], {
            "correct": 11,
            "wrong": 10,
            "withheld": 79,
        })

        broken = copy.deepcopy(snapshot)
        broken["sources"].pop()
        with self.assertRaisesRegex(RuntimeError, "100 sources"):
            validate_audit_snapshot(broken)

        broken = copy.deepcopy(snapshot)
        broken["sources"][0]["proposal"]["temporal_result"]["placement"] = {
            "timebase": "source_video",
            "first_bounce_s": 181.6787,
            "second_bounce_s": 182.079,
        }
        with self.assertRaisesRegex(RuntimeError, "point-clip timebase"):
            validate_audit_snapshot(broken)

    def test_build_sample_cli_loads_all_definitions_before_entrypoint(self):
        manifest, results = experiment_fixture(
            {"correct": 11, "wrong": 10, "withheld": 120},
            match_count=10,
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = root / "manifest.json"
            results_path = root / "results.json"
            output_path = root / "sample.json"
            manifest_path.write_text(json.dumps(manifest))
            results_path.write_text(json.dumps(results))

            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "worker.publish_temporal_serve_results",
                    "build-sample",
                    "--manifest",
                    str(manifest_path),
                    "--results",
                    str(results_path),
                    "--output",
                    str(output_path),
                ],
                capture_output=True,
                text=True,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(
                len(json.loads(output_path.read_text())["selected"]),
                RESULT_SAMPLE_SIZE,
            )

    def test_sealed_media_identity_is_r2_object_fingerprint_not_content_hash(self):
        head = {
            "ETag": '"abc123"',
            "ContentLength": 471687,
            "VersionId": "version-1",
        }
        first = sealed_object_fingerprint("ponglens-media", "points/a.mp4", head)
        second = sealed_object_fingerprint("ponglens-media", "points/a.mp4", head)
        changed = sealed_object_fingerprint(
            "ponglens-media",
            "points/a.mp4",
            {**head, "ETag": '"different"'},
        )

        self.assertEqual(first, second)
        self.assertEqual(len(first), 64)
        self.assertNotEqual(first, changed)

    def test_existing_source_with_same_media_is_updated_when_proposal_changes(self):
        expected = {
            "id": "source-a",
            "media_sha256": "a" * 64,
            "manifest_sha256": "new-manifest",
        }
        prior = {
            "id": "source-a",
            "media_sha256": "a" * 64,
            "manifest_sha256": "old-manifest",
        }

        self.assertEqual(
            publisher.source_publication_action(prior, expected),
            "upsert",
        )


if __name__ == "__main__":
    unittest.main()
