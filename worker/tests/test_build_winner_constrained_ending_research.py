from collections import Counter
import unittest

from worker.build_winner_constrained_ending_research import (
    EXPECTED_BY_MATCH,
    align_placement_to_clip,
    build_gold_label,
    build_review_proposal,
    choose_eligible_sources,
    stable_uuid,
    verified_manifest,
)


def source(number, match_key, *, winner="user", is_let=False):
    source_id = f"source-{number}"
    return {
        "id": source_id,
        "source_match_id": f"match-{match_key}",
        "source_point_id": f"point-{number}",
        "source_point_idx": number,
        "match_label": match_key.title(),
        "media_key": (
            "research/serve-detection/v1/sources/"
            "12345678-1234-1234-1234-123456789abc.mp4"
        ),
        "proposal": {
            "detector": {
                "status": "high_confidence" if number % 2 else "needs_review"
            },
            "likely_actions": (
                [{"suggested_type": "serve_contact", "time_s": 1.25}]
                if number % 2
                else []
            ),
        },
        "prefill": {"match_key": match_key},
        "point": {
            "confirmed_winner": winner,
            "is_let": is_let,
            "placement": {"v": 3, "candidates": []},
        },
        "gold": {
            "scored_server_player": "opponent",
            "scored_server_side": "far",
        },
        "match": {
            "venue": "PingPod",
            "player_near_name": "Adil",
            "player_far_name": match_key.title(),
            "user_side": "near",
        },
    }


class CohortTests(unittest.TestCase):
    def test_filters_to_exact_scored_non_let_reused_cohort(self):
        rows = []
        number = 0
        for match_key, count in EXPECTED_BY_MATCH.items():
            for _ in range(count):
                number += 1
                rows.append(source(number, match_key))
        rows.extend(
            [
                source(1001, "chris", winner=None),
                source(1002, "faye", is_let=True),
            ]
        )

        selected = choose_eligible_sources(rows)

        self.assertEqual(len(selected), 97)
        self.assertEqual(
            Counter(item["match_key"] for item in selected),
            Counter(EXPECTED_BY_MATCH),
        )

    def test_incorrect_match_counts_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "cohort"):
            choose_eligible_sources([source(1, "chris")])


class ContractTests(unittest.TestCase):
    def test_review_proposal_withholds_every_automatic_result(self):
        proposal = build_review_proposal(
            source(1, "vaibhav"),
            {"duration_s": 8.0, "fps": 30.0, "frame_count": 240},
        )

        self.assertTrue(proposal["automatic_prediction_withheld"])
        self.assertEqual(proposal["scoring"]["server"]["name"], "Vaibhav")
        self.assertEqual(proposal["scoring"]["winner"]["name"], "Adil")
        self.assertNotIn("prediction", proposal)
        self.assertNotIn("evidence", proposal)

    def test_gold_freezes_both_variants_and_marks_missing_boundary(self):
        plain = {"ending_family": "net"}
        gold = build_gold_label(source(2, "gui"), plain, None)

        self.assertEqual(
            gold["predictions"]["without_serve_boundary"]["ending_family"],
            "net",
        )
        self.assertFalse(
            gold["predictions"]["with_detected_serve_boundary"]["available"]
        )

    def test_source_identity_is_stable(self):
        self.assertEqual(
            stable_uuid("point-1"),
            stable_uuid("point-1"),
        )
        self.assertNotEqual(
            stable_uuid("point-1"),
            stable_uuid("point-2"),
        )


class PlacementAlignmentTests(unittest.TestCase):
    def test_source_timestamps_become_clip_relative(self):
        placement = {
            "v": 3,
            "candidates": [
                {"id": "a", "kind": "contact", "t": 10.5, "side": "near"},
                {"id": "b", "kind": "bounce", "t": 13.2, "side": "far"},
            ],
        }

        aligned = align_placement_to_clip(
            placement,
            clip_start_s=10.0,
            duration_s=3.0,
        )

        self.assertEqual(
            [item["t"] for item in aligned["candidates"]],
            [0.5],
        )

    def test_manifest_hash_and_exact_counts_are_verified(self):
        selected = []
        number = 0
        for match_key, count in EXPECTED_BY_MATCH.items():
            for _ in range(count):
                number += 1
                selected.append(
                    {
                        "source_point_id": f"point-{number}",
                        "match_key": match_key,
                    }
                )
        payload = {
            "schema_version": 1,
            "batch_slug": "winner-constrained-endings-cross-match-v1",
            "selected": selected,
        }
        from worker.build_winner_constrained_ending_research import canonical_hash

        payload["manifest_sha256"] = canonical_hash(payload)
        self.assertEqual(len(verified_manifest(payload)["selected"]), 97)
        payload["selected"][0]["match_key"] = "tampered"
        with self.assertRaisesRegex(ValueError, "hash"):
            verified_manifest(payload)


if __name__ == "__main__":
    unittest.main()
