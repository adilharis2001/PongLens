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
        paths = params[0]
        if normalized.startswith(
            "select input_path, min(created_at) from public.jobs"
        ):
            self.rows = [
                (path, min(self.connection.source_jobs[path]))
                for path in paths
                if path in self.connection.source_jobs
            ]
            return
        if normalized.startswith(
            "select r2_key, min(created_at) from public.storage_ledger"
        ):
            if (
                "kind = 'other'" not in normalized
                or "bytes > 0" not in normalized
            ):
                raise AssertionError(
                    f"upload ledger query is not positive/raw-only: {normalized}"
                )
            self.rows = [
                (path, min(self.connection.upload_ledger[path]))
                for path in paths
                if path in self.connection.upload_ledger
            ]
            return
        if normalized.startswith(
            "select raw_path from public.matches"
        ):
            # A raw referenced by any live match never ages out: by
            # matches.raw_path (uploads since commerce, 096) or by the
            # source job of a legacy match. Only unreferenced raws expire.
            if "union" not in normalized or "j.input_path" not in normalized:
                raise AssertionError(
                    f"raw protection must also cover job-referenced raws: {normalized}"
                )
            if len(params) != 2 or params[1] is not paths:
                raise AssertionError("union query must receive the paths twice")
            protected = self.connection.library_paths | self.connection.job_referenced_paths
            self.rows = [(path,) for path in paths if path in protected]
            return
        if normalized.startswith(
            "select raw_path from public.match_processing_versions"
        ):
            self.rows = [
                (path,) for path in paths
                if path in self.connection.version_referenced_paths
            ]
            return
        raise AssertionError(f"unexpected SQL: {normalized}")

    def fetchall(self):
        return self.rows


class RawSweepConnection:
    def __init__(self, source_jobs, upload_ledger=None, library_paths=None,
                 job_referenced_paths=None):
        self.source_jobs = source_jobs
        self.upload_ledger = upload_ledger or {}
        self.library_paths = library_paths or set()
        # Raws whose source job belongs to a live match row that predates
        # matches.raw_path (legacy uploads, YouTube imports before 096).
        self.job_referenced_paths = job_referenced_paths or set()
        self.version_referenced_paths = set()
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
        if "and raw_path is null" not in normalized:
            raise AssertionError(
                f"expiry must skip matches whose original is kept: {normalized}"
            )
        now = datetime.now(timezone.utc)
        for match in self.connection.matches:
            if (
                match["placement_status"] == "retry_available"
                and match.get("raw_path") is None
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
    def test_only_unreferenced_raws_have_a_thirty_day_clock(self):
        # The clock is for orphans. A raw any live match references is
        # never swept (see the two protection tests below).
        self.assertEqual(worker.ORPHAN_RAW_DAYS, 30)
        self.assertEqual(worker.ORPHAN_CUT_DAYS, 30)
        self.assertFalse(hasattr(worker, "R2_RAW_RETENTION_DAYS"))

    def test_raw_sweep_uses_source_job_created_at_not_object_last_modified(self):
        now = datetime.now(timezone.utc)
        expired_key = "owner/expired-source.mp4"
        current_key = "owner/current-source.mp4"
        old_ledger_key = "owner/old-ledger-upload.mp4"
        recent_ledger_key = "owner/recent-ledger-upload.mp4"
        old_orphan_key = "owner/old-orphan-upload.mp4"
        recent_orphan_key = "owner/recent-orphan-upload.mp4"
        source_jobs = {
            f"r2://{worker.R2_RAW_BUCKET}/{expired_key}": [
                now - timedelta(days=31),
                now - timedelta(days=1),
            ],
            f"r2://{worker.R2_RAW_BUCKET}/{current_key}": [
                now - timedelta(days=1)
            ],
        }
        upload_ledger = {
            f"r2://{worker.R2_RAW_BUCKET}/{old_ledger_key}": [
                now - timedelta(days=31)
            ],
            f"r2://{worker.R2_RAW_BUCKET}/{recent_ledger_key}": [
                now - timedelta(days=1)
            ],
        }
        connection = RawSweepConnection(source_jobs, upload_ledger)
        client = RawSweepR2(
            [
                {"Key": expired_key, "LastModified": now - timedelta(days=1)},
                {"Key": current_key, "LastModified": now - timedelta(days=31)},
                {
                    "Key": old_ledger_key,
                    "LastModified": now - timedelta(days=1),
                },
                {
                    "Key": recent_ledger_key,
                    "LastModified": now - timedelta(days=31),
                },
                {
                    "Key": old_orphan_key,
                    "LastModified": now - timedelta(days=31),
                },
                {
                    "Key": recent_orphan_key,
                    "LastModified": now - timedelta(days=1),
                },
            ]
        )

        with patch.object(worker, "r2", return_value=client), patch.object(
            worker, "ledger_negate_keys"
        ) as ledger_negate:
            worker.r2_sweep_prefix(
                connection,
                worker.R2_RAW_BUCKET,
                "",
                worker.ORPHAN_RAW_DAYS,
            )

        deleted_keys = [key for _, key in client.deleted]
        self.assertEqual(
            deleted_keys,
            [expired_key, old_ledger_key, old_orphan_key],
        )
        ledger_negate.assert_called_once_with(
            connection,
            [
                f"r2://{worker.R2_RAW_BUCKET}/{expired_key}",
                f"r2://{worker.R2_RAW_BUCKET}/{old_ledger_key}",
                f"r2://{worker.R2_RAW_BUCKET}/{old_orphan_key}",
            ],
        )

    def test_library_raws_never_age_out_while_their_match_lives(self):
        # Commerce (096): matches.raw_path is the user's stored video. Age
        # alone must not delete it; only a deleted match (no row) frees it.
        now = datetime.now(timezone.utc)
        library_key = "owner/library-video.mp4"
        deleted_key = "owner/deleted-match-video.mp4"
        library_path = f"r2://{worker.R2_RAW_BUCKET}/{library_key}"
        source_jobs = {
            library_path: [now - timedelta(days=400)],
            f"r2://{worker.R2_RAW_BUCKET}/{deleted_key}": [
                now - timedelta(days=31)
            ],
        }
        connection = RawSweepConnection(
            source_jobs, library_paths={library_path}
        )
        client = RawSweepR2(
            [
                {"Key": library_key, "LastModified": now - timedelta(days=400)},
                {"Key": deleted_key, "LastModified": now - timedelta(days=31)},
            ]
        )

        with patch.object(worker, "r2", return_value=client), patch.object(
            worker, "ledger_negate_keys"
        ):
            worker.r2_sweep_prefix(
                connection,
                worker.R2_RAW_BUCKET,
                "",
                worker.ORPHAN_RAW_DAYS,
            )

        deleted_keys = [key for _, key in client.deleted]
        self.assertEqual(deleted_keys, [deleted_key])

    def test_legacy_raws_referenced_only_by_their_job_never_age_out(self):
        # Matches processed before 096 have no raw_path; their raw is
        # reached through the source job. That row is just as live.
        now = datetime.now(timezone.utc)
        legacy_key = "owner/legacy-upload.mp4"
        orphan_key = "owner/orphan.mp4"
        legacy_path = f"r2://{worker.R2_RAW_BUCKET}/{legacy_key}"
        source_jobs = {
            legacy_path: [now - timedelta(days=200)],
            f"r2://{worker.R2_RAW_BUCKET}/{orphan_key}": [
                now - timedelta(days=200)
            ],
        }
        connection = RawSweepConnection(
            source_jobs, job_referenced_paths={legacy_path}
        )
        client = RawSweepR2(
            [
                {"Key": legacy_key, "LastModified": now - timedelta(days=200)},
                {"Key": orphan_key, "LastModified": now - timedelta(days=200)},
            ]
        )

        with patch.object(worker, "r2", return_value=client), patch.object(
            worker, "ledger_negate_keys"
        ):
            worker.r2_sweep_prefix(
                connection, worker.R2_RAW_BUCKET, "", worker.ORPHAN_RAW_DAYS
            )

        self.assertEqual([key for _, key in client.deleted], [orphan_key])

    def test_version_referenced_raw_never_ages_out_without_a_job_link(self):
        now = datetime.now(timezone.utc)
        kept_key = "owner/retained-version.mp4"
        kept_path = f"r2://{worker.R2_RAW_BUCKET}/{kept_key}"
        connection = RawSweepConnection({})
        connection.version_referenced_paths.add(kept_path)
        client = RawSweepR2([{
            "Key": kept_key, "LastModified": now - timedelta(days=400),
        }])
        with patch.object(worker, "r2", return_value=client), patch.object(
            worker, "ledger_negate_keys"
        ):
            worker.r2_sweep_prefix(
                connection, worker.R2_RAW_BUCKET, "", worker.ORPHAN_RAW_DAYS
            )
        self.assertEqual(client.deleted, [])

    def test_kept_original_never_expires_its_placement_retry(self):
        match = {
            "placement_status": "retry_available",
            "placement_retry_expires_at": datetime.now(timezone.utc)
            - timedelta(days=400),
            "placement_failure_code": None,
            "raw_path": "r2://ponglens-raw/owner/kept.mp4",
        }

        worker.expire_placement_retries(PlacementExpiryConnection([match]))

        self.assertEqual(match["placement_status"], "retry_available")
        self.assertIsNone(match["placement_failure_code"])

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
