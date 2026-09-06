"""Real local-Postgres checks for lesson-recap cloud fallback claims."""

from __future__ import annotations

import os
import unittest
import uuid
from urllib.parse import urlparse

import psycopg2


DATABASE_URL = os.environ.get(
    "PONGLENS_TEST_DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
)
RELEASE_ID = "lesson-video-fallback-test"


def _connect():
    parsed = urlparse(DATABASE_URL)
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("Lesson fallback tests require local Postgres")
    return psycopg2.connect(DATABASE_URL, connect_timeout=5)


class LessonCloudFallbackDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.conn = _connect()
        self.conn.autocommit = False
        with self.conn.cursor() as cur:
            cur.execute("select id from auth.users order by created_at limit 1")
            row = cur.fetchone()
            if row is None:
                self.fail("Local Supabase needs one fixture user")
            self.owner_id = row[0]
            cur.execute("delete from public.lesson_video_worker_heartbeats")
            cur.execute("delete from public.lesson_videos")
            cur.execute(
                "insert into public.lesson_video_release(id,release_id,enabled,cloud_enabled) "
                "values(true,%s,true,true) on conflict(id) do update set "
                "release_id=excluded.release_id,enabled=true,cloud_enabled=true",
                (RELEASE_ID,),
            )

    def tearDown(self):
        self.conn.rollback()
        self.conn.close()

    def queue_lesson(self, age: str):
        lesson_id = uuid.uuid4()
        with self.conn.cursor() as cur:
            cur.execute(
                "insert into public.lesson_videos("
                "id,owner_id,original_name,file_size,duration_s,source_key,status,"
                "created_at,updated_at) values(%s,%s,'lesson.mov',1000,60,%s,'queued',"
                "now()-(%s)::interval,now()-(%s)::interval)",
                (str(lesson_id), self.owner_id, f"lesson-video/test/{lesson_id}", age, age),
            )
        return lesson_id

    def report_mac(self, age: str = "0 seconds"):
        with self.conn.cursor() as cur:
            cur.execute(
                "insert into public.lesson_video_worker_heartbeats("
                "worker_id,release_id,is_cloud,started_at,heartbeat_at) "
                "values('mac-test',%s,false,now()-(%s)::interval,now()-(%s)::interval)",
                (RELEASE_ID, age, age),
            )

    def cloud_claim(self):
        with self.conn.cursor() as cur:
            cur.execute(
                "select id from public.claim_lesson_video(%s,'modal-test',true)",
                (RELEASE_ID,),
            )
            return cur.fetchone()

    def dispatch_ready(self):
        with self.conn.cursor() as cur:
            cur.execute(
                "select public.lesson_video_cloud_dispatch_ready(%s)",
                (RELEASE_ID,),
            )
            return cur.fetchone()[0]

    def set_cloud_enabled(self, enabled: bool):
        with self.conn.cursor() as cur:
            cur.execute(
                "update public.lesson_video_release set cloud_enabled=%s where id=true",
                (enabled,),
            )

    def test_healthy_mac_and_fresh_queue_cannot_dispatch_to_cloud(self):
        self.report_mac()
        self.queue_lesson("10 minutes")

        self.assertIsNone(self.cloud_claim())

    def test_cloud_switch_refuses_even_an_old_queue(self):
        self.set_cloud_enabled(False)
        self.queue_lesson("4 hours")

        self.assertFalse(self.dispatch_ready())
        self.assertIsNone(self.cloud_claim())

    def test_mac_outage_dispatches_after_thirty_minute_wait(self):
        self.report_mac("16 minutes")
        expected = self.queue_lesson("31 minutes")

        self.assertTrue(self.dispatch_ready())
        self.assertEqual(self.cloud_claim()[0], str(expected))

    def test_mac_outage_does_not_dispatch_a_fresh_lesson(self):
        self.report_mac("16 minutes")
        self.queue_lesson("29 minutes")

        self.assertFalse(self.dispatch_ready())
        self.assertIsNone(self.cloud_claim())

    def test_three_hour_queue_dispatches_when_mac_is_healthy(self):
        self.report_mac()
        expected = self.queue_lesson("3 hours 1 minute")

        self.assertTrue(self.dispatch_ready())
        self.assertEqual(self.cloud_claim()[0], str(expected))


if __name__ == "__main__":
    unittest.main()
