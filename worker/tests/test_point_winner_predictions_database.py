"""Real migrated local PostgreSQL tests, rolled back after every test.

NET_WINNER_TEST_DSN must target loopback; never run this against production.
"""
import json
import os
import unittest
import uuid
from pathlib import Path

import psycopg2
from psycopg2.extensions import parse_dsn

# Import configuration stays local/dummy; tests never consult Keychain.
for key, value in {
    "DATABASE_URL": "postgresql://invalid", "SUPABASE_SERVICE_ROLE_KEY": "test",
    "SUPABASE_URL": "https://example.invalid", "R2_ACCOUNT_ID": "test",
    "R2_ACCESS_KEY_ID": "test", "R2_SECRET_ACCESS_KEY": "test", "OPENAI_API_KEY": "test",
}.items():
    os.environ.setdefault(key, value)
import point_winner_predictions as predictions
try:
    from worker import worker
except ImportError:
    import worker

DSN = os.environ.get("NET_WINNER_TEST_DSN")
MIGRATION = Path(__file__).resolve().parents[2] / "supabase/migrations/20260913153000_point_winner_predictions.sql"


@unittest.skipUnless(DSN, "set NET_WINNER_TEST_DSN to the local migrated database")
class PredictionDatabaseTests(unittest.TestCase):
    def setUp(self):
        if parse_dsn(DSN).get("host") not in ("localhost", "127.0.0.1", "::1"):
            raise RuntimeError("prediction DB tests require loopback")
        self.conn = psycopg2.connect(DSN)
        self.addCleanup(self.conn.close)
        self.addCleanup(self.conn.rollback)
        with self.conn.cursor() as cur:
            cur.execute(MIGRATION.read_text())
            self.owner, self.job, self.match = [str(uuid.uuid4()) for _ in range(3)]
            cur.execute("insert into auth.users(id,email) values(%s,%s)", (self.owner, self.owner + "@example.invalid"))
            cur.execute("insert into jobs(id,user_id,status,kind,input_path,options) values(%s,%s,'done','deadspace_cut','r2://test/raw.mp4','{}')", (self.job, self.owner))
            cur.execute("insert into matches(id,user_id,job_id,status,raw_path) values(%s,%s,%s,'ready','r2://test/raw.mp4')", (self.match, self.owner, self.job))
        self.points = [dict(idx=7,t0=10.12,t1=15.35,cut_t0=0,clip="07.mp4",suggestion={"winner":"user","how":"legacy"})]
        self.rows = [dict(idx=7,method="net_low_bounces",method_version="net-endings-v1",status="predicted",
                          winner_side="far",reason="terminal_net_sequence",evaluated_t0=10.12,evaluated_t1=15.35,
                          published_t0=10.12,published_t1=15.35,evidence={"confirming_bounce_s":14.3})]
        self.provenance = dict(job_id=self.job, source_identity="r2://test/raw.mp4", source_offset_s=125.25, release_id="test-release")

    def scalar(self, sql, args=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchone()[0]

    def insert(self):
        result = worker.insert_points(self.conn, self.match, self.points, "r2://test/clips", prediction_rows=self.rows, prediction_provenance=self.provenance)
        return result[7]["id"]

    def test_predictions_are_saved_without_scoring_and_score_edits_do_not_change_them(self):
        point = self.insert()
        before = self.scalar("select row_to_json(r)::text from point_winner_predictions r where point_id=%s", (point,))
        self.assertIsNone(self.scalar("select confirmed_winner from points where id=%s", (point,)))
        with self.conn.cursor() as cur:
            cur.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({"sub":self.owner,"role":"authenticated"}),))
            cur.execute("set local role authenticated")
            cur.execute("update points set confirmed_winner='opponent' where id=%s", (point,))
            self.assertEqual(1,cur.rowcount)
            cur.execute("update points set confirmed_winner=null,is_let=true where id=%s", (point,))
            cur.execute("reset role")
        self.assertEqual(before, self.scalar("select row_to_json(r)::text from point_winner_predictions r where point_id=%s", (point,)))
        self.assertEqual("far", self.scalar("select winner_side from point_winner_predictions where point_id=%s", (point,)))
        self.assertEqual(125.25, float(self.scalar("select source_offset_s from point_winner_predictions where point_id=%s", (point,))))
        self.assertEqual("user", self.scalar("select suggestion->>'winner' from points where id=%s", (point,)))

    def test_same_method_retry_is_idempotent_and_timing_edit_is_stale(self):
        point = self.insert()
        predictions.persist_predictions(self.conn, {7:{"id":point}}, self.rows, self.provenance)
        self.assertEqual(1, self.scalar("select count(*) from point_winner_predictions where point_id=%s", (point,)))
        self.assertTrue(self.scalar("select window_is_current from private_point_winner_prediction_status where point_id=%s", (point,)))
        with self.conn.cursor() as cur:
            cur.execute("update points set t1=16 where id=%s", (point,))
        self.assertFalse(self.scalar("select window_is_current from private_point_winner_prediction_status where point_id=%s", (point,)))
        self.assertEqual(15.35,float(self.scalar("select published_t1 from point_winner_predictions where point_id=%s", (point,))))

    def test_client_roles_cannot_read_or_write_predictions(self):
        self.insert()
        for role in ("anon", "authenticated"):
            for operation in ("select * from point_winner_predictions", "insert into point_winner_predictions default values", "delete from point_winner_predictions", "update point_winner_predictions set winner_side='near'", "select * from private_point_winner_prediction_status"):
                with self.subTest(role=role, operation=operation), self.conn.cursor() as cur:
                    cur.execute("savepoint denied")
                    cur.execute("set local role " + role)
                    with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                        cur.execute(operation)
                    cur.execute("rollback to savepoint denied")
                    cur.execute("release savepoint denied")

    def test_service_role_can_write_and_point_delete_cascades(self):
        with self.conn.cursor() as cur:
            cur.execute("set local role service_role")
        point=self.insert()
        self.assertEqual(1,self.scalar("select count(*) from point_winner_predictions where point_id=%s",(point,)))
        with self.conn.cursor() as cur:
            cur.execute("savepoint immutable")
            with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                cur.execute("update point_winner_predictions set published_t1=99 where point_id=%s", (point,))
            cur.execute("rollback to savepoint immutable")
            cur.execute("release savepoint immutable")
            cur.execute("delete from points where id=%s",(point,))
        self.assertEqual(0,self.scalar("select count(*) from point_winner_predictions where point_id=%s",(point,)))

    def test_failed_prediction_write_rolls_back_the_new_points(self):
        self.rows[0]["status"]="abstained"  # Non-null side violates the DB contract.
        with self.assertRaises(psycopg2.errors.CheckViolation):
            self.insert()
        self.assertEqual(0,self.scalar("select count(*) from points where match_id=%s",(self.match,)))

    def test_changed_retry_cannot_overwrite_observation(self):
        point = self.insert()
        self.rows[0]["winner_side"] = "near"
        with self.assertRaisesRegex(ValueError, "differs from immutable"):
            predictions.persist_predictions(self.conn, {7: {"id": point}}, self.rows, self.provenance)
        self.assertEqual("far", self.scalar("select winner_side from point_winner_predictions where point_id=%s", (point,)))

    def test_autocommit_connection_restored_after_success_and_failure(self):
        conn = psycopg2.connect(DSN)
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("create temporary table prediction_atomicity_fixture(value integer)")
            with predictions.atomic_point_writes(conn):
                with conn.cursor() as cur:
                    cur.execute("insert into prediction_atomicity_fixture values(1)")
            self.assertTrue(conn.autocommit)
            with self.assertRaisesRegex(ValueError, "abort"):
                with predictions.atomic_point_writes(conn):
                    with conn.cursor() as cur:
                        cur.execute("insert into prediction_atomicity_fixture values(2)")
                    raise ValueError("abort")
            self.assertTrue(conn.autocommit)
            with conn.cursor() as cur:
                cur.execute("select array_agg(value) from prediction_atomicity_fixture")
                self.assertEqual([1], cur.fetchone()[0])
        finally:
            conn.close()

    def test_same_idx_in_two_versions_has_separate_identity(self):
        point=self.insert()
        oldversion=self.scalar("select processing_version_id from points where id=%s",(point,))
        version, otherpoint=str(uuid.uuid4()),str(uuid.uuid4())
        with self.conn.cursor() as cur:
            cur.execute("insert into match_processing_versions(id,match_id,status) values(%s,%s,'candidate')",(version,self.match))
            cur.execute("insert into points(id,match_id,processing_version_id,idx,t0,t1) values(%s,%s,%s,7,10.12,15.35)",(otherpoint,self.match,version))
        predictions.persist_predictions(self.conn,{7:{"id":otherpoint}},self.rows,self.provenance)
        self.assertEqual(str(oldversion),str(self.scalar("select processing_version_id from private_point_winner_prediction_status where point_id=%s",(point,))))
        self.assertEqual(version,str(self.scalar("select processing_version_id from private_point_winner_prediction_status where point_id=%s",(otherpoint,))))
        self.assertFalse(self.scalar("select version_is_active from private_point_winner_prediction_status where point_id=%s",(otherpoint,)))


if __name__ == "__main__":
    unittest.main()
