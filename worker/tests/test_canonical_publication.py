import inspect

import pytest

import worker


class Cursor:
    def __init__(self, row=None):
        self.row = row
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params=None):
        self.calls.append((" ".join(query.split()), params))

    def fetchone(self):
        return self.row


class Connection:
    def __init__(self, row=None, *, autocommit=True):
        self.value = Cursor(row)
        self.autocommit = autocommit
        self.closed = False
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return self.value

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def receipt(**overrides):
    value = {
        "ok": True,
        "contractVersion": 1,
        "matchId": "match-a",
        "jobId": "job-a",
        "processingVersionId": "version-a",
        "pointCount": 2,
        "observationCount": 4,
        "missingClipCount": 0,
        "scoreRevision": 2,
        "scoreProjectionStatus": "current",
    }
    value.update(overrides)
    return value


def test_hand_cut_finalizer_returns_a_checked_publication_receipt():
    conn = Connection((receipt(),))

    got = worker.finalize_canonical_publication(
        conn, "publish_hand_cut_v2", "match-a", "job-a"
    )

    assert got == receipt()
    query, params = conn.value.calls[0]
    assert query == "select public.publish_hand_cut_v2(%s,%s)"
    assert params == ("match-a", "job-a")


def test_automatic_finalizer_uses_the_processing_version_as_publication_id():
    expected = receipt(jobId=None)
    conn = Connection((expected,))

    got = worker.finalize_canonical_publication(
        conn, "finalize_worker_points_v2", "match-a", "version-a"
    )

    assert got == expected
    query, params = conn.value.calls[0]
    assert query == "select public.finalize_worker_points_v2(%s,%s)"
    assert params == ("match-a", "version-a")


@pytest.mark.parametrize(
    "bad",
    [
        None,
        {},
        receipt(ok=False),
        receipt(contractVersion=2),
        receipt(scoreProjectionStatus="error"),
        receipt(pointCount=-1),
    ],
)
def test_publication_receipt_refuses_missing_or_incompatible_contracts(bad):
    conn = Connection((bad,))
    with pytest.raises(RuntimeError, match="canonical publication receipt"):
        worker.finalize_canonical_publication(
            conn, "publish_hand_cut_v2", "match-a", "job-a"
        )


def test_publication_transaction_commits_once_and_restores_autocommit():
    conn = Connection()
    with worker.canonical_publication_transaction(conn):
        assert conn.autocommit is False
    assert conn.commits == 1
    assert conn.rollbacks == 0
    assert conn.autocommit is True


def test_publication_transaction_rolls_back_once_and_restores_autocommit():
    conn = Connection()
    with pytest.raises(ValueError, match="projection failed"):
        with worker.canonical_publication_transaction(conn):
            raise ValueError("projection failed")
    assert conn.commits == 0
    assert conn.rollbacks == 1
    assert conn.autocommit is True


def test_nested_publication_transaction_leaves_ownership_to_caller():
    conn = Connection(autocommit=False)
    with worker.canonical_publication_transaction(conn):
        pass
    assert conn.commits == 0
    assert conn.rollbacks == 0
    assert conn.autocommit is False


def test_active_worker_path_finalizes_before_ready_inside_publication_transaction():
    source = inspect.getsource(worker.run_points_stage)
    transaction = source.index("with canonical_publication_transaction(conn):")
    create = source.index("create_match(", transaction)
    insert = source.index("insert_points(", create)
    finalize = source.index('"finalize_worker_points_v2"', insert)
    ready = source.index("finish_match(", finalize)
    assert transaction < create < insert < finalize < ready
