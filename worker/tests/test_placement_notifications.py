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

    def test_ready_email_keeps_existing_message(self):
        html = worker.done_email_html("vaibhav.mov")
        self.assertIn("Your match is ready", html)
        self.assertIn("Open your match", html)
        self.assertIn("vaibhav.mov", html)
        self.assertIsNone(self.TECHNICAL_LANGUAGE.search(html))

    def test_placement_never_reaches_the_uploader_by_email(self):
        """Placement is beta and speaks for itself on the match page.

        A failed placement used to take over the subject line of the
        match-ready email, and the two dedicated jobs sent their own
        notices. None of that survives: whatever placement did, the
        uploader is told their match is ready and nothing else.
        """
        sent = []

        def capture_email(_to, rendered, **_kwargs):
            sent.append((rendered.subject, rendered.html))

        with (
            patch.object(worker, "get_user_email", return_value="user@example.com"),
            patch.object(worker, "send_email", side_effect=capture_email),
            patch.object(worker, "get_job_original_name", return_value="vaibhav.mov"),
        ):
            worker.notify_job_done(None, "job-id", "user-id")

        self.assertEqual([subject for subject, _ in sent],
                         ["Your PongLens match is ready"])
        self.assertNotIn("placement", sent[0][1].lower())

    def test_no_placement_email_helpers_remain(self):
        for name in (
            "placement_retry_email_html",
            "placement_generation_email_html",
            "notify_placement_retry_done",
            "notify_placement_generation_done",
        ):
            self.assertFalse(
                hasattr(worker, name),
                f"{name} should be gone — placement sends no email",
            )
