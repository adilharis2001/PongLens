import unittest

from worker import worker


def placement(landing):
    shot = {
        "landing": landing,
        "terminal": None,
    }
    return {
        "v": 3,
        "hypotheses": {
            "near": {"shots": [shot]},
            "far": {"shots": []},
        },
    }


class PlacementSummaryTests(unittest.TestCase):
    def test_counts_each_point_with_a_drawable_event_once(self):
        points = [
            {"placement": placement({"u": 0.5, "v": 2.0})},
            {"placement": placement(None)},
            {"placement": None},
        ]
        self.assertEqual(worker.count_drawable_placements(points), 1)

    def test_counts_legacy_bounces_and_terminal_events(self):
        points = [
            {"placement": {"bounces": [{"u": 0.2, "v": 0.4}]}},
            {
                "placement": {
                    "hypotheses": {
                        "near": {
                            "shots": [
                                {
                                    "landing": None,
                                    "terminal": {"kind": "net"},
                                }
                            ]
                        }
                    }
                }
            },
        ]
        self.assertEqual(worker.count_drawable_placements(points), 2)


class PlacementEmailTests(unittest.TestCase):
    MATCH_ID = "10000000-0000-0000-0000-000000000001"

    def test_initial_failure_email_discloses_retry_and_direct_link(self):
        html = worker.done_email_html(
            "vaibhav.mov",
            match_id=self.MATCH_ID,
            placement_status="retry_available",
        )
        self.assertIn("couldn&#x27;t generate reliable placement maps", html)
        self.assertIn(f"/match/{self.MATCH_ID}", html)
        self.assertIn("Try placement again", html)

    def test_ordinary_ready_email_keeps_existing_message(self):
        html = worker.done_email_html("vaibhav.mov")
        self.assertIn("Your match is ready", html)
        self.assertIn("Review your match", html)
        self.assertIn("vaibhav.mov", html)

    def test_retry_outcomes_have_distinct_friendly_copy(self):
        success = worker.placement_retry_email_html(
            self.MATCH_ID, succeeded=True
        )
        failed = worker.placement_retry_email_html(
            self.MATCH_ID, succeeded=False
        )
        self.assertIn("placement maps are ready", success.lower())
        self.assertIn("still couldn&#x27;t generate", failed.lower())
        self.assertNotIn("vision_calibration_rejected", failed)

    def test_normal_generation_success_email_links_to_map(self):
        body = worker.placement_generation_email_html(
            self.MATCH_ID, outcome="ready"
        )
        self.assertIn("Your placement maps are ready", body)
        self.assertIn(f"/match/{self.MATCH_ID}#ball-map", body)

    def test_normal_generation_failure_email_offers_stronger_retry(self):
        body = worker.placement_generation_email_html(
            self.MATCH_ID, outcome="retry_available"
        )
        self.assertIn("Placement maps need another try", body)
        self.assertIn("one stronger", body)
        self.assertIn(f"/match/{self.MATCH_ID}#placement-tools", body)
