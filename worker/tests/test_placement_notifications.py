import re
import unittest
from unittest.mock import patch

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
    TECHNICAL_LANGUAGE = re.compile(
        r"reliable|calibration|stronger|normal placement|processing-retention",
        re.IGNORECASE,
    )

    def test_initial_failure_email_discloses_retry_and_direct_link(self):
        html = worker.done_email_html(
            "vaibhav.mov",
            match_id=self.MATCH_ID,
            placement_status="retry_available",
        )
        self.assertIn("table was hard to detect", html)
        self.assertIn("try once more", html.lower())
        self.assertIn(
            f"/match/{self.MATCH_ID}#placement-tools",
            html,
        )
        self.assertIsNone(self.TECHNICAL_LANGUAGE.search(html))

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
        self.assertIn("Your placement maps are ready", success)
        self.assertIn("see where the ball landed", success.lower())
        self.assertIn(
            f"/match/{self.MATCH_ID}#ball-map",
            success,
        )
        self.assertIn("Placement maps couldn&#x27;t be generated", failed)
        self.assertIn("table was hard to detect", failed)
        self.assertIn("match, clips, and notes are ready", failed.lower())
        self.assertIn(
            f"/match/{self.MATCH_ID}#ball-map",
            failed,
        )
        self.assertNotIn("vision_calibration_rejected", failed)
        self.assertIsNone(self.TECHNICAL_LANGUAGE.search(success))
        self.assertIsNone(self.TECHNICAL_LANGUAGE.search(failed))

    def test_normal_generation_success_email_links_to_map(self):
        body = worker.placement_generation_email_html(
            self.MATCH_ID, outcome="ready"
        )
        self.assertIn("Your placement maps are ready", body)
        self.assertIn("see where the ball landed", body.lower())
        self.assertIn(f"/match/{self.MATCH_ID}#ball-map", body)
        self.assertIsNone(self.TECHNICAL_LANGUAGE.search(body))

    def test_normal_generation_failure_email_offers_one_plain_language_retry(self):
        body = worker.placement_generation_email_html(
            self.MATCH_ID, outcome="retry_available"
        )
        self.assertIn("Placement maps couldn&#x27;t be generated", body)
        self.assertIn("table was hard to detect", body)
        self.assertIn("try once more", body.lower())
        self.assertIn(f"/match/{self.MATCH_ID}#placement-tools", body)
        self.assertIsNone(self.TECHNICAL_LANGUAGE.search(body))

    def test_placement_notification_subjects_use_plain_language(self):
        sent_subjects = []

        def capture_email(_to, subject, _body, **_kwargs):
            sent_subjects.append(subject)

        with (
            patch.object(worker, "get_user_email", return_value="user@example.com"),
            patch.object(worker, "send_email", side_effect=capture_email),
            patch.object(worker, "get_job_original_name", return_value="vaibhav.mov"),
            patch.object(
                worker,
                "get_job_match_placement",
                return_value=(self.MATCH_ID, "retry_available"),
            ),
        ):
            worker.notify_job_done(None, "job-id", "user-id")
            worker.notify_placement_retry_done(
                None,
                "user-id",
                self.MATCH_ID,
                succeeded=False,
            )
            worker.notify_placement_generation_done(
                None,
                "user-id",
                self.MATCH_ID,
                outcome="retry_available",
            )
            worker.notify_placement_retry_done(
                None,
                "user-id",
                self.MATCH_ID,
                succeeded=True,
            )
            worker.notify_placement_generation_done(
                None,
                "user-id",
                self.MATCH_ID,
                outcome="ready",
            )

        self.assertEqual(
            sent_subjects,
            [
                "Placement maps couldn't be generated",
                "Placement maps couldn't be generated",
                "Placement maps couldn't be generated",
                "Your placement maps are ready",
                "Your placement maps are ready",
            ],
        )
        for subject in sent_subjects:
            self.assertIsNone(self.TECHNICAL_LANGUAGE.search(subject))
