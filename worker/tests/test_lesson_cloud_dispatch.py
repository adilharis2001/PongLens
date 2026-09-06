from __future__ import annotations

import json
import unittest

from worker.lesson_cloud_dispatch import cloud_dispatch_ready


class Response:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


class Opener:
    def __init__(self, payload):
        self.payload = payload
        self.request = None
        self.timeout = None

    def __call__(self, request, timeout):
        self.request = request
        self.timeout = timeout
        return Response(self.payload)


class LessonCloudDispatchTests(unittest.TestCase):
    def environment(self):
        return {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "test-service-role",
        }

    def test_literal_true_is_the_only_response_that_launches_cloud(self):
        for payload, expected in ((True, True), (False, False), (None, False)):
            with self.subTest(payload=payload):
                opener = Opener(payload)
                self.assertIs(
                    cloud_dispatch_ready(
                        "lesson-video-release",
                        environ=self.environment(),
                        opener=opener,
                    ),
                    expected,
                )

    def test_dispatch_request_is_release_bound_and_service_authenticated(self):
        opener = Opener(False)

        cloud_dispatch_ready(
            "lesson-video-release",
            environ=self.environment(),
            opener=opener,
        )

        self.assertEqual(
            opener.request.full_url,
            "https://example.supabase.co/rest/v1/rpc/lesson_video_cloud_dispatch_ready",
        )
        self.assertEqual(
            json.loads(opener.request.data),
            {"p_release": "lesson-video-release"},
        )
        self.assertEqual(opener.request.get_header("Apikey"), "test-service-role")
        self.assertEqual(
            opener.request.get_header("Authorization"),
            "Bearer test-service-role",
        )
        self.assertEqual(opener.timeout, 15)


if __name__ == "__main__":
    unittest.main()
