import unittest

from worker.score_service_onset_labels import score_onset_labels


class ServiceOnsetLabelScoringTests(unittest.TestCase):
    def test_compares_frozen_and_backtracked_onsets_by_stratum(self):
        export = {
            "assignments": [
                {
                    "source_id": "visible",
                    "prefill": {
                        "onset_v3": {
                            "included": True,
                            "stratum": "visible",
                        }
                    },
                    "proposal": {"service_motion": {"onset_t": 1.2}},
                    "human_label": {
                        "onset": {"status": "exact", "time_s": 1.0}
                    },
                },
                {
                    "source_id": "occluded-a",
                    "prefill": {
                        "onset_v3": {
                            "included": True,
                            "stratum": "occluded",
                        }
                    },
                    "proposal": {"service_motion": {"onset_t": 2.5}},
                    "human_label": {
                        "onset": {"status": "exact", "time_s": 2.0}
                    },
                },
                {
                    "source_id": "occluded-b",
                    "prefill": {
                        "onset_v3": {
                            "included": True,
                            "stratum": "occluded",
                        }
                    },
                    "proposal": {"service_motion": {"onset_t": 3.0}},
                    "human_label": {
                        "onset": {"status": "exact", "time_s": 3.0}
                    },
                },
            ]
        }
        cases = [
            {
                "source_id": "visible",
                "oracle_motion": {"onset_t": 1.1},
            },
            {
                "source_id": "occluded-a",
                "oracle_motion": {"onset_t": 1.9},
            },
            {
                "source_id": "occluded-b",
                "oracle_motion": {"onset_t": None},
            },
        ]

        result = score_onset_labels(export, cases)

        self.assertEqual(result["eligible"], 3)
        self.assertEqual(result["frozen_v1"]["decided"], 3)
        self.assertAlmostEqual(result["frozen_v1"]["mae_s"], 0.233333)
        self.assertEqual(result["backtracked_v2"]["decided"], 2)
        self.assertEqual(result["backtracked_v2"]["coverage"], 0.666667)
        self.assertAlmostEqual(result["backtracked_v2"]["mae_s"], 0.1)
        self.assertAlmostEqual(
            result["backtracked_v2"]["mean_signed_error_s"],
            0.0,
        )
        self.assertEqual(result["backtracked_v2"]["within_0_1_s"], 2)
        self.assertEqual(result["strata"]["visible"]["eligible"], 1)
        self.assertEqual(result["strata"]["occluded"]["eligible"], 2)
        self.assertAlmostEqual(
            result["strata"]["occluded"]["backtracked_v2"]["mae_s"],
            0.1,
        )

    def test_rejects_duplicate_case_source_ids(self):
        export = {"assignments": []}
        cases = [
            {"source_id": "same", "oracle_motion": {}},
            {"source_id": "same", "oracle_motion": {}},
        ]

        with self.assertRaisesRegex(ValueError, "duplicate"):
            score_onset_labels(export, cases)


if __name__ == "__main__":
    unittest.main()
