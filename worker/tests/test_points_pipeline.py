import json

import worker


class Cursor:
    def __init__(self):
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params=None):
        self.calls.append((" ".join(query.split()), params))


class Connection:
    def __init__(self):
        self.value = Cursor()

    def cursor(self):
        return self.value


def test_insert_points_persists_and_returns_highlight_evidence():
    evidence = {
        "v": 1,
        "status": "ready",
        "n_hits": 6,
        "connected_crossings": 5,
        "table_bounces": 3,
        "observed_end_s": 18.0,
        "reasons": [],
    }
    point = {
        "idx": 1,
        "t0": 10.0,
        "t1": 20.0,
        "cut_t0": 4.0,
        "rally_end_cut_s": 11.5,
        "clip": "01.mp4",
        "server": None,
        "placement": None,
        "suggestion": None,
        "highlight_evidence": evidence,
    }
    conn = Connection()

    inserted = worker.insert_points(conn, "match", [point], "r2://media/points")

    query, params = conn.value.calls[0]
    assert "highlight_evidence" in query
    assert json.loads(params[-1]) == evidence
    assert inserted[1]["highlight_evidence"] == evidence
    assert inserted[1]["clip_path"] == "r2://media/points/01.mp4"
    assert inserted[1]["rally_end_cut_s"] == 11.5
