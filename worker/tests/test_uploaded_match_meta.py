"""A YouTube import's answers belong on the row it creates.

The import form collects opponent, venue, type and which end the player
was at into jobs.options.meta. When the library row was created without
them, the match page asked for the side a second time and the typed
opponent and venue were simply lost.
"""
import unittest

import worker.worker as worker


class CapturingCursor:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.connection.calls.append((normalized, params))

    def fetchone(self):
        return ("11111111-2222-3333-4444-555555555555",)


class CapturingConnection:
    def __init__(self):
        self.calls = []

    def cursor(self):
        return CapturingCursor(self)


META = {
    "opponent_name": "Daniel Feng",
    "venue": "LYTTC",
    "match_type": "tournament",
    "user_side": "far",
}


def insert_params(conn):
    for query, params in conn.calls:
        if query.startswith("insert into public.matches"):
            return query, params
    raise AssertionError("no insert ran")


class UploadedMatchMetaTests(unittest.TestCase):
    def test_the_forms_answers_are_written(self):
        conn = CapturingConnection()
        worker.create_uploaded_match(
            conn, "user-1", "job-1", "r2://ponglens-raw/user-1/a.mp4",
            512.0, "Adil vs Daniel Feng", None, META)
        query, params = insert_params(conn)
        for column in ("opponent_name", "venue", "match_type", "user_side"):
            self.assertIn(column, query)
        for value in ("Daniel Feng", "LYTTC", "tournament", "far"):
            self.assertIn(value, params)

    def test_invalid_answers_are_dropped(self):
        conn = CapturingConnection()
        worker.create_uploaded_match(
            conn, "user-1", "job-1", "r2://ponglens-raw/user-1/a.mp4",
            60.0, "t", None,
            {"user_side": "sideways", "match_type": "nonsense",
             "opponent_name": "   "})
        _, params = insert_params(conn)
        for bad in ("sideways", "nonsense"):
            self.assertNotIn(bad, params)

    def test_no_meta_is_not_an_error(self):
        for meta in (None, {}, "not a dict"):
            conn = CapturingConnection()
            worker.create_uploaded_match(
                conn, "user-1", "job-1", "r2://ponglens-raw/user-1/a.mp4",
                60.0, "t", None, meta)
            self.assertTrue(insert_params(conn))


if __name__ == "__main__":
    unittest.main()
