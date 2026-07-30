import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import worker.worker as worker


class RawSweepCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params):
        normalized = " ".join(query.split())
        self.connection.queries.append(normalized)
        self.assert_source_lookup(normalized)
        paths = params[0]
        self.rows = [
            (path, self.connection.source_jobs[path])
            for path in paths
            if path in self.connection.source_jobs
        ]

    def assert_source_lookup(self, query):
        if not query.startswith("select input_path, created_at from public.jobs"):
            raise AssertionError(f"unexpected SQL: {query}")

    def fetchall(self):
        return self.rows


class RawSweepConnection:
    def __init__(self, source_jobs):
        self.source_jobs = source_jobs
        self.queries = []

    def cursor(self):
        return RawSweepCursor(self)


class RawPaginator:
    def __init__(self, objects):
        self.objects = objects

    def paginate(self, **kwargs):
        return [{"Contents": self.objects}]


class RawSweepR2:
    def __init__(self, objects):
        self.objects = objects
        self.deleted = []

    def get_paginator(self, name):
        if name != "list_objects_v2":
            raise AssertionError(f"unexpected paginator: {name}")
        return RawPaginator(self.objects)

    def delete_objects(self, *, Bucket, Delete):
        self.deleted.extend((Bucket, item["Key"]) for item in Delete["Objects"])


class PlacementExpiryCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query):
        normalized = " ".join(query.split())
        if "where placement_status = 'retry_available'" not in normalized:
            raise AssertionError(f"unexpected SQL: {normalized}")
        now = datetime.now(timezone.utc)
        for match in self.connection.matches:
            if (
                match["placement_status"] == "retry_available"
                and match["placement_retry_expires_at"] <= now
            ):
                match["placement_status"] = "final_failed"
                match["placement_failure_code"] = "source_expired"
                self.rowcount += 1


class PlacementExpiryConnection:
    def __init__(self, matches):
        self.matches = matches

    def cursor(self):
        return PlacementExpiryCursor(self)


class RawRetentionTests(unittest.TestCase):
    def test_raw_uploads_are_retained_for_thirty_days(self):
        self.assertEqual(worker.R2_RAW_RETENTION_DAYS, 30)

    def test_raw_sweep_uses_source_job_created_at_not_object_last_modified(self):
        now = datetime.now(timezone.utc)
        expired_key = "owner/expired-source.mp4"
        current_key = "owner/current-source.mp4"
        unresolved_key = "owner/unlinked-upload.mp4"
        source_jobs = {
            f"r2://{worker.R2_RAW_BUCKET}/{expired_key}": now - timedelta(days=31),
            f"r2://{worker.R2_RAW_BUCKET}/{current_key}": now - timedelta(days=1),
        }
        connection = RawSweepConnection(source_jobs)
        client = RawSweepR2(
            [
                {"Key": expired_key, "LastModified": now - timedelta(days=1)},
                {"Key": current_key, "LastModified": now - timedelta(days=31)},
                {"Key": unresolved_key, "LastModified": now - timedelta(days=31)},
            ]
        )

        with patch.object(worker, "r2", return_value=client), patch.object(
            worker, "ledger_negate_keys"
        ) as ledger_negate:
            worker.r2_sweep_prefix(
                connection,
                worker.R2_RAW_BUCKET,
                "",
                worker.R2_RAW_RETENTION_DAYS,
            )

        self.assertEqual(client.deleted, [(worker.R2_RAW_BUCKET, expired_key)])
        ledger_negate.assert_called_once_with(
            connection, [f"r2://{worker.R2_RAW_BUCKET}/{expired_key}"]
        )

    def test_expired_not_requested_match_is_not_normalized_to_failed(self):
        match = {
            "placement_status": "not_requested",
            "placement_retry_expires_at": datetime.now(timezone.utc)
            - timedelta(seconds=1),
            "placement_failure_code": None,
        }

        worker.expire_placement_retries(PlacementExpiryConnection([match]))

        self.assertEqual(match["placement_status"], "not_requested")
        self.assertIsNone(match["placement_failure_code"])

    def test_expired_retry_available_match_is_normalized_to_failed(self):
        match = {
            "placement_status": "retry_available",
            "placement_retry_expires_at": datetime.now(timezone.utc)
            - timedelta(seconds=1),
            "placement_failure_code": None,
        }

        worker.expire_placement_retries(PlacementExpiryConnection([match]))

        self.assertEqual(match["placement_status"], "final_failed")
        self.assertEqual(match["placement_failure_code"], "source_expired")
