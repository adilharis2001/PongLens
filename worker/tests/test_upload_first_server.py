"""The upload form's answer to "who served first" reaches the match row.

Three places create or fill that row and each had to learn the column:
register_upload (SQL, migration 131) for the commerce path, and here
create_match for a processed upload plus create_uploaded_match for
a library import. A path that forgets it is not a visible bug — the row
is simply born null and the match page asks a question the uploader
already answered, which is exactly the behaviour this was meant to end.

Two invariants are worth more than the plumbing:

  * an answer always travels with first_server_source = 'user', because
    persist_match_structure only defers to a value carrying that source.
    Without it the RTMPose detector silently overrules the person who was
    standing at the table.
  * filling an existing row NEVER overwrites. By the time the worker gets
    there the answer may already have come from register_upload at
    completion, or from the owner correcting it on the raw page while the
    job ran. Either is a newer read than this stale form state.
"""
import unittest

from worker.worker import (
    create_match,
    create_uploaded_match,
    meta_first_server,
)


MATCH_ID = "20000000-0000-0000-0000-000000000001"
USER_ID = "30000000-0000-0000-0000-000000000002"
JOB_ID = "40000000-0000-0000-0000-000000000003"


class RecordingCursor:
    def __init__(self, calls):
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params=None):
        self.calls.append((" ".join(query.split()), params))

    def fetchone(self):
        return (MATCH_ID,)


class RecordingConnection:
    def __init__(self):
        self.calls = []

    def cursor(self):
        return RecordingCursor(self.calls)


def statement(conn, needle):
    """The one recorded statement containing needle."""
    hits = [c for c in conn.calls if needle in c[0]]
    assert len(hits) == 1, f"expected 1 statement with {needle!r}, got {len(hits)}"
    return hits[0]


class MetaFirstServerTests(unittest.TestCase):
    def test_the_two_answers_pass(self):
        self.assertEqual(meta_first_server({"first_server": "user"}), "user")
        self.assertEqual(
            meta_first_server({"first_server": "opponent"}), "opponent")

    def test_anything_else_is_no_answer(self):
        # A stray value must not become a first server. It would be wrong
        # for the whole match AND suppress the prompt that fixes it.
        for value in ("near", "far", "", "USER", True, 1, None, {}, []):
            with self.subTest(value=value):
                self.assertIsNone(meta_first_server({"first_server": value}))

    def test_an_absent_or_malformed_meta_is_no_answer(self):
        self.assertIsNone(meta_first_server({}))
        self.assertIsNone(meta_first_server(None))
        self.assertIsNone(meta_first_server("first_server=user"))


class CreateMatchTests(unittest.TestCase):
    def insert(self, first_server):
        conn = RecordingConnection()
        create_match(conn, MATCH_ID, USER_ID, JOB_ID, "r2://cut.mp4",
                     first_server=first_server)
        return statement(conn, "insert into public.matches")

    def test_the_answer_and_its_source_land_together(self):
        sql, params = self.insert("opponent")
        self.assertIn("first_server, first_server_source", sql)
        self.assertIn("case when %s is not null then 'user' end", sql)
        # Twice: once for the value, once for the source's guard.
        self.assertEqual(params.count("opponent"), 2)

    def test_no_answer_writes_no_source(self):
        sql, params = self.insert(None)
        self.assertEqual(sql.count("%s"), len(params))
        self.assertNotIn("user", [p for p in params if isinstance(p, str)])

    def test_every_placeholder_has_an_argument(self):
        for answer in ("user", "opponent", None):
            with self.subTest(answer=answer):
                sql, params = self.insert(answer)
                self.assertEqual(sql.count("%s"), len(params))

    def test_filling_an_existing_row_only_backfills(self):
        conn = RecordingConnection()
        create_match(conn, MATCH_ID, USER_ID, JOB_ID, "r2://cut.mp4",
                     first_server="user", existing=True)
        sql, params = statement(conn, "update public.matches")
        # coalesce, not assignment: register_upload may already have
        # written the answer, and the owner may have corrected it since.
        self.assertIn("first_server = coalesce(first_server, %s)", sql)
        self.assertIn(
            "first_server_source = case "
            "when first_server is null and %s is not null then 'user' "
            "else first_server_source end",
            sql,
        )
        self.assertEqual(sql.count("%s"), len(params))


class ImportRowTests(unittest.TestCase):
    def row(self, meta):
        conn = RecordingConnection()
        create_uploaded_match(
            conn, USER_ID, JOB_ID, "r2://raw.mp4", 600.0, "clip.mp4",
            None, meta)
        return statement(conn, "insert into public.matches")

    def test_the_import_row_carries_the_answer(self):
        sql, params = self.row({"first_server": "user"})
        self.assertIn("first_server, first_server_source", sql)
        self.assertEqual(sql.count("%s"), len(params))
        self.assertEqual(params.count("user"), 2)

    def test_an_unanswered_import_stays_null(self):
        sql, params = self.row({"opponent_name": "Chris"})
        self.assertEqual(sql.count("%s"), len(params))
        self.assertNotIn("user", [p for p in params if isinstance(p, str)])


if __name__ == "__main__":
    unittest.main()
