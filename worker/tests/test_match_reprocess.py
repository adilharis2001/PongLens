import copy
import json
import os
import tempfile
import unittest
import uuid
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from worker import worker


MATCH_ID = "10000000-0000-0000-0000-000000000001"
JOB_ID = "20000000-0000-0000-0000-000000000002"
ISSUE_ID = "30000000-0000-0000-0000-000000000003"
SOURCE_VERSION_ID = "40000000-0000-0000-0000-000000000004"
CANDIDATE_VERSION_ID = "50000000-0000-0000-0000-000000000005"
USER_ID = "60000000-0000-0000-0000-000000000006"


class Cursor:
    def __init__(self, connection):
        self.connection = connection
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.connection.calls.append((normalized, params))
        if normalized.startswith("update public.jobs set status = 'processing'"):
            self.connection.row = (JOB_ID,)
        elif "from public.jobs j" in normalized:
            self.connection.row = {
                "match_id": MATCH_ID,
                "user_id": USER_ID,
                "job_id": JOB_ID,
                "issue_id": ISSUE_ID,
                "source_version_id": SOURCE_VERSION_ID,
                "processing_version_id": CANDIDATE_VERSION_ID,
                "raw_path": "r2://ponglens-raw/60000000-0000-0000-0000-000000000006/source.mp4",
                "options": {"strictness": "tight", "placement": True},
                "match_state": {"status": "ready", "clip_pads": {"before": 1}},
                "release_id": "points-v2",
            }
        elif normalized.startswith("insert into public.points"):
            self.connection.insert_params = params
            self.connection.row = (params[0],)
        elif normalized.startswith("update public.match_processing_versions"):
            self.connection.version_params = params
            self.rowcount = 1
        elif normalized.startswith("update public.match_processing_feedback"):
            self.connection.issue_params = params
            self.rowcount = 1
        elif "record_match_version_event" in normalized:
            self.connection.event_params = params
        elif "public.matches" in normalized:
            raise AssertionError("candidate processing must not mutate matches")
        elif "processing_ledger" in normalized or "storage_ledger" in normalized:
            raise AssertionError("candidate processing must not write a ledger")

    def fetchone(self):
        return self.connection.row


class Connection:
    def __init__(self):
        self.autocommit = True
        self.calls = []
        self.row = None
        self.rowcount = 0
        self.insert_params = None
        self.version_params = None
        self.issue_params = None
        self.event_params = None

    def commit(self):
        pass

    def rollback(self):
        pass

    def cursor(self, **kwargs):
        return Cursor(self)


class MatchReprocessDestinationTests(unittest.TestCase):
    def test_candidate_destination_cannot_fall_back_to_unversioned_active_points(self):
        with self.assertRaisesRegex(ValueError, "candidate destination"):
            worker.MatchProcessingDestination(
                match_id=MATCH_ID, user_id=USER_ID, job_id=JOB_ID,
                source_path="r2://media/raw.mp4", options={}, match_state={},
            )

    def test_loads_the_database_candidate_not_the_queue_payload(self):
        conn = Connection()
        destination = worker.load_match_reprocess_destination(conn, JOB_ID)

        self.assertEqual(destination.match_id, MATCH_ID)
        self.assertEqual(destination.user_id, USER_ID)
        self.assertEqual(destination.processing_version_id, CANDIDATE_VERSION_ID)
        self.assertEqual(destination.source_path, "r2://ponglens-raw/60000000-0000-0000-0000-000000000006/source.mp4")
        self.assertEqual(
            destination.storage_prefix,
            f"points/{USER_ID}/{MATCH_ID}/versions/{CANDIDATE_VERSION_ID}",
        )
        self.assertFalse(destination.activates_match)
        self.assertIsNone(destination.release_id, "source facts cannot establish the executing release")

    def test_candidate_points_are_explicitly_versioned(self):
        conn = Connection()
        worker.insert_points(
            conn,
            MATCH_ID,
            [{"idx": 1, "t0": 1.0, "t1": 2.0, "clip": "1.mp4"}],
            "r2://ponglens-media/points/user/match/versions/candidate",
            processing_version_id=CANDIDATE_VERSION_ID,
        )

        self.assertEqual(conn.insert_params[2], CANDIDATE_VERSION_ID)

    def test_saving_a_candidate_only_updates_its_version_and_issue(self):
        conn = Connection()
        destination = worker.MatchProcessingDestination(
            match_id=MATCH_ID,
            user_id=USER_ID,
            job_id=JOB_ID,
            issue_id=ISSUE_ID,
            source_version_id=SOURCE_VERSION_ID,
            processing_version_id=CANDIDATE_VERSION_ID,
            source_path="r2://ponglens-raw/60000000-0000-0000-0000-000000000006/source.mp4",
            options={"strictness": "tight", "placement": True},
            match_state={"status": "ready"},
            release_id="points-v2",
        )

        worker.save_match_reprocess_candidate(
            conn,
            destination,
            cut_path="r2://ponglens-media/results/user/match/versions/candidate.mp4",
            thumb_path="r2://ponglens-media/points/user/match/versions/candidate/thumb.webp",
            match_json_path="r2://ponglens-media/points/user/match/versions/candidate/match.json",
            match_state={"status": "ready", "clip_pads": {"before": 1}},
        )

        self.assertEqual(conn.version_params[-3:], (CANDIDATE_VERSION_ID, MATCH_ID, JOB_ID))
        self.assertEqual(conn.version_params[4], "points-v2")
        self.assertEqual(conn.issue_params[-2:], (ISSUE_ID, JOB_ID))
        self.assertEqual(conn.event_params[0], ISSUE_ID)
        self.assertFalse(any("delete from public.points" in query for query, _ in conn.calls))


class MatchReprocessPipelineTests(unittest.TestCase):
    def test_reprocess_uses_the_raw_source_and_candidate_prefix_without_ledger(self):
        destination = worker.MatchProcessingDestination(
            match_id=MATCH_ID, user_id=USER_ID, job_id=JOB_ID,
            issue_id=ISSUE_ID, source_version_id=SOURCE_VERSION_ID,
            processing_version_id=CANDIDATE_VERSION_ID,
            source_path=f"r2://ponglens-raw/{USER_ID}/source.mp4",
            options={"strictness": "normal", "placement": False},
            match_state={"status": "ready"},
        )
        uploads = []

        class R2:
            def download_file(self, bucket, key, destination_path):
                Path(destination_path).write_bytes(b"raw")

            def upload_file(self, path, bucket, key, ExtraArgs=None):
                uploads.append(key)

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(worker, "load_match_reprocess_destination", return_value=destination), \
                patch.object(worker, "r2", return_value=R2()), \
                patch.object(worker.tempfile, "mkdtemp", return_value=directory), \
                patch.object(worker, "detect_ball", return_value="blurball.json"), \
                patch.object(worker, "run_points_subprocess", return_value=directory), \
                patch.object(worker, "run_cut", return_value=str(Path(directory) / "cut.mp4")), \
                patch.object(worker, "extract_thumb", return_value=False), \
                patch.object(worker, "update_job"), \
                patch.object(worker, "pulse_stage"), \
                patch.object(worker, "_record_video_profile",
                             side_effect=AssertionError("candidate profile")), \
                patch.object(worker, "save_match_reprocess_candidate") as save, \
                patch.object(worker, "ledger_append", side_effect=AssertionError("ledger")), \
                patch.object(worker, "ledger_negate_keys", side_effect=AssertionError("ledger")):
            Path(directory, "cut.mp4").write_bytes(b"cut")
            Path(directory, "match.json").write_text(
                '{"points":[{"idx":1,"t0":1,"t1":2,"clip":"1.mp4"}]}'
            )
            Path(directory, "1.mp4").write_bytes(b"clip")

            worker.process_match_reprocess(Connection(), JOB_ID, "attempt-1")

        prefix = f"points/{USER_ID}/{MATCH_ID}/versions/{CANDIDATE_VERSION_ID}"
        self.assertIn(f"{prefix}/1.mp4", uploads)
        self.assertIn(f"{prefix}/match.json", uploads)
        self.assertIn(f"results/{USER_ID}/{MATCH_ID}/versions/{CANDIDATE_VERSION_ID}.mp4", uploads)
        self.assertEqual(save.call_args.kwargs["match_json_path"], f"r2://{worker.R2_MEDIA_BUCKET}/{prefix}/match.json")

    def test_unreadable_candidate_source_fails_only_the_candidate_and_issue(self):
        destination = worker.MatchProcessingDestination(
            match_id=MATCH_ID, user_id=USER_ID, job_id=JOB_ID,
            issue_id=ISSUE_ID, source_version_id=SOURCE_VERSION_ID,
            processing_version_id=CANDIDATE_VERSION_ID, source_path="",
            options={"strictness": "normal", "placement": False},
            match_state={"status": "ready"},
        )
        message = {
            "message": {
                "job_id": JOB_ID,
                "user_id": "queue-user-must-not-matter",
                "input_path": "r2://ponglens-raw/attacker/replaced.mp4",
                "kind": "match_reprocess",
            },
            "msg_id": 1,
            "read_ct": 1,
        }
        conn = Connection()

        with patch.object(worker, "load_match_reprocess_destination", return_value=destination), \
                patch.object(worker, "pulse_job"), \
                patch.object(worker, "archive_message"), \
                patch.object(worker, "update_job") as update:
            worker.process_job(conn, message)

        self.assertTrue(any(
            "update public.match_processing_versions set status = 'failed'" in query
            for query, _ in conn.calls
        ))
        self.assertTrue(any(
            "update public.match_processing_feedback set status = 'execution_failed'" in query
            for query, _ in conn.calls
        ))
        update.assert_any_call(conn, JOB_ID, status="failed", progress=100,
                               error="match reprocess source is missing or unreadable")


class RetentionCursor:
    def __init__(self):
        self.query = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params=None):
        self.query = " ".join(query.split())

    def fetchall(self):
        return [
            ("r2://ponglens-media/results/active.mp4",),
            ("r2://ponglens-media/results/user/match/versions/candidate.mp4",),
        ]


class RetentionConnection:
    def __init__(self):
        self.cursor_value = RetentionCursor()

    def cursor(self, **kwargs):
        return self.cursor_value


class MatchReprocessRetentionTests(unittest.TestCase):
    def test_candidate_cut_paths_are_retained_with_live_match_cuts(self):
        conn = RetentionConnection()
        protected = worker._referenced_cut_paths(conn)

        self.assertIn("r2://ponglens-media/results/user/match/versions/candidate.mp4", protected)
        self.assertIn("public.match_processing_versions", conn.cursor_value.query)


@unittest.skipUnless(os.environ.get("MATCH_ISSUES_LOCAL_DB_TEST") == "1",
                     "requires the isolated match-processing-feedback database")
class MatchReprocessDatabaseTests(unittest.TestCase):
    """Run the real worker SQL against the disposable Supabase database.

    Only media/model boundaries are replaced. Separate database connections
    commit a publication or a new request while the real worker is rendering.
    The fixed loopback endpoint intentionally cannot select production.
    """

    def setUp(self):
        self.conn = worker.psycopg2.connect(
            host="127.0.0.1", port=55322, dbname="postgres", user="postgres",
            password="postgres", connect_timeout=5,
        )
        self.conn.autocommit = True
        self.other = worker.psycopg2.connect(
            host="127.0.0.1", port=55322, dbname="postgres", user="postgres",
            password="postgres", connect_timeout=5,
        )
        self.other.autocommit = True
        self.user, self.match, self.source_job, self.tag = [
            str(uuid.uuid4()) for _ in range(4)
        ]
        self.addCleanup(self.cleanup_database)
        self.sql("insert into auth.users(id,email) values(%s,%s)",
                 (self.user, f"task7-{self.user}@example.com"))
        self.sql("insert into jobs(id,user_id,status,kind,input_path,options) "
                 "values(%s,%s,'done','deadspace_cut',%s,%s)",
                 (self.source_job, self.user, f"r2://ponglens-raw/{self.user}/raw.mp4",
                  json.dumps({"strictness": "normal", "placement": False})))
        self.sql("insert into matches(id,user_id,job_id,status,raw_path,cut_path,"
                 "match_json_path,duration_s,user_side,first_server,first_server_source) "
                 "values(%s,%s,%s,'ready',%s,'r2://media/old-cut.mp4',"
                 "'r2://media/old-match.json',600,'near','user','user')",
                 (self.match, self.user, self.source_job,
                  f"r2://ponglens-raw/{self.user}/raw.mp4"))
        self.source_version = str(self.sql(
            "select active_processing_version_id from matches where id=%s",
            (self.match,))[0][0])
        self.active_points = worker.insert_points(
            self.conn, self.match,
            [{"idx": idx, "t0": idx * 3, "t1": idx * 3 + 2,
              "clip": f"{idx}.mp4"} for idx in range(1, 101)],
            "r2://media/old-points", processing_version_id=self.source_version,
        )
        self.sql("insert into tags(id,owner_id,label) values(%s,%s,'Task 7')",
                 (self.tag, self.user))
        self.manifest = {"title": "Task 7", "points": [{
            "point_id": self.active_points[1]["id"],
            "clip_path": "r2://media/old-points/1.mp4",
            "seg_start": None, "seg_end": None,
        }]}
        self.sql("insert into tag_reels(tag_id,user_id,status,manifest,r2_key) "
                 "values(%s,%s,'queued',%s,'reels/previous-tag.mp4')",
                 (self.tag, self.user, json.dumps(self.manifest)))
        self.tag_job = str(uuid.uuid4())
        self.sql("insert into jobs(id,user_id,kind,status,options) "
                 "values(%s,%s,'reel','queued',%s)",
                 (self.tag_job, self.user, json.dumps({"tag_id": self.tag})))

    def sql(self, query, params=None, *, connection=None):
        with (connection or self.conn).cursor() as cur:
            cur.execute(query, params)
            return cur.fetchall() if cur.description else []

    def cleanup_database(self):
        self.conn.rollback()
        self.conn.autocommit = True
        self.sql("select set_config('request.jwt.claims','{}',false)")
        self.sql("delete from matches where id=%s", (self.match,))
        self.sql("delete from auth.users where id=%s", (self.user,))
        self.conn.close()
        self.other.close()

    def make_candidate(self):
        self.sql("select set_config('request.jwt.claims',%s,false)",
                 (json.dumps({"sub": self.user, "role": "authenticated",
                              "email": "adilharis2001@gmail.com"}),))
        self.sql("select submit_match_issue(%s,'reprocess','Check this cut',%s)",
                 (self.match, str(uuid.uuid4())))
        issue = str(self.sql("select id from match_processing_feedback where match_id=%s",
                             (self.match,))[0][0])
        self.sql("select admin_start_match_reprocess(%s,'{}','Worker regression')", (issue,))
        self.sql("select set_config('request.jwt.claims','{}',false)")
        job = str(self.sql("select replacement_job_id from match_processing_feedback where id=%s",
                           (issue,))[0][0])
        return worker.load_match_reprocess_destination(self.conn, job)

    def ready_candidate(self):
        destination = self.make_candidate()
        worker.finalize_match_reprocess_success(
            self.conn, destination, cut_path="r2://media/new-cut.mp4",
            thumb_path=None, match_json_path="r2://media/new-match.json",
            match_state={"status": "ready"}, point_indices=[],
        )
        return destination

    def three_versions(self):
        """The same point index is valid in active, retained and candidate cuts."""
        candidate = self.ready_candidate()
        retained = str(uuid.uuid4())
        self.sql("insert into match_processing_versions(id,match_id,status,job_id) "
                 "values(%s,%s,'superseded',%s)",
                 (retained, self.match, self.source_job))
        for version in (retained, candidate.processing_version_id):
            worker.insert_points(
                self.conn, self.match,
                [{"idx": 1, "t0": 500, "t1": 510, "clip": "1.mp4"}],
                f"r2://media/{version}", processing_version_id=version,
            )
        return candidate, retained

    def derived_job(self, kind, *, scope=None):
        job = str(uuid.uuid4())
        options = {"match_id": self.match,
                   "processing_version_id": self.source_version}
        if scope:
            options["scope"] = scope
        self.sql("insert into jobs(id,user_id,kind,status,options) "
                 "values(%s,%s,%s,'processing',%s)",
                 (job, self.user, kind, json.dumps(options)))
        return job

    def test_derived_highlights_only_read_the_jobs_version(self):
        self.three_versions()
        job = self.derived_job("reel", scope="highlights")
        self.sql("insert into match_reels(match_id,scope,status,show_score,manifest) "
                 "values(%s,'highlights','queued',false,'{}')", (self.match,))
        # Current evidence needs no diagnostic refresh. Keep the real manifest
        # and its revision while observing which version reaches the selector.
        self.sql("update points set highlight_evidence=%s where processing_version_id=%s",
                 (json.dumps({"v": 2, "status": "unavailable"}), self.source_version))
        observed = []
        import worker.highlights as highlights
        original_build = highlights.build_manifest

        def build(points):
            observed.extend(points)
            return original_build(points)

        # The production loader imports the same source as a top-level module.
        with patch.dict("sys.modules", {"highlights": highlights}), \
                patch.object(highlights, "build_manifest", side_effect=build):
            worker.process_reel(self.conn, job, self.user, {})
        self.assertEqual({str(point["id"]) for point in observed},
                         {point["id"] for point in self.active_points.values()})

    def test_placement_attempt_reads_only_its_version_with_duplicate_indices_elsewhere(self):
        self.three_versions()
        job = self.derived_job("placement_generate")
        self.sql("update matches set placement_status='processing',"
                 "placement_generation_job_id=%s where id=%s", (job, self.match))
        record = worker.load_placement_attempt_record(
            self.conn, job, self.user, self.match, worker.NORMAL_PLACEMENT_ATTEMPT)
        self.assertEqual(record["processing_version_id"], self.source_version)
        self.assertEqual(len(record["points"]), 100)
        self.assertEqual({p["processing_version_id"] for p in record["points"]},
                         {self.source_version})

    def test_placement_backfill_reads_only_active_version(self):
        self.three_versions()
        record = worker.load_backfill_record(self.conn, self.match)
        self.assertEqual(record["processing_version_id"], self.source_version)
        self.assertEqual(len(record["points"]), 100)

    def test_reclip_reads_and_mutates_only_its_version(self):
        self.three_versions()
        # Prevent edit triggers from queuing extra fixture jobs.
        self.sql("update points set edited=true where match_id=%s and idx=1", (self.match,))
        job = self.derived_job("reclip")
        with patch.object(worker, "_presigned_get", return_value=None), \
                patch.object(worker, "storage_download", side_effect=RuntimeError("fixture missing")), \
                patch.object(worker, "get_config", return_value="raw"):
            worker.process_reclip(self.conn, job, self.user, {})
        rows = self.sql("select processing_version_id::text,edited from points "
                        "where match_id=%s and idx=1", (self.match,))
        self.assertEqual(dict(rows)[self.source_version], False)
        self.assertTrue(all(edited for version, edited in rows if version != self.source_version))

    def test_candidate_provenance_uses_executing_code_and_effective_configuration(self):
        self.sql("update match_processing_versions set release_id='source-old-release',"
                 "settings='{\"pipeline\":\"v1\"}' where id=%s", (self.source_version,))
        with patch.object(worker, "_PULSE_CODE_VERSION", "executing-worker-release"):
            destination = self.run_match_media(candidate=True, actual_pipeline="v1")
        release, settings = self.sql(
            "select release_id,settings from match_processing_versions where id=%s",
            (destination.processing_version_id,))[0]
        self.assertEqual(release, "executing-worker-release")
        self.assertEqual(settings["pipeline"], "v2")
        self.assertEqual(settings["actual_pipeline"], "v1", "the assembler's fallback is not its configured pipeline")
        self.assertEqual(settings["pipeline_options"]["clip_pads"], {"before": 2, "after": 1})
        self.assertEqual(settings["strictness"], "normal")
        self.assertEqual(settings["placement"], False)

    def test_unknown_executing_release_never_inherits_source_or_requested_release(self):
        self.sql("update match_processing_versions set release_id='source-old-release' "
                 "where id=%s", (self.source_version,))
        with patch.object(worker, "_PULSE_CODE_VERSION", None):
            destination = self.make_candidate()
            self.sql("update jobs set options=options||'{\"release_id\":\"requested-not-running\"}'::jsonb where id=%s",
                     (destination.job_id,))
            destination = worker.load_match_reprocess_destination(self.conn, destination.job_id)
            self.assertIsNone(destination.release_id)
            self.run_match_media(candidate=True, destination=destination)
        self.assertEqual(self.sql("select release_id from match_processing_versions where id=%s",
                                 (destination.processing_version_id,)), [(None,)])

    def run_derived_reel(self, during_render=None, *, fail=False, before_media=None):
        job = self.derived_job("reel", scope="full")
        manifest = copy.deepcopy(self.manifest)
        manifest["points"][0].update(seg_start=0, seg_end=2)
        self.sql("insert into match_reels(match_id,scope,status,show_score,manifest,r2_key) "
                 "values(%s,'full','queued',false,%s,'reels/previous-match.mp4') "
                 "on conflict(match_id,scope) do update set status='queued',"
                 "manifest=excluded.manifest,updated_at=clock_timestamp()",
                 (self.match, json.dumps(manifest)))
        self.derived_uploads, self.derived_deletes, self.derived_downloads = [], [], []
        uploads, deletes, downloads = self.derived_uploads, self.derived_deletes, self.derived_downloads
        real_update = worker.update_job

        def update(conn, job_id, **kwargs):
            real_update(conn, job_id, **kwargs)
            if before_media and kwargs.get("progress") == 15:
                before_media()

        class Storage:
            def download_file(self, bucket, key, path):
                downloads.append((bucket, key))
                Path(path).write_bytes(b"version cut")

            def upload_file(self, path, bucket, key, ExtraArgs=None):
                uploads.append(key)

            def delete_object(self, *, Bucket, Key):
                deletes.append(Key)

        def render(current_manifest, _score, directory, cut):
            self.assertEqual(current_manifest, manifest)
            self.assertIsNotNone(cut)
            if during_render:
                during_render()
            if fail:
                raise RuntimeError("fixture encoding failed")
            path = Path(directory, "reel.mp4")
            path.write_bytes(b"version A reel")
            return str(path)

        with patch.object(worker, "r2", return_value=Storage()), \
                patch.object(worker, "render_reel", side_effect=render), \
                patch.object(worker, "_video_duration_s", return_value=2), \
                patch.object(worker, "notify_reel_done"), \
                patch.object(worker, "update_job", side_effect=update):
            return worker.process_reel(self.conn, job, self.user, {})

    def publish_version(self, destination):
        # Activation refuses jobs still recorded as in flight. Exercise the
        # stale tail after cancellation: the old Python call may still finish
        # but must no longer own publication or cleanup.
        self.sql("update jobs set status='cancelled' where options->>'match_id'=%s "
                 "and kind<>'match_reprocess' and status in ('queued','processing')",
                 (self.match,), connection=self.other)
        self.sql("select activate_match_processing_version(%s,%s)",
                 (self.match, destination.processing_version_id), connection=self.other)

    def test_derived_reel_keeps_media_version_when_publish_precedes_media_fetch(self):
        candidate, _ = self.three_versions()
        result = self.run_derived_reel(before_media=lambda: self.publish_version(candidate))
        self.assertEqual(self.derived_downloads, [("media", "old-cut.mp4")])
        self.assertFalse(result)
        self.assertEqual(self.derived_deletes, self.derived_uploads)
        self.assertEqual(self.sql("select status,error,r2_key from match_reels "
                                 "where match_id=%s and scope='full'", (self.match,)),
                         [("failed", "Match version changed.", "reels/previous-match.mp4")])

    def test_derived_reel_failure_after_publish_cannot_fail_new_request(self):
        candidate, _ = self.three_versions()

        def publish_and_request():
            self.publish_version(candidate)
            self.sql("update match_reels set status='queued',error=null,"
                     "r2_key='reels/new-version.mp4',updated_at=clock_timestamp() "
                     "where match_id=%s and scope='full'", (self.match,), connection=self.other)

        with self.assertRaisesRegex(RuntimeError, "fixture encoding failed"):
            self.run_derived_reel(publish_and_request, fail=True)
        self.assertEqual(self.sql("select status,error,r2_key from match_reels "
                                 "where match_id=%s and scope='full'", (self.match,)),
                         [("queued", None, "reels/new-version.mp4")])

    def test_same_version_reels_are_immutable_and_keep_retained_outputs(self):
        self.three_versions()
        self.run_derived_reel()
        first = self.derived_uploads[0]
        self.sql("insert into match_processing_version_reels(version_id,scope,record) "
                 "select %s,scope,to_jsonb(r) from match_reels r "
                 "where match_id=%s and scope='full'", (self.source_version, self.match))
        self.run_derived_reel()
        self.assertNotEqual(self.derived_uploads[0], first)
        self.assertNotIn(first, self.derived_deletes)

    def test_reclip_publication_during_encode_discards_only_new_output(self):
        candidate, retained = self.three_versions()
        point = self.active_points[1]["id"]
        old_path = f"r2://{worker.R2_MEDIA_BUCKET}/points/{self.user}/{self.match}/01-12345678.mp4"
        self.sql("update points set edited=true,clip_path=%s where id=%s", (old_path, point))
        self.sql("update points set clip_path=%s where processing_version_id=%s", (old_path, retained))
        job = self.derived_job("reclip")
        uploads, deletes = [], []

        class Storage:
            def upload_file(self, path, bucket, key, ExtraArgs=None):
                uploads.append(key)

            def delete_object(self, *, Bucket, Key):
                deletes.append(Key)

        def encode(*args):
            Path(args[-1][-1]).write_bytes(b"recut A")
            self.publish_version(candidate)
            return "fixture"

        with patch.object(worker, "r2", return_value=Storage()), \
                patch.object(worker, "_presigned_get", return_value="fixture-raw"), \
                patch.object(worker, "_ffprobe_streams", return_value={}), \
                patch.object(worker, "get_config", return_value="raw"), \
                patch.object(worker, "_run_ffmpeg_encoded", side_effect=encode):
            with self.assertRaisesRegex(RuntimeError, "version changed"):
                worker.process_reclip(self.conn, job, self.user, {})
        self.assertEqual(self.sql("select clip_path,edited from points where id=%s", (point,)),
                         [(old_path, True)])
        self.assertEqual(uploads, deletes)
        self.assertNotIn(old_path.split("/", 3)[-1], deletes)
        self.assertEqual(self.sql("select coalesce(sum(bytes),0) from storage_ledger "
                                 "where r2_key=%s", (f"r2://{worker.R2_MEDIA_BUCKET}/{uploads[0]}",))[0][0], 0)

    def test_placement_writes_and_compensation_never_touch_other_versions(self):
        self.three_versions()
        job = self.derived_job("placement_generate")
        self.sql("update matches set placement_status='processing',"
                 "placement_generation_job_id=%s where id=%s", (job, self.match))
        record = worker.load_placement_attempt_record(
            self.conn, job, self.user, self.match, worker.NORMAL_PLACEMENT_ATTEMPT)
        original = {int(p["idx"]): p.get("placement") for p in record["points"]}
        worker._update_backfill_rows(self.conn, self.match, {1: {"fixture": "A"}},
                                     processing_version_id=record["processing_version_id"])
        self.assertEqual(self.sql("select count(*) from points where match_id=%s "
                                 "and placement is not null and processing_version_id<>%s",
                                 (self.match, self.source_version)), [(0,)])
        worker._restore_placement_database(self.conn, record, job,
                                           worker.NORMAL_PLACEMENT_ATTEMPT, original)
        self.assertEqual(self.sql("select count(*) from points where match_id=%s "
                                 "and placement is not null", (self.match,)), [(0,)])

    def test_placement_publication_before_completion_rejects_stale_lifecycle(self):
        candidate, _ = self.three_versions()
        job = self.derived_job("placement_generate")
        self.sql("update matches set placement_status='processing',"
                 "placement_generation_job_id=%s where id=%s", (job, self.match))
        record = worker.load_placement_attempt_record(
            self.conn, job, self.user, self.match, worker.NORMAL_PLACEMENT_ATTEMPT)
        self.publish_version(candidate)
        with self.assertRaisesRegex(RuntimeError, "not the authorized"):
            worker._commit_placement_lifecycle(
                self.conn, record, job, self.user, worker.NORMAL_PLACEMENT_ATTEMPT,
                status="retry_available", mapped_points=0, failure_code="fixture")
        self.assertEqual(self.sql("select placement_status,placement_failure_code from matches where id=%s",
                                 (self.match,)), [("not_requested", None)])

    def test_highlight_backfill_never_updates_nonactive_receipts(self):
        self.three_versions()
        from worker import highlight_backfill

        class Storage:
            def download_file(self, bucket, key, path):
                Path(path).write_text(json.dumps({"cards": [], "meta": {"route": None}}))

        with patch.object(worker, "r2", return_value=Storage()):
            result = highlight_backfill.backfill_match_from_diagnostic(self.conn, self.match)
        self.assertEqual(result.point_count, 100)
        self.assertEqual(self.sql("select count(*) from points where match_id=%s "
                                 "and processing_version_id<>%s and highlight_evidence is not null",
                                 (self.match, self.source_version)), [(0,)])

    def test_side_change_enrichment_never_attaches_old_evidence_to_new_version(self):
        candidate, _ = self.three_versions()
        before = self.sql("select match_structure from matches where id=%s", (self.match,))[0][0]

        def detect(command, **kwargs):
            self.publish_version(candidate)
            Path(command[command.index("--output") + 1]).write_text(json.dumps({
                "version": 1, "status": "ready", "side_changes": [],
                "coverage": {"qualified": 1, "total": 1},
                "points": [{"idx": 2, "t0": 6, "t1": 8}],
            }))

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(worker, "side_change_detection_enabled", return_value=True), \
                patch.object(worker, "side_change_config", return_value=None), \
                patch.object(worker.subprocess, "run", side_effect=detect), \
                patch.object(worker, "r2") as storage:
            worker.run_side_change_stage(self.conn, self.match, directory, directory, job_id=self.source_job)
            storage.return_value.upload_file.assert_not_called()
        self.assertEqual(self.sql("select match_structure from matches where id=%s", (self.match,)),
                         [(before,)])

    def test_placement_enqueue_stamps_version_and_cannot_be_redirected(self):
        candidate, _ = self.three_versions()
        job = str(uuid.uuid4())
        self.sql("insert into jobs(id,user_id,kind,status,options) values(%s,%s,"
                 "'placement_generate','queued',%s)", (job, self.user, json.dumps({
                     "match_id": self.match, "processing_version_id": candidate.processing_version_id})))
        self.assertEqual(self.sql("select options->>'processing_version_id' from jobs where id=%s", (job,)),
                         [(self.source_version,)])

    def test_unversioned_legacy_reclip_cannot_guess_current_version(self):
        self.three_versions()
        job = self.derived_job("reclip")
        self.sql("update jobs set options=options-'processing_version_id' where id=%s", (job,))
        with patch.object(worker, "r2") as storage:
            with self.assertRaisesRegex(RuntimeError, "no processing version"):
                worker.process_reclip(self.conn, job, self.user, {})
            storage.assert_not_called()

    def test_completed_ordinary_library_redelivery_does_not_reclaim_or_download(self):
        candidate, _ = self.three_versions()
        self.sql("update jobs set options=options||%s::jsonb where id=%s", (
            json.dumps({"match_id": self.match, "processing_version_id": self.source_version}),
            self.source_job))
        self.publish_version(candidate)
        before = self.sql("select id,processing_version_id from points where match_id=%s order by id", (self.match,))
        with patch.object(worker, "archive_message"), \
                patch.object(worker, "pulse_job"), patch.object(worker, "pulse_stage"), \
                patch.object(worker, "r2", side_effect=AssertionError("completed job reached storage")):
            worker.process_job(self.conn, {
                "message": {"job_id": self.source_job, "user_id": self.user,
                            "input_path": f"r2://ponglens-raw/{self.user}/raw.mp4",
                            "kind": "deadspace_cut"}, "msg_id": 1, "read_ct": 2,
            })
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.source_job,)), [("done",)])
        self.assertEqual(self.sql("select id,processing_version_id from points where match_id=%s order by id", (self.match,)), before)

    def test_ready_match_reconciles_its_unfinished_job_before_archive(self):
        self.sql("update jobs set status='processing',result_path=null,progress=70,options=%s where id=%s",
                 (json.dumps({"match_id": self.match, "processing_version_id": self.source_version}),
                  self.source_job))
        self.sql("insert into processing_ledger(user_id,minutes,kind,funding,billing_mode,match_id,job_id) "
                 "values(%s,-11,'spend','personal','test',%s,%s)", (self.user, self.match, self.source_job))
        before = self.sql("select id,processing_version_id from points where match_id=%s order by id", (self.match,))

        def archive_after_completion(_conn, _msg_id):
            self.assertEqual(self.sql("select status,result_path,progress from jobs where id=%s",
                                     (self.source_job,)), [("done", "r2://media/old-cut.mp4", 100)])

        with patch.object(worker, "archive_message", side_effect=archive_after_completion), \
                patch.object(worker, "r2", side_effect=AssertionError("ready match reentered media work")):
            for _ in range(2):
                worker.process_job(self.conn, {
                    "message": {"job_id": self.source_job, "user_id": self.user,
                                "input_path": "r2://media/raw.mp4", "kind": "deadspace_cut"},
                    "msg_id": 1, "read_ct": 2,
                })
        self.assertEqual(self.sql("select id,processing_version_id from points where match_id=%s order by id", (self.match,)), before)
        self.assertEqual(self.sql("select sum(minutes),count(*) filter(where kind='refund') "
                                 "from processing_ledger where job_id=%s", (self.source_job,)), [(-11, 0)])

    def test_deleted_library_job_refunds_once_before_archive_without_processing(self):
        self.sql("update jobs set status='queued',options=%s where id=%s",
                 (json.dumps({"match_id": self.match, "processing_version_id": self.source_version}),
                  self.source_job))
        self.sql("insert into processing_ledger(user_id,minutes,kind,funding,billing_mode,match_id,job_id) "
                 "values(%s,-11,'spend','personal','test',%s,%s)", (self.user, self.match, self.source_job))
        self.sql("delete from matches where id=%s", (self.match,))

        def archive_after_refund(_conn, _msg_id):
            self.assertEqual(self.sql("select status from jobs where id=%s", (self.source_job,)), [("cancelled",)])
            self.assertEqual(self.sql("select sum(minutes) from processing_ledger where job_id=%s", (self.source_job,)), [(0,)])

        with patch.object(worker, "archive_message", side_effect=archive_after_refund), \
                patch.object(worker, "r2", side_effect=AssertionError("deleted match reached media work")):
            for _ in range(2):
                worker.process_job(self.conn, {
                    "message": {"job_id": self.source_job, "user_id": self.user,
                                "input_path": "r2://media/raw.mp4", "kind": "deadspace_cut"},
                    "msg_id": 1, "read_ct": 1,
                })
        self.assertEqual(self.sql("select minutes,reverses_id is not null from processing_ledger "
                                 "where job_id=%s and kind='refund'", (self.source_job,)), [(11, True)])

    def test_failed_deleted_job_reconciliation_keeps_the_real_queue_delivery_retryable(self):
        options = {"match_id": self.match, "processing_version_id": self.source_version}
        self.sql("update jobs set status='queued',options=%s where id=%s", (json.dumps(options), self.source_job))
        self.sql("insert into processing_ledger(user_id,minutes,kind,funding,billing_mode,match_id,job_id) "
                 "values(%s,-11,'spend','personal','test',%s,%s)", (self.user, self.match, self.source_job))
        self.sql("delete from matches where id=%s", (self.match,))
        payload = {"job_id": self.source_job, "user_id": self.user,
                   "input_path": "r2://media/raw.mp4", "kind": "deadspace_cut"}
        message_id = self.sql("select pgmq.send(%s,%s::jsonb)", (worker.QUEUE_NAME, json.dumps(payload)))[0][0]
        for prefix in ("q", "a"):
            self.addCleanup(self.sql, f"delete from pgmq.{prefix}_{worker.QUEUE_NAME} where msg_id=%s", (message_id,))
        message = {"message": payload, "msg_id": message_id, "read_ct": 1}
        with patch.object(worker, "refund_processing_spend_direct", side_effect=lambda conn, _job:
                          self.sql("select 1 / 0", connection=conn)), \
                self.assertRaises(worker.OrdinaryReconciliationRetry) as failure:
            worker.process_job(self.conn, message)
        self.assertIsInstance(failure.exception.__cause__, worker.psycopg2.Error)
        self.assertEqual(self.sql(f"select count(*) from pgmq.q_{worker.QUEUE_NAME} where msg_id=%s", (message_id,)), [(1,)])
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.source_job,)), [("queued",)])
        self.assertEqual(self.sql("select sum(minutes) from processing_ledger where job_id=%s", (self.source_job,)), [(-11,)])
        worker.process_job(self.conn, message)
        self.assertEqual(self.sql(f"select count(*) from pgmq.q_{worker.QUEUE_NAME} where msg_id=%s", (message_id,)), [(0,)])
        self.assertEqual(self.sql(f"select count(*) from pgmq.a_{worker.QUEUE_NAME} where msg_id=%s", (message_id,)), [(1,)])
        self.assertEqual(self.sql("select sum(minutes) from processing_ledger where job_id=%s", (self.source_job,)), [(0,)])

    def test_worker_refund_reverses_only_spends_not_already_refunded(self):
        spend_id = self.sql("insert into processing_ledger(user_id,minutes,kind,job_id) "
                            "values(%s,-11,'spend',%s) returning id", (self.user, self.source_job))[0][0]
        self.sql("insert into processing_ledger(user_id,minutes,kind,job_id,reverses_id) "
                 "values(%s,11,'refund',%s,%s)", (self.user, self.source_job, spend_id))
        self.sql("insert into processing_ledger(user_id,minutes,kind,job_id) values(%s,-4,'spend',%s)",
                 (self.user, self.source_job))
        for _ in range(2):
            worker.refund_processing_spend_direct(self.conn, self.source_job)
        self.assertEqual(self.sql("select sum(minutes),count(*) filter(where kind='refund'),"
                                 "count(*) filter(where kind='refund' and reverses_id is null) "
                                 "from processing_ledger where job_id=%s", (self.source_job,)), [(0, 2, 0)])

    def exhausted_ordinary_delivery(self, job_status, *, match_status="processing"):
        self.sql("update matches set status=%s where id=%s", (match_status, self.match))
        self.sql("update jobs set status=%s,progress=70,error='prior worker crash',options=%s where id=%s",
                 (job_status, json.dumps({"match_id": self.match,
                    "processing_version_id": self.source_version,
                    "originating_match_job_id": self.source_job}), self.source_job))
        self.sql("insert into processing_ledger(user_id,minutes,kind,funding,billing_mode,match_id,job_id) "
                 "values(%s,-11,'spend','personal','test',%s,%s)", (self.user, self.match, self.source_job))
        payload = {"job_id": self.source_job, "user_id": self.user,
                   "input_path": "r2://media/raw.mp4", "kind": "deadspace_cut"}
        message_id = self.sql("select pgmq.send(%s,%s::jsonb)", (worker.QUEUE_NAME, json.dumps(payload)))[0][0]
        for prefix in ("q", "a"):
            self.addCleanup(self.sql, f"delete from pgmq.{prefix}_{worker.QUEUE_NAME} where msg_id=%s", (message_id,))
        return {"message": payload, "msg_id": message_id, "read_ct": worker.MAX_READ_CT + 1}

    def assert_exhausted_delivery_is_terminal(self, starting_status):
        message = self.exhausted_ordinary_delivery(starting_status)
        before = self.sql("select id,processing_version_id from points where match_id=%s order by id", (self.match,))
        with patch.object(worker, "r2", side_effect=AssertionError("exhausted job reopened media work")):
            for _ in range(2):
                worker.process_job(self.conn, message)
        self.assertEqual(self.sql("select status,progress,error from jobs where id=%s", (self.source_job,)),
                         [("failed", 100, "prior worker crash")])
        self.assertEqual(self.sql("select status from matches where id=%s", (self.match,)), [("failed",)])
        self.assertEqual(self.sql("select sum(minutes),count(*) filter(where kind='refund') "
                                 "from processing_ledger where job_id=%s", (self.source_job,)), [(0, 1)])
        self.assertEqual(self.sql("select minutes,reverses_id is not null from processing_ledger "
                                 "where job_id=%s and kind='refund'", (self.source_job,)), [(11, True)])
        self.assertEqual(self.sql("select id,processing_version_id from points where match_id=%s order by id", (self.match,)), before)
        self.assertEqual(self.sql(f"select count(*) from pgmq.q_{worker.QUEUE_NAME} where msg_id=%s", (message["msg_id"],)), [(0,)])
        self.assertEqual(self.sql(f"select count(*) from pgmq.a_{worker.QUEUE_NAME} where msg_id=%s", (message["msg_id"],)), [(1,)])

    def test_exhausted_processing_job_refunds_and_fails_its_match_atomically(self):
        self.assert_exhausted_delivery_is_terminal("processing")

    def test_exhausted_failed_job_refunds_and_fails_its_match_atomically(self):
        self.assert_exhausted_delivery_is_terminal("failed")

    def test_exhausted_terminal_writes_roll_back_if_queue_archive_fails(self):
        message = self.exhausted_ordinary_delivery("processing")
        original_archive = worker.archive_message

        def archive_then_fail(conn, message_id):
            original_archive(conn, message_id)
            self.sql("select 1 / 0", connection=conn)

        with patch.object(worker, "archive_message", side_effect=archive_then_fail), \
                self.assertRaises(worker.OrdinaryReconciliationRetry) as failure:
            worker.process_job(self.conn, message)
        self.assertIsInstance(failure.exception.__cause__, worker.psycopg2.Error)
        self.assertEqual(self.sql("select status,progress from jobs where id=%s", (self.source_job,)), [("processing", 70)])
        self.assertEqual(self.sql("select status from matches where id=%s", (self.match,)), [("processing",)])
        self.assertEqual(self.sql("select sum(minutes),count(*) filter(where kind='refund') "
                                 "from processing_ledger where job_id=%s", (self.source_job,)), [(-11, 0)])
        self.assertEqual(self.sql(f"select count(*) from pgmq.q_{worker.QUEUE_NAME} where msg_id=%s", (message["msg_id"],)), [(1,)])
        self.assertEqual(self.sql(f"select count(*) from pgmq.a_{worker.QUEUE_NAME} where msg_id=%s", (message["msg_id"],)), [(0,)])
        worker.process_job(self.conn, message)
        self.assertEqual(self.sql("select status from matches where id=%s", (self.match,)), [("failed",)])
        self.assertEqual(self.sql("select sum(minutes),count(*) filter(where kind='refund') "
                                 "from processing_ledger where job_id=%s", (self.source_job,)), [(0, 1)])

    def test_exhausted_completed_job_keeps_its_result_and_charge(self):
        message = self.exhausted_ordinary_delivery("done", match_status="ready")
        self.sql("update jobs set result_path='r2://media/old-cut.mp4',progress=100,error=null where id=%s",
                 (self.source_job,))
        worker.process_job(self.conn, message)
        self.assertEqual(self.sql("select status,result_path,progress from jobs where id=%s", (self.source_job,)),
                         [("done", "r2://media/old-cut.mp4", 100)])
        self.assertEqual(self.sql("select status from matches where id=%s", (self.match,)), [("ready",)])
        self.assertEqual(self.sql("select sum(minutes),count(*) filter(where kind='refund') "
                                 "from processing_ledger where job_id=%s", (self.source_job,)), [(-11, 0)])

    def test_exhausted_old_job_does_not_fail_a_newer_claims_match(self):
        message = self.exhausted_ordinary_delivery("processing")
        newer_job = self.derived_job("deadspace_cut")
        # Before the new attempt reaches create_match, matches.job_id still
        # names the older job. Queue ownership must also protect this window.
        worker.process_job(self.conn, message)
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.source_job,)), [("failed",)])
        self.assertEqual(self.sql("select status from jobs where id=%s", (newer_job,)), [("processing",)])
        self.assertEqual(self.sql("select status from matches where id=%s", (self.match,)), [("processing",)])

    def superseded_ordinary_claims(self):
        """Two real personal claims, with the first attempt failing before refund."""
        self.sql("insert into app_roles(user_id,role) values(%s,'qa')", (self.user,))
        self.sql("insert into processing_ledger(user_id,minutes,kind,billing_mode) "
                 "values(%s,50,'grant','test')", (self.user,))
        self.sql("update matches set status='uploaded' where id=%s", (self.match,))

        def claim():
            self.sql("select set_config('request.jwt.claims',%s,false)",
                     (json.dumps({"sub": self.user, "role": "authenticated"}),))
            self.sql("set role authenticated")
            try:
                receipt = self.sql("select public.claim_processing(%s)", (self.match,))[0][0]
            finally:
                self.sql("reset role")
                self.sql("select set_config('request.jwt.claims','{}',false)")
            self.assertEqual(receipt["charged_minutes"], 10)
            self.assertEqual(receipt["funding"], "personal")
            message_id, payload = self.sql(
                f"select msg_id,message from pgmq.q_{worker.QUEUE_NAME} "
                "where message->>'job_id'=%s", (receipt["job_id"],))[0]
            for prefix in ("q", "a"):
                self.addCleanup(self.sql, f"delete from pgmq.{prefix}_{worker.QUEUE_NAME} "
                                "where msg_id=%s", (message_id,))
            return {"message": payload, "msg_id": message_id, "read_ct": worker.MAX_READ_CT}

        old_message = claim()
        old_job = old_message["message"]["job_id"]
        with worker.locked_ordinary_match_attempt(self.conn, self.match, self.user, old_job, claim=True):
            worker.update_job(self.conn, old_job, status="processing")
        worker.update_job(self.conn, old_job, status="failed", progress=70, error="first attempt crashed")
        worker.mark_library_match_failed(self.conn, self.match)
        new_message = claim()
        self.sql(f"update pgmq.q_{worker.QUEUE_NAME} set read_ct=%s where msg_id=%s",
                 (worker.MAX_READ_CT, old_message["msg_id"]))
        return old_message, new_message

    def assert_superseded_claim_keeps_new_work(self, old_message, new_message, before):
        old_job, new_job = (message["message"]["job_id"] for message in (old_message, new_message))
        self.assertEqual(self.sql("select sum(minutes),count(*) filter(where kind='refund') "
                                 "from processing_ledger where job_id=%s", (old_job,)), [(0, 1)])
        self.assertEqual(self.sql("select status,progress,error from jobs where id=%s", (old_job,)),
                         [("failed", 100, "first attempt crashed")])
        self.assertEqual(self.sql("select r.minutes,r.reverses_id=s.id from processing_ledger r "
                                 "join processing_ledger s on s.job_id=r.job_id and s.kind='spend' "
                                 "where r.job_id=%s and r.kind='refund'", (old_job,)), [(10, True)])
        self.assertEqual(self.sql("select sum(minutes),count(*) filter(where kind='refund') "
                                 "from processing_ledger where job_id=%s", (new_job,)), [(-10, 0)])
        self.assertEqual(self.sql("select to_jsonb(j) from jobs j where id=%s", (new_job,)), before[0])
        self.assertEqual(self.sql("select to_jsonb(m) from matches m where id=%s", (self.match,)), before[1])
        self.assertEqual(self.sql("select to_jsonb(p) from points p where match_id=%s order by id",
                                 (self.match,)), before[2])
        self.assertEqual(self.sql(f"select count(*) from pgmq.q_{worker.QUEUE_NAME} where msg_id=%s",
                                 (old_message["msg_id"],)), [(0,)])
        self.assertEqual(self.sql(f"select count(*) from pgmq.a_{worker.QUEUE_NAME} where msg_id=%s",
                                 (old_message["msg_id"],)), [(1,)])
        self.assertEqual(self.sql(f"select count(*) from pgmq.q_{worker.QUEUE_NAME} where msg_id=%s",
                                 (new_message["msg_id"],)), [(1,)])

    def test_superseded_real_claim_refunds_at_attempt_limit_without_touching_new_work(self):
        old_message, new_message = self.superseded_ordinary_claims()
        before = (
            self.sql("select to_jsonb(j) from jobs j where id=%s", (new_message["message"]["job_id"],)),
            self.sql("select to_jsonb(m) from matches m where id=%s", (self.match,)),
            self.sql("select to_jsonb(p) from points p where match_id=%s order by id", (self.match,)),
        )
        with patch.object(worker, "r2", side_effect=AssertionError("superseded claim reopened media work")):
            for _ in range(2):
                worker.process_job(self.conn, old_message)
        self.assert_superseded_claim_keeps_new_work(old_message, new_message, before)

    def test_superseded_claim_refund_and_terminal_state_roll_back_with_archive(self):
        old_message, new_message = self.superseded_ordinary_claims()
        old_job = old_message["message"]["job_id"]
        before = (
            self.sql("select to_jsonb(j) from jobs j where id=%s", (new_message["message"]["job_id"],)),
            self.sql("select to_jsonb(m) from matches m where id=%s", (self.match,)),
            self.sql("select to_jsonb(p) from points p where match_id=%s order by id", (self.match,)),
        )
        original_archive = worker.archive_message

        def archive_then_fail(conn, message_id):
            original_archive(conn, message_id)
            self.sql("select 1 / 0", connection=conn)

        with patch.object(worker, "archive_message", side_effect=archive_then_fail), \
                self.assertRaises(worker.OrdinaryReconciliationRetry) as failure:
            worker.process_job(self.conn, old_message)
        self.assertIsInstance(failure.exception.__cause__, worker.psycopg2.Error)
        self.assertEqual(self.sql("select status,progress from jobs where id=%s", (old_job,)), [("failed", 70)])
        self.assertEqual(self.sql("select sum(minutes),count(*) filter(where kind='refund') "
                                 "from processing_ledger where job_id=%s", (old_job,)), [(-10, 0)])
        self.assertEqual(self.sql(f"select count(*) from pgmq.q_{worker.QUEUE_NAME} where msg_id=%s",
                                 (old_message["msg_id"],)), [(1,)])
        self.assertEqual(self.sql(f"select count(*) from pgmq.a_{worker.QUEUE_NAME} where msg_id=%s",
                                 (old_message["msg_id"],)), [(0,)])
        for _ in range(2):
            worker.process_job(self.conn, old_message)
        self.assert_superseded_claim_keeps_new_work(old_message, new_message, before)

    def test_main_keeps_ready_work_charged_when_reconciliation_archive_fails(self):
        message = self.exhausted_ordinary_delivery("processing", match_status="ready")
        original_archive = worker.archive_message
        attempts = []

        def reject_first_archive(conn, message_id):
            original_archive(conn, message_id)
            attempts.append(message_id)
            if len(attempts) == 1:
                self.sql("select 1 / 0", connection=conn)

        # Run the real main handler for one delivery. Only startup services,
        # queue polling and mail are bounded; processing/SQL/archive are real.
        with patch.object(worker, "LANE", "fast"), \
                patch.object(worker, "connect", return_value=self.conn), \
                patch.object(worker, "_code_version", return_value="fixture"), \
                patch.object(worker, "_ytdlp_version", return_value="fixture"), \
                patch.object(worker, "start_pulse_monitor"), \
                patch.object(worker, "read_message", side_effect=[message, KeyboardInterrupt()]), \
                patch.object(worker, "send_failure_emails"), \
                patch.object(worker, "archive_message", side_effect=reject_first_archive):
            worker.main()
        self.assertEqual(self.sql("select status,progress from jobs where id=%s", (self.source_job,)), [("processing", 70)])
        self.assertEqual(self.sql("select status,cut_path from matches where id=%s", (self.match,)), [("ready", "r2://media/old-cut.mp4")])
        self.assertEqual(self.sql("select sum(minutes),count(*) filter(where kind='refund') "
                                 "from processing_ledger where job_id=%s", (self.source_job,)), [(-11, 0)])
        self.assertEqual(self.sql(f"select count(*) from pgmq.q_{worker.QUEUE_NAME} where msg_id=%s", (message["msg_id"],)), [(1,)])
        worker.process_job(self.conn, message)
        self.assertEqual(self.sql("select status,result_path from jobs where id=%s", (self.source_job,)), [("done", "r2://media/old-cut.mp4")])
        self.assertEqual(self.sql("select sum(minutes) from processing_ledger where job_id=%s", (self.source_job,)), [(-11,)])
        self.assertEqual(self.sql(f"select count(*) from pgmq.a_{worker.QUEUE_NAME} where msg_id=%s", (message["msg_id"],)), [(1,)])

    def test_another_users_spoofed_match_id_cannot_block_ordinary_claim(self):
        other_user, other_job = str(uuid.uuid4()), str(uuid.uuid4())
        self.sql("insert into auth.users(id,email) values(%s,%s)",
                 (other_user, f"worker-spoof-{other_user}@example.com"))
        self.addCleanup(lambda: self.sql("delete from auth.users where id=%s", (other_user,)))
        self.sql("update matches set status='processing' where id=%s", (self.match,))
        self.sql("update jobs set status='queued',options=%s where id=%s",
                 (json.dumps({"match_id": self.match}), self.source_job))
        self.sql("select set_config('request.jwt.claims',%s,false)",
                 (json.dumps({"sub": other_user, "role": "authenticated"}),), connection=self.other)
        self.sql("set role authenticated", connection=self.other)
        try:
            self.sql("insert into jobs(id,user_id,kind,status,options) values(%s,%s,'deadspace_cut','queued',%s)",
                     (other_job, other_user, json.dumps({"match_id": self.match})), connection=self.other)
        finally:
            self.sql("reset role", connection=self.other)
            self.sql("select set_config('request.jwt.claims','{}',false)", connection=self.other)
        try:
            with worker.locked_ordinary_match_attempt(self.conn, self.match, self.user,
                                                      self.source_job, claim=True):
                worker.update_job(self.conn, self.source_job, status="processing")
        except worker.MatchVersionChanged as error:
            self.fail(f"another user's options blocked the owned claim: {error}")
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.source_job,)), [("processing",)])
        self.assertEqual(self.sql("select status from jobs where id=%s", (other_job,)), [("queued",)])

    def test_cost_meter_sql_failure_does_not_abort_ordinary_publication(self):
        self.sql("update matches set status='processing' where id=%s", (self.match,))
        self.sql("update jobs set status='processing',options=%s where id=%s",
                 (json.dumps({"match_id": self.match, "processing_version_id": self.source_version}),
                  self.source_job))
        meter = worker.CostMeter(self.conn)
        with worker.locked_ordinary_match_attempt(self.conn, self.match, self.user, self.source_job):
            self.sql("update matches set venue='Before meter failure' where id=%s", (self.match,))
            meter.record([{"provider": "Local", "service": "Compute", "operation": "fixture",
                           "sku": "mac-studio", "quantity": 1, "unit": "compute_second",
                           "idempotency_key": str(uuid.uuid4()), "occurred_at": "not-a-timestamp"}])
            self.assertEqual(self.conn.get_transaction_status(),
                             worker.psycopg2.extensions.TRANSACTION_STATUS_INTRANS,
                             "fail-soft metering poisoned the publication transaction")
            worker.finish_match(self.conn, self.match, "ready")
        self.assertEqual(self.sql("select status,venue from matches where id=%s", (self.match,)),
                         [("ready", "Before meter failure")])

    def test_stale_ordinary_retry_cannot_delete_published_or_retained_points(self):
        candidate, _ = self.three_versions()
        self.sql("update jobs set options=options||%s::jsonb where id=%s", (
            json.dumps({"match_id": self.match, "processing_version_id": self.source_version}),
            self.source_job))
        self.publish_version(candidate)
        self.sql("update jobs set status='processing' where id=%s", (self.source_job,))
        before = self.sql("select id,processing_version_id from points where match_id=%s order by id", (self.match,))
        with self.assertRaisesRegex(RuntimeError, "version|origin|stale"):
            worker.create_match(self.conn, self.match, self.user, self.source_job,
                                "r2://media/stale-cut.mp4", existing=True)
        self.assertEqual(self.sql("select id,processing_version_id from points where match_id=%s order by id", (self.match,)), before)
        self.assertEqual(self.sql("select active_processing_version_id::text,status,cut_path from matches where id=%s", (self.match,)),
                         [(candidate.processing_version_id, "ready", "r2://media/new-cut.mp4")])

    def test_valid_ordinary_retry_clears_only_its_originating_version(self):
        candidate, retained = self.three_versions()
        self.sql("update matches set status='processing' where id=%s", (self.match,))
        self.sql("update jobs set status='processing',options=options||%s::jsonb where id=%s", (
            json.dumps({"match_id": self.match, "processing_version_id": self.source_version}),
            self.source_job))
        worker.create_match(self.conn, self.match, self.user, self.source_job,
                            "r2://media/retry-cut.mp4", existing=True)
        self.assertEqual(dict(self.sql("select processing_version_id::text,count(*) from points "
                                       "where match_id=%s group by processing_version_id", (self.match,))),
                         {candidate.processing_version_id: 1, retained: 1})

    def test_first_library_claim_freezes_upload_job_and_version_before_retry(self):
        self.sql("update matches set status='processing' where id=%s", (self.match,))
        processing_job = self.derived_job("deadspace_cut")
        # claim_processing enqueues a new processing job but matches.job_id
        # still names the original upload/import until create_match fills it.
        self.sql("update jobs set status='queued',options=%s where id=%s",
                 (json.dumps({"match_id": self.match}), processing_job))
        with worker.locked_ordinary_match_attempt(self.conn, self.match, self.user,
                                                  processing_job, claim=True):
            worker.update_job(self.conn, processing_job, status="processing")
        options = self.sql("select options from jobs where id=%s", (processing_job,))[0][0]
        self.assertEqual(options["processing_version_id"], self.source_version)
        self.assertEqual(options["originating_match_job_id"], self.source_job)
        worker.create_match(self.conn, self.match, self.user, processing_job,
                            "r2://media/first-library-cut.mp4", existing=True)
        worker.update_job(self.conn, processing_job, status="failed")
        with worker.locked_ordinary_match_attempt(self.conn, self.match, self.user,
                                                  processing_job, claim=True):
            worker.update_job(self.conn, processing_job, status="processing")
        worker.create_match(self.conn, self.match, self.user, processing_job,
                            "r2://media/retry-cut.mp4", existing=True)
        self.assertEqual(self.sql("select job_id::text,active_processing_version_id::text from matches where id=%s",
                                 (self.match,)), [(processing_job, self.source_version)])

    def test_unversioned_old_library_claim_cannot_take_over_a_newer_claim(self):
        self.sql("update matches set status='processing' where id=%s", (self.match,))
        self.sql("update jobs set status='failed',options=%s where id=%s",
                 (json.dumps({"match_id": self.match}), self.source_job))
        self.derived_job("deadspace_cut")
        with self.assertRaisesRegex(worker.MatchVersionChanged, "terminal|stale"):
            with worker.locked_ordinary_match_attempt(self.conn, self.match, self.user,
                                                      self.source_job, claim=True):
                self.fail("the old queue delivery reclaimed a newer library attempt")
        self.assertNotIn("processing_version_id", self.sql("select options from jobs where id=%s",
                                                            (self.source_job,))[0][0])

    def test_ordinary_output_transaction_holds_the_publication_lock(self):
        candidate, retained = self.three_versions()
        attempts = []

        def publish_during_upload():
            self.sql("set statement_timeout='100ms'", connection=self.other)
            try:
                with self.assertRaises(worker.psycopg2.errors.QueryCanceled):
                    self.sql("select activate_match_processing_version(%s,%s)",
                             (self.match, candidate.processing_version_id), connection=self.other)
                attempts.append("publication waited for the output transaction")
            finally:
                self.sql("set statement_timeout=0", connection=self.other)

        self.run_match_media(candidate=False, during_upload=publish_during_upload)
        self.assertEqual(len(attempts), 1)
        self.assertEqual(dict(self.sql("select processing_version_id::text,count(*) from points "
                                       "where match_id=%s group by processing_version_id", (self.match,))),
                         {self.source_version: 1, candidate.processing_version_id: 1, retained: 1})

    def test_publication_during_ordinary_compute_prevents_all_output_writes(self):
        candidate, _ = self.three_versions()
        before = self.sql("select id,processing_version_id from points where match_id=%s order by id", (self.match,))

        def another_attempt_finishes_and_publishes():
            self.sql("update jobs set status='done',progress=100 where id=%s", (self.source_job,), connection=self.other)
            self.sql("update matches set status='ready' where id=%s", (self.match,), connection=self.other)
            self.publish_version(candidate)

        uploads = self.run_match_media(candidate=False,
                                       during_cut=another_attempt_finishes_and_publishes,
                                       expected_processed=False)
        self.assertEqual(uploads, {})
        self.assertEqual(self.sql("select status,progress from jobs where id=%s", (self.source_job,)), [("done", 100)])
        self.assertEqual(self.sql("select id,processing_version_id from points where match_id=%s order by id", (self.match,)), before)
        self.assertEqual(self.sql("select active_processing_version_id::text,status,cut_path from matches where id=%s", (self.match,)),
                         [(candidate.processing_version_id, "ready", "r2://media/new-cut.mp4")])

    def test_optional_ledger_failure_does_not_roll_back_ordinary_publication(self):
        self.sql("update matches set status='processing' where id=%s", (self.match,))
        self.sql("update jobs set status='processing',options=options||%s::jsonb where id=%s", (
            json.dumps({"match_id": self.match, "processing_version_id": self.source_version}),
            self.source_job))
        with worker.locked_ordinary_match_attempt(self.conn, self.match, self.user, self.source_job):
            # A real FK violation, not an exception raised by a SQL mock.
            worker.ledger_append(self.conn, str(uuid.uuid4()), "cut", 10)
            worker.finish_match(self.conn, self.match, "ready")
        self.assertEqual(self.sql("select status from matches where id=%s", (self.match,)), [("ready",)])

    def test_failed_ordinary_point_transaction_cannot_be_marked_done(self):
        with patch.object(worker, "persist_match_structure", side_effect=lambda conn, *_args:
                          self.sql("select 1 / 0", connection=conn)), \
                patch.object(worker, "notify_job_failed"), \
                self.assertRaises(worker.psycopg2.Error):
            self.run_match_media(candidate=False, expected_processed=False)
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.source_job,)), [("processing",)])
        self.assertEqual(self.sql("select count(*) from points where processing_version_id=%s",
                                 (self.source_version,)), [(100,)])

    def test_rejected_highlight_writes_clean_up_without_poisoning_publication(self):
        self.sql("update matches set status='processing' where id=%s", (self.match,))
        self.sql("update jobs set status='processing',options=options||%s::jsonb where id=%s", (
            json.dumps({"match_id": self.match, "processing_version_id": self.source_version}),
            self.source_job))
        point = {**self.active_points[1], "t0": 10, "t1": 20, "cut_t0": 4, "rally_end_cut_s": 12,
                 "highlight_evidence": {"v": 2, "status": "ready", "n_hits": 7,
                    "connected_crossings": 6, "table_bounces": 3,
                    "alternating_table_landings": 2, "observed_end_s": 18}}
        uploaded, deleted, attempted = [], [], []
        write_state = worker._write_auto_highlight_state

        def reject_terminal_sql(conn, match_id, status, manifest, **kwargs):
            attempted.append(status)
            # The original write runs and PostgreSQL rejects its status.
            return write_state(conn, match_id, status if status == "rendering" else "invalid",
                               manifest, **kwargs)

        class Storage:
            def upload_file(self, path, bucket, key, ExtraArgs=None):
                uploaded.append(key)

            def delete_object(self, *, Bucket, Key):
                deleted.append(Key)

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory, "highlights.mp4")
            output.write_bytes(b"fixture highlight")
            with patch.object(worker, "r2", return_value=Storage()), \
                    patch.object(worker, "render_auto_highlights", side_effect=lambda manifest, *_args:
                                 (str(output), {**manifest, "duration_s": 8.75})), \
                    patch.object(worker, "_write_auto_highlight_state", side_effect=reject_terminal_sql), \
                    worker.locked_ordinary_match_attempt(self.conn, self.match, self.user, self.source_job):
                result = worker.prepare_auto_highlights(
                    self.conn, self.user, self.match, [point], "cut.mp4", directory,
                    enabled=True, processing_version_id=self.source_version)
                worker.finish_match(self.conn, self.match, "ready")
        self.assertEqual(result, "failed")
        self.assertEqual(attempted, ["rendering", "ready", "failed"])
        self.assertEqual(len(uploaded), 1)
        self.assertEqual(deleted, uploaded)
        self.assertEqual(self.sql("select sum(bytes),count(*) filter(where bytes<0) from storage_ledger where r2_key=%s",
                                 (f"r2://{worker.R2_MEDIA_BUCKET}/{uploaded[0]}",)), [(0, 1)])
        self.assertEqual(self.sql("select status from matches where id=%s", (self.match,)), [("ready",)])

    def test_highlight_backfill_publication_during_diagnostic_never_clears_new_reel(self):
        candidate, _ = self.three_versions()
        from worker import highlight_backfill
        self.sql("insert into match_reels(match_id,scope,status,show_score,manifest) "
                 "values(%s,'highlights','ready',false,'{}')", (self.match,))
        outer = self

        class Storage:
            def download_file(self, bucket, key, path):
                Path(path).write_text(json.dumps({"cards": [], "meta": {"route": None}}))
                outer.publish_version(candidate)
                outer.sql("update match_reels set status='queued',error=null where match_id=%s",
                          (outer.match,), connection=outer.other)

        with patch.object(worker, "r2", return_value=Storage()):
            with self.assertRaisesRegex(RuntimeError, "version changed"):
                highlight_backfill.backfill_match_from_diagnostic(self.conn, self.match)
        self.assertEqual(self.sql("select count(*) from points where match_id=%s "
                                 "and highlight_evidence is not null", (self.match,)), [(0,)])
        self.assertEqual(self.sql("select status from match_reels where match_id=%s", (self.match,)), [("queued",)])

    def render_tag_job(self, during_render=None):
        uploads = []
        self.uploaded_tag_objects = uploads
        self.deleted_tag_objects = []
        deleted = self.deleted_tag_objects
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            output = Path(directory, "reel.mp4")
            output.write_bytes(b"old manifest video")

            def render(manifest, *_args):
                self.assertEqual(manifest, self.manifest)
                if during_render:
                    during_render()
                return str(output)

            class Storage:
                def upload_file(self, path, bucket, key, ExtraArgs=None):
                    uploads.append((key, Path(path).read_bytes()))

                def delete_object(self, *, Bucket, Key):
                    deleted.append(Key)

            stack.enter_context(patch.object(worker, "render_reel", side_effect=render))
            stack.enter_context(patch.object(worker, "r2", return_value=Storage()))
            stack.enter_context(patch.object(worker, "_video_duration_s", return_value=2.0))
            stack.enter_context(patch.object(worker, "pulse_job"))
            stack.enter_context(patch.object(worker, "pulse_stage"))
            stack.enter_context(patch.object(worker, "archive_message"))
            worker.process_job(self.conn, {
                "message": {"job_id": self.tag_job, "user_id": self.user,
                            "input_path": None, "kind": "reel"},
                "msg_id": 1, "read_ct": 1,
            })
        return uploads

    def test_version_publication_during_tag_render_cancels_stale_attempt(self):
        candidate = self.ready_candidate()

        def publish():
            self.sql("select activate_match_processing_version(%s,%s)",
                     (self.match, candidate.processing_version_id), connection=self.other)

        self.render_tag_job(publish)
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.tag_job,)),
                         [("cancelled",)])
        self.assertEqual(self.sql("select status,r2_key from tag_reels where tag_id=%s",
                                 (self.tag,)), [("failed", "reels/previous-tag.mp4")])

    def test_replaced_manifest_during_tag_render_never_publishes_old_bytes(self):
        replacement = {**self.manifest, "title": "Newer request"}

        def replace():
            self.sql("update tag_reels set status='queued',manifest=%s,updated_at=clock_timestamp(),"
                     "r2_key='reels/newer-output.mp4' where tag_id=%s",
                     (json.dumps(replacement), self.tag), connection=self.other)

        uploads = self.render_tag_job(replace)
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.tag_job,)),
                         [("cancelled",)])
        self.assertEqual(self.sql("select status,r2_key,manifest from tag_reels where tag_id=%s",
                                 (self.tag,)), [("queued", "reels/newer-output.mp4", replacement)])
        self.assertTrue(all(key != f"reels/tag-{self.tag}.mp4" for key, _ in uploads))

    def test_identical_newer_request_owns_state_when_old_render_fails(self):
        def replace_then_fail():
            self.sql("update tag_reels set status='rendering',updated_at=clock_timestamp(),"
                     "r2_key='reels/newer-output.mp4' where tag_id=%s",
                     (self.tag,), connection=self.other)
            raise RuntimeError("old encoder failed")

        try:
            self.render_tag_job(replace_then_fail)
        except RuntimeError as error:
            self.assertEqual(str(error), "old encoder failed")
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.tag_job,)),
                         [("cancelled",)])
        self.assertEqual(self.sql("select status,r2_key from tag_reels where tag_id=%s",
                                 (self.tag,)), [("rendering", "reels/newer-output.mp4")])

    def test_successful_tag_attempts_have_distinct_immutable_output_keys(self):
        first = self.render_tag_job()
        self.sql("update tag_reels set status='queued',updated_at=clock_timestamp() where tag_id=%s",
                 (self.tag,))
        second = self.render_tag_job()
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.tag_job,)),
                         [("done",)])
        self.assertNotEqual(first[0][0], second[0][0])
        self.assertIn("-v-", first[0][0])

    def test_stale_tag_attempt_removes_only_its_unpublished_file_and_bytes(self):
        candidate = self.ready_candidate()
        uploads = self.render_tag_job(lambda: self.sql(
            "select activate_match_processing_version(%s,%s)",
            (self.match, candidate.processing_version_id), connection=self.other))
        self.assertEqual(self.deleted_tag_objects, [uploads[0][0]])
        self.assertEqual(self.sql("select coalesce(sum(bytes),0) from storage_ledger where r2_key=%s",
                                 (f"r2://{worker.R2_MEDIA_BUCKET}/{uploads[0][0]}",)), [(0,)])

    def test_successful_tag_render_keeps_a_historical_previous_output(self):
        self.sql("insert into match_processing_version_reels(version_id,scope,record) "
                 "values(%s,'tag:test',%s)",
                 (self.source_version, json.dumps({"r2_key": "reels/previous-tag.mp4"})))
        self.render_tag_job()
        self.assertEqual(self.deleted_tag_objects, [])

    def fail_tag_completion_after_upload(self, *, retained_by=None):
        update_job = worker.update_job

        def fail_done_write(conn, job_id, **fields):
            if fields.get("status") == "done":
                key = self.uploaded_tag_objects[0][0]
                if retained_by == "historical":
                    self.sql("insert into match_processing_version_reels(version_id,scope,record) "
                             "values(%s,'tag:test',%s)",
                             (self.source_version, json.dumps({"r2_key": key})),
                             connection=self.other)
                elif retained_by == "current":
                    self.sql("insert into match_reels(match_id,scope,status,show_score,manifest,r2_key) "
                             "values(%s,'full','ready',false,%s,%s)",
                             (self.match, json.dumps(self.manifest), key), connection=self.other)
                # The real finalizer has already written tag-ready in its
                # transaction. Failing this final write must roll that back,
                # then use the normal exception path to mark the tag failed.
                raise RuntimeError("completion write failed")
            return update_job(conn, job_id, **fields)

        with patch.object(worker, "update_job", side_effect=fail_done_write):
            with self.assertRaisesRegex(RuntimeError, "completion write failed"):
                self.render_tag_job()
        self.assertEqual(self.sql("select status,r2_key,error from tag_reels where tag_id=%s",
                                 (self.tag,)),
                         [("failed", "reels/previous-tag.mp4", "completion write failed")])
        return self.uploaded_tag_objects[0][0]

    def test_failed_tag_completion_cleans_uploaded_bytes_once_across_redelivery(self):
        key = self.fail_tag_completion_after_upload()
        uri = f"r2://{worker.R2_MEDIA_BUCKET}/{key}"
        self.assertEqual(self.deleted_tag_objects, [key])
        self.assertEqual(self.sql("select sum(bytes),count(*) filter(where bytes<0) "
                                 "from storage_ledger where r2_key=%s", (uri,)), [(0, 1)])
        # The worker loop records the raised error on the job. Its next queue
        # delivery retries normally and gets a different immutable output.
        worker.update_job(self.conn, self.tag_job, status="failed", error="completion write failed")
        retry = self.render_tag_job()
        self.assertNotEqual(retry[0][0], key)
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.tag_job,)), [("done",)])
        self.assertEqual(self.sql("select sum(bytes),count(*) filter(where bytes<0) "
                                 "from storage_ledger where r2_key=%s", (uri,)), [(0, 1)])
        self.assertEqual(self.sql("select sum(bytes) from storage_ledger where user_id=%s",
                                 (self.user,)), [(18,)])

    def test_failed_tag_completion_keeps_historical_output_and_its_bytes(self):
        key = self.fail_tag_completion_after_upload(retained_by="historical")
        self.assertEqual(self.deleted_tag_objects, [])
        self.assertEqual(self.sql("select sum(bytes),count(*) filter(where bytes<0) "
                                 "from storage_ledger where r2_key=%s",
                                 (f"r2://{worker.R2_MEDIA_BUCKET}/{key}",)), [(18, 0)])

    def test_failed_tag_completion_keeps_current_output_and_its_bytes(self):
        key = self.fail_tag_completion_after_upload(retained_by="current")
        self.assertEqual(self.deleted_tag_objects, [])
        self.assertEqual(self.sql("select sum(bytes),count(*) filter(where bytes<0) "
                                 "from storage_ledger where r2_key=%s",
                                 (f"r2://{worker.R2_MEDIA_BUCKET}/{key}",)), [(18, 0)])

    def test_cancelled_tag_completion_error_cleans_only_its_attempt_output(self):
        finish = worker.finish_tag_reel_attempt

        def replace_then_fail(conn, attempt, **fields):
            if fields.get("error") is None:
                self.sql("update tag_reels set status='queued',updated_at=clock_timestamp() "
                         "where tag_id=%s", (self.tag,), connection=self.other)
                raise RuntimeError("completion unavailable after newer request")
            return finish(conn, attempt, **fields)

        with patch.object(worker, "finish_tag_reel_attempt", side_effect=replace_then_fail):
            uploads = self.render_tag_job()
        key = uploads[0][0]
        self.assertEqual(self.deleted_tag_objects, [key])
        self.assertEqual(self.sql("select status,r2_key from tag_reels where tag_id=%s", (self.tag,)),
                         [("queued", "reels/previous-tag.mp4")])
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.tag_job,)), [("cancelled",)])
        self.assertEqual(self.sql("select sum(bytes) from storage_ledger where r2_key=%s",
                                 (f"r2://{worker.R2_MEDIA_BUCKET}/{key}",)), [(0,)])

    def test_unconfirmed_tag_failure_never_deletes_uploaded_output(self):
        with patch.object(worker, "finish_tag_reel_attempt", side_effect=RuntimeError("database unavailable")):
            with self.assertRaisesRegex(RuntimeError, "database unavailable"):
                self.render_tag_job()
        key = self.uploaded_tag_objects[0][0]
        self.assertEqual(self.deleted_tag_objects, [])
        self.assertEqual(self.sql("select status from tag_reels where tag_id=%s", (self.tag,)), [("rendering",)])
        self.assertEqual(self.sql("select sum(bytes) from storage_ledger where r2_key=%s",
                                 (f"r2://{worker.R2_MEDIA_BUCKET}/{key}",)), [(18,)])

    def test_candidate_retry_removes_only_its_stale_tail(self):
        candidate = self.make_candidate()
        points = [{"idx": idx, "t0": idx * 3, "t1": idx * 3 + 2,
                   "clip": f"{idx}.mp4"} for idx in range(1, 101)]
        first = worker.insert_points(self.conn, self.match, points, candidate.r2_prefix,
                                     processing_version_id=candidate.processing_version_id)
        retry = worker.insert_points(self.conn, self.match, points[:95], candidate.r2_prefix,
                                     processing_version_id=candidate.processing_version_id)
        worker.finalize_match_reprocess_success(
            self.conn, candidate, cut_path="r2://media/candidate.mp4", thumb_path=None,
            match_json_path=f"{candidate.r2_prefix}/match.json", match_state={"status": "ready"},
            point_indices=list(retry),
        )
        self.assertEqual(first[1]["id"], retry[1]["id"])
        self.assertEqual(self.sql("select count(*),max(idx) from points where processing_version_id=%s",
                                 (candidate.processing_version_id,)), [(95, 95)])
        self.assertEqual(self.sql("select count(*),max(idx) from points where processing_version_id=%s",
                                 (self.source_version,)), [(100, 100)])
        self.assertEqual(self.sql("select status,cut_path from matches where id=%s", (self.match,)),
                         [("ready", "r2://media/old-cut.mp4")])

    def test_legacy_historical_highlight_key_is_never_deleted(self):
        key = f"reels/{self.match}-highlights-old.mp4"
        self.sql("insert into match_processing_version_reels(version_id,scope,record) "
                 "values(%s,'highlights',%s)",
                 (self.source_version, json.dumps({"r2_key": key})))
        with patch.object(worker, "r2") as storage, \
                patch.object(worker, "ledger_negate_keys") as negate:
            worker._delete_auto_highlight_object(self.conn, key)
        storage.assert_not_called()
        negate.assert_not_called()

    def run_match_media(self, *, candidate, fail_early=False, destination=None, actual_pipeline="v2",
                        during_cut=None, during_upload=None, expected_processed=True):
        destination = (destination or self.make_candidate()) if candidate else None
        job = destination.job_id if candidate else self.source_job
        options = dict(destination.options) if candidate else {
            "points": True, "match_id": self.match, "placement": False,
            "strictness": "normal", "meta": {"user_side": "near"},
        }
        self.sql("update jobs set options=%s,status='failed' where id=%s",
                 (json.dumps(options), job))
        if candidate:
            # Candidate processing has already been claimed by its caller.
            self.sql("update jobs set status='processing' where id=%s", (job,))
        else:
            # A retryable crash leaves the library match in flight. A ready
            # match is a finished result and must never be a retry fixture.
            self.sql("update matches set status='processing' where id=%s", (self.match,))
        uploads, detection, assembly, cuts = {}, [], [], []
        evidence = {"version": 1, "points": [{"idx": 1}],
                    "first_server": {"status": "high_confidence", "side": "far"}}

        def write_points(workdir):
            outdir = Path(workdir, "points_out")
            outdir.mkdir(exist_ok=True)
            (outdir / "clips").mkdir(exist_ok=True)
            (outdir / "clips/1.mp4").write_bytes(b"point clip")
            (outdir / "calib_debug.jpg").write_bytes(b"calibration")
            (outdir / "match.json").write_text(json.dumps({
                "pipeline": actual_pipeline, "cut_mode": "plays",
                "points": [{"idx": 1, "t0": 10, "t1": 14, "clip": "clips/1.mp4",
                            "cut_t0": 2, "rally_end_cut_s": 5}],
                "cut_segments": [{"t0": 8, "t1": 15}],
                "options": {"clip_pads": {"before": 2, "after": 1}},
                "story_crop": None,
            }))
            return str(outdir)

        def detect(_video, _workdir, **kwargs):
            detection.append(kwargs)
            return "blurball.json"

        def assemble(_video, _blurball, workdir, _options, **kwargs):
            assembly.append(kwargs)
            if fail_early:
                raise RuntimeError("early assembly unavailable")
            return write_points(workdir)

        def cut(_video, workdir, _blurball, strictness, **kwargs):
            cuts.append((strictness, kwargs["segments_json"]))
            path = Path(workdir, "cut.mp4")
            path.write_bytes(b"cut video")
            if during_cut:
                during_cut()
            return str(path)

        def thumb(source, output, seek):
            self.assertTrue(Path(source).is_file(), "thumbnail must use the original nested clip path")
            self.assertEqual(Path(source).read_bytes(), b"point clip")
            self.assertEqual(seek, 2)
            Path(output).write_bytes(b"thumbnail")
            return True

        class Storage:
            def download_file(self, bucket, key, destination_path):
                Path(destination_path).write_bytes(b"raw video")

            def upload_file(self, path, bucket, key, ExtraArgs=None):
                if not uploads and during_upload:
                    during_upload()
                uploads[key] = Path(path).read_bytes()

        with ExitStack() as stack:
            for name, replacement in {
                "r2": lambda: Storage(), "detect_ball": detect,
                "run_points_subprocess": assemble, "run_cut": cut,
                "extract_thumb": thumb, "merge_card_audio": lambda *_a: None,
                "publish_card_diagnosis": lambda *_a: 0,
                "run_match_structure_stage": lambda *_a: copy.deepcopy(evidence),
                "capture_date_from_file": lambda *_a: None,
                "looks_like_table_tennis": lambda *_a: True,
                "looks_like_broadcast": lambda *_a: False,
                "get_config": lambda _conn, key: "v2" if key == "points_pipeline" else None,
                "pulse_job": lambda *_a: None, "pulse_stage": lambda *_a: None,
                "archive_message": lambda *_a: None,
                "notify_job_done": lambda *_a: None, "run_side_change_stage": lambda *_a, **_kw: None,
                "prepare_auto_highlights": lambda *_a, **_kw: "off",
            }.items():
                stack.enter_context(patch.object(worker, name, replacement))
            # This subprocess boundary is only used by the ordinary legacy
            # span fallback after its early point assembly failed.
            stack.enter_context(patch.object(worker.subprocess, "run",
                                             side_effect=lambda *_a, **kw: write_points(kw["cwd"])))
            if candidate:
                with patch.object(worker, "ledger_append", side_effect=AssertionError("candidate ledger")), \
                        patch.object(worker, "ledger_negate_keys", side_effect=AssertionError("candidate ledger")):
                    worker.process_match_reprocess(self.conn, job, "candidate:1", destination)
            else:
                worker.process_job(self.conn, {
                    "message": {"job_id": job, "user_id": self.user,
                                "input_path": f"r2://ponglens-raw/{self.user}/raw.mp4",
                                "kind": "deadspace_cut"}, "msg_id": 1, "read_ct": 2,
                })
        if not expected_processed:
            return uploads
        self.assertEqual(len(detection), 1)
        self.assertEqual(assembly[0]["pipeline"], "v2")
        self.assertEqual(cuts[0][0], "normal")
        if fail_early:
            self.assertIsNone(cuts[0][1])
        else:
            self.assertTrue(cuts[0][1].endswith("points_out/match.json"))
        prefix = destination.storage_prefix if candidate else f"points/{self.user}/{self.match}"
        self.assertEqual(uploads[f"{prefix}/1.mp4"], b"point clip")
        self.assertEqual(uploads[f"{prefix}/calib_debug.jpg"], b"calibration")
        self.assertEqual(uploads[f"{prefix}/thumb-{job}.webp"], b"thumbnail")
        self.assertIn(f"{prefix}/match.json", uploads)
        if candidate:
            state = self.sql("select match_state from match_processing_versions where id=%s",
                             (destination.processing_version_id,))[0][0]
        else:
            state = self.sql("select to_jsonb(m) from matches m where id=%s", (self.match,))[0][0]
        self.assertEqual(state["clip_pads"], {"before": 2, "after": 1})
        self.assertIsNone(state["story_crop"])
        self.assertEqual(state["placement_status"], "not_requested")
        self.assertEqual(state["match_structure"]["points"][0]["idx"], 1)
        self.assertEqual(state["first_server"], "user")
        return destination

    def test_candidate_uses_complete_media_and_metadata_workflow_without_active_writes(self):
        before = self.sql("select to_jsonb(m) from matches m where id=%s", (self.match,))
        self.run_match_media(candidate=True)
        self.assertEqual(self.sql("select to_jsonb(m) from matches m where id=%s", (self.match,)), before)
        self.assertEqual(self.sql("select count(*) from points where processing_version_id=%s",
                                 (self.source_version,)), [(100,)])

    def test_failed_ordinary_job_retries_with_existing_media_and_metadata_behavior(self):
        self.run_match_media(candidate=False)
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.source_job,)), [("done",)])
        self.assertEqual(self.sql("select count(*) from points where processing_version_id=%s",
                                 (self.source_version,)), [(1,)])

    def test_ordinary_early_point_failure_keeps_span_cut_and_retries_points(self):
        self.run_match_media(candidate=False, fail_early=True)
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.source_job,)), [("done",)])

    def candidate_message(self, candidate):
        return {
            "message": {"job_id": candidate.job_id, "user_id": self.user,
                        "input_path": candidate.source_path, "kind": "match_reprocess"},
            "msg_id": 1, "read_ct": 2,
        }

    def test_completed_candidate_redelivery_never_reenters_media_workflow(self):
        candidate = self.ready_candidate()
        before = self.sql("select to_jsonb(v) from match_processing_versions v where id=%s",
                          (candidate.processing_version_id,))
        with patch.object(worker, "process_match_reprocess", side_effect=AssertionError("rerender")), \
                patch.object(worker, "archive_message") as archive:
            worker.process_job(self.conn, self.candidate_message(candidate))
        archive.assert_called_once_with(self.conn, 1)
        self.assertEqual(self.sql("select status from jobs where id=%s", (candidate.job_id,)), [("done",)])
        self.assertEqual(self.sql("select to_jsonb(v) from match_processing_versions v where id=%s",
                                 (candidate.processing_version_id,)), before)

    def test_candidate_terminal_transaction_rolls_back_points_version_issue_and_event(self):
        candidate = self.make_candidate()
        worker.insert_points(self.conn, self.match,
                             [{"idx": 100, "t0": 10, "t1": 12, "clip": "100.mp4"}],
                             candidate.r2_prefix, processing_version_id=candidate.processing_version_id)
        with patch.object(worker, "update_job", side_effect=RuntimeError("terminal job write failed")):
            with self.assertRaisesRegex(RuntimeError, "terminal job write failed"):
                worker.finalize_match_reprocess_success(
                    self.conn, candidate, cut_path="r2://media/new-cut.mp4", thumb_path=None,
                    match_json_path="r2://media/new-match.json", match_state={"status": "ready"},
                    point_indices=list(range(1, 96)),
                )
        self.assertTrue(self.conn.autocommit)
        self.assertEqual(self.sql("select idx from points where processing_version_id=%s",
                                 (candidate.processing_version_id,)), [(100,)])
        self.assertEqual(self.sql("select status,completed_at from match_processing_versions where id=%s",
                                 (candidate.processing_version_id,)), [("candidate", None)])
        self.assertEqual(self.sql("select status from match_processing_feedback where id=%s",
                                 (candidate.issue_id,)), [("reprocess_queued",)])
        self.assertEqual(self.sql("select count(*) from match_processing_feedback_events "
                                 "where issue_id=%s and kind='candidate_ready'", (candidate.issue_id,)), [(0,)])

    def test_failed_terminal_bookkeeping_keeps_candidate_and_queue_retryable(self):
        candidate = self.make_candidate()
        with patch.object(worker, "process_match_reprocess", side_effect=RuntimeError("source unavailable")), \
                patch.object(worker, "update_job", side_effect=RuntimeError("terminal job write failed")), \
                patch.object(worker, "pulse_job"), \
                patch.object(worker, "archive_message") as archive:
            worker.process_job(self.conn, self.candidate_message(candidate))
        archive.assert_not_called()
        self.assertEqual(self.sql("select status from jobs where id=%s", (candidate.job_id,)), [("processing",)])
        self.assertEqual(self.sql("select status from match_processing_versions where id=%s",
                                 (candidate.processing_version_id,)), [("candidate",)])
        self.assertEqual(self.sql("select status from match_processing_feedback where id=%s",
                                 (candidate.issue_id,)), [("reprocess_queued",)])

    def test_stale_tag_manifest_at_claim_cancels_without_rendering(self):
        candidate = self.ready_candidate()
        self.sql("select activate_match_processing_version(%s,%s)",
                 (self.match, candidate.processing_version_id))
        with patch.object(worker, "render_reel", side_effect=AssertionError("stale render")), \
                patch.object(worker, "archive_message"), patch.object(worker, "pulse_job"), \
                patch.object(worker, "pulse_stage"):
            worker.process_job(self.conn, {
                "message": {"job_id": self.tag_job, "user_id": self.user,
                            "input_path": None, "kind": "reel"}, "msg_id": 1, "read_ct": 1,
            })
        self.assertEqual(self.sql("select status from jobs where id=%s", (self.tag_job,)), [("cancelled",)])
        self.assertEqual(self.sql("select status from tag_reels where tag_id=%s", (self.tag,)), [("failed",)])

    def test_tag_completion_locks_versions_until_its_ready_write_commits(self):
        candidate = self.ready_candidate()
        self.sql("set lock_timeout='100ms'", connection=self.other)
        read_sources = worker.locked_tag_reel_sources
        snapshots = []

        def snapshot_with_publish_race(conn, manifest):
            sources = read_sources(conn, manifest)
            snapshots.append(sources)
            if len(snapshots) == 2:  # completion, after the version read
                with self.assertRaises(worker.psycopg2.errors.LockNotAvailable):
                    self.sql("select activate_match_processing_version(%s,%s)",
                             (self.match, candidate.processing_version_id), connection=self.other)
            return sources

        with patch.object(worker, "locked_tag_reel_sources", side_effect=snapshot_with_publish_race):
            self.render_tag_job()
        self.assertEqual(len(snapshots), 2)
        self.assertEqual(self.sql("select status from tag_reels where tag_id=%s", (self.tag,)), [("ready",)])
        # The exact same publication succeeds after completion commits.
        self.sql("select activate_match_processing_version(%s,%s)",
                 (self.match, candidate.processing_version_id), connection=self.other)


if __name__ == "__main__":
    unittest.main()
