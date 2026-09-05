import html
import unittest

from worker.email_templates import (
    EmailMessage,
    admin_job_failure_message,
    cost_alert_message,
    export_ready_message,
    feedback_digest_message,
    match_ready_message,
    operational_fixtures,
    qa_digest_message,
    render_email,
    upload_failed_message,
    worker_outcome_fixtures,
)


class EmailRendererTests(unittest.TestCase):
    def test_render_is_adaptive_accessible_and_has_plain_text(self):
        message = EmailMessage(
            template_id="test.python",
            template_version=1,
            category="match",
            audience="player",
            subject="Player <script> has a match",
            preheader="A safe preview",
            eyebrow="Match",
            heading="Player <script>",
            blocks=[
                {"type": "paragraph", "text": "A&B is ready."},
                {"type": "steps", "items": ["First step", "Second step"]},
                {"type": "details", "rows": [{"label": "File", "value": "match <final>.mov"}]},
                {"type": "diagnostic", "text": "stage=render\nerror=<none>"},
            ],
            action={"label": "Open your match", "url": "https://www.ponglens.com/match/sample"},
            reason="A sample completed.",
        )
        rendered = render_email(message)
        self.assertIn('lang="en" dir="ltr"', rendered.html)
        self.assertIn("prefers-color-scheme: dark", rendered.html)
        self.assertIn('role="presentation"', rendered.html)
        self.assertEqual(rendered.html.count("<h1"), 1)
        self.assertIn("Player &lt;script&gt;", rendered.html)
        self.assertNotIn("Player <script>", rendered.html)
        self.assertIn("match &lt;final&gt;.mov", rendered.html)
        self.assertIn("Open your match\nhttps://www.ponglens.com/match/sample", rendered.text)
        self.assertIn("1. First step\n2. Second step", rendered.text)
        self.assertIn("support@ponglens.com", rendered.text)

    def test_renderer_rejects_unapproved_urls(self):
        message = match_ready_message("match.mov", "https://example.com/steal")
        with self.assertRaisesRegex(ValueError, "approved email destination"):
            render_email(message)


class WorkerOutcomeCatalogTests(unittest.TestCase):
    def test_every_outcome_fixture_has_a_unique_rendered_identity(self):
        fixtures = worker_outcome_fixtures()
        self.assertEqual(len(fixtures), 5)
        self.assertEqual(len({f["message"].template_id for f in fixtures}), 5)
        for fixture in fixtures:
            rendered = render_email(fixture["message"])
            self.assertTrue(rendered.html)
            self.assertTrue(rendered.text)

    def test_match_ready_names_the_file_and_destination(self):
        rendered = render_email(match_ready_message(
            "Maya <final>.mov", "https://www.ponglens.com/match/preview"
        ))
        self.assertIn("Maya &lt;final&gt;.mov", rendered.html)
        self.assertIn("Maya <final>.mov", rendered.text)
        self.assertIn("https://www.ponglens.com/match/preview", rendered.text)

    def test_upload_failure_carries_only_the_safe_reason_and_recovery(self):
        rendered = render_email(upload_failed_message(
            "youtube", "That video is private or unavailable."
        ))
        self.assertEqual(rendered.subject, "We couldn't process your video")
        self.assertIn("YouTube import", rendered.text)
        self.assertIn("That video is private or unavailable.", rendered.text)
        self.assertIn("original video on your device is unchanged", rendered.text)
        self.assertNotIn("traceback", rendered.text.lower())

    def test_export_and_admin_failure_have_their_distinct_actions(self):
        export = render_email(export_ready_message(
            "https://www.ponglens.com/match/preview"
        ))
        self.assertIn("Open your match", export.text)
        failure = render_email(admin_job_failure_message(
            "12345678-0000", "decoder crashed <frame 91>",
            "https://www.ponglens.com/admin/uploads/preview",
        ))
        self.assertIn("[Action needed]", failure.subject)
        self.assertIn("decoder crashed &lt;frame 91&gt;", failure.html)
        self.assertEqual(
            html.unescape(failure.html).count("decoder crashed <frame 91>"), 1
        )
        self.assertIn("Open failed job", failure.text)


class OperationalCatalogTests(unittest.TestCase):
    def test_operational_fixtures_cover_feedback_qa_and_cost(self):
        fixtures = operational_fixtures()
        self.assertEqual(
            [fixture["message"].template_id for fixture in fixtures],
            ["digest.feedback", "digest.qa", "ops.cost-alert"],
        )
        for fixture in fixtures:
            rendered = render_email(fixture["message"])
            self.assertIn("max-width:600px", rendered.html)
            self.assertTrue(rendered.text)

    def test_feedback_digest_keeps_actionable_content_and_escapes_it(self):
        message = feedback_digest_message(
            [{
                "title": "Score <wrong>", "body": "The point moved.",
                "type": "bug", "visibility": "board", "qa": [],
                "vote_count": 2, "author": "Maya", "severity": "high",
                "environment": {"viewport": "393x660"},
            }],
            [{"title": "Score correction", "vote_count": 4}],
        )
        rendered = render_email(message)
        self.assertIn("Score &lt;wrong&gt;", rendered.html)
        self.assertIn("Score <wrong>", rendered.text)
        self.assertIn("2 votes", rendered.text)
        self.assertIn("Score correction", rendered.text)
        self.assertIn("https://www.ponglens.com/feedback", rendered.text)

    def test_qa_digest_leads_with_replies_and_keeps_record_links(self):
        message = qa_digest_message(
            [{"id": "bug-1", "title": "Mobile crop", "status": "closed", "note": "Fixed in the player."}],
            "Maya",
            [{"bug_id": "bug-2", "bug_title": "Dark theme", "body": "Can you check this again?", "writer": "Adil"}],
        )
        rendered = render_email(message)
        self.assertIn("Replies and closed reports", rendered.text)
        self.assertLess(rendered.text.index("Dark theme"), rendered.text.index("Mobile crop"))
        self.assertIn("bug=bug-2", rendered.text)

    def test_cost_alert_names_threshold_observed_cost_and_provider(self):
        message = cost_alert_message(
            threshold="$25", observed="$31.42", period="September 2026",
            providers=[{"label": "OpenAI", "value": "$18.20"}],
            dashboard_url="https://www.ponglens.com/admin/costs",
        )
        rendered = render_email(message)
        self.assertIn("crossed $25", rendered.subject)
        self.assertIn("$31.42", rendered.text)
        self.assertIn("OpenAI: $18.20", rendered.text)


if __name__ == "__main__":
    unittest.main()
