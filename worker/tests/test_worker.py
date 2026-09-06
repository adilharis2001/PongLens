import worker


def test_automatic_highlights_switch_supports_one_user_canary():
    assert worker.automatic_highlights_enabled("on", "user-a") is True
    assert worker.automatic_highlights_enabled("user:user-a", "user-a") is True
    assert worker.automatic_highlights_enabled("off", "user-a") is False
    assert worker.automatic_highlights_enabled("user:user-b", "user-a") is False
    assert worker.automatic_highlights_enabled(None, "user-a") is False


class Cursor:
    def __init__(self, connection):
        self.connection = connection
        self.row = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.connection.calls.append((normalized, params))
        self.row = (self.connection.old_key,) if normalized.startswith(
            "select r2_key from public.match_reels"
        ) and self.connection.old_key else None

    def fetchone(self):
        return self.row


class Connection:
    def __init__(self, old_key=None):
        self.calls = []
        self.old_key = old_key

    def cursor(self):
        return Cursor(self)


def strong_point():
    return {
        "id": "p1",
        "idx": 1,
        "t0": 10.0,
        "t1": 20.0,
        "cut_t0": 4.0,
        "rally_end_cut_s": 12.0,
        "clip_path": "r2://media/points/p1.mp4",
        "deleted": False,
        "edited": False,
        "is_let": False,
        "highlight_evidence": {
            "v": 1,
            "status": "ready",
            "n_hits": 7,
            "connected_crossings": 6,
            "table_bounces": 3,
            "observed_end_s": 18.0,
        },
    }


def statuses(conn):
    return [
        params[2]
        for query, params in conn.calls
        if query.startswith("insert into public.match_reels")
    ]


def test_disabled_stage_does_not_touch_reel_state(tmp_path):
    conn = Connection()
    result = worker.prepare_auto_highlights(
        conn, "user", "match", [strong_point()], "cut.mp4", str(tmp_path),
        enabled=False,
    )
    assert result == "off"
    assert conn.calls == []


def test_no_qualified_points_record_empty_without_rendering(tmp_path, monkeypatch):
    conn = Connection()
    weak = strong_point()
    weak["highlight_evidence"]["n_hits"] = 2
    monkeypatch.setattr(
        worker, "render_auto_highlights",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("rendered")),
    )
    result = worker.prepare_auto_highlights(
        conn, "user", "match", [weak], "cut.mp4", str(tmp_path), enabled=True
    )
    assert result == "empty"
    assert statuses(conn) == ["empty"]


def test_render_failure_is_recorded_and_does_not_raise(tmp_path, monkeypatch):
    conn = Connection()
    monkeypatch.setattr(
        worker, "render_auto_highlights",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("encode broke")),
    )
    result = worker.prepare_auto_highlights(
        conn, "user", "match", [strong_point()], "cut.mp4", str(tmp_path),
        enabled=True,
    )
    assert result == "failed"
    assert statuses(conn) == ["rendering", "failed"]
    assert any("encode broke" in str(params) for _, params in conn.calls)


def test_success_uses_revision_key_and_records_ready(tmp_path, monkeypatch):
    conn = Connection(old_key="reels/match-highlights-old.mp4")
    output = tmp_path / "automatic-highlights.mp4"
    output.write_bytes(b"video")
    uploads = []

    class R2:
        def upload_file(self, path, bucket, key, ExtraArgs=None):
            uploads.append((path, bucket, key, ExtraArgs))

        def delete_object(self, **kwargs):
            uploads.append(("delete", kwargs["Bucket"], kwargs["Key"], None))

    monkeypatch.setattr(worker, "r2", lambda: R2())
    monkeypatch.setattr(
        worker, "render_auto_highlights",
        lambda manifest, *_args: (str(output), {**manifest, "duration_s": 8.75}),
    )
    monkeypatch.setattr(worker, "ledger_append", lambda *args: None)
    monkeypatch.setattr(worker, "ledger_negate_keys", lambda *args: None)

    result = worker.prepare_auto_highlights(
        conn, "user", "match", [strong_point()], "cut.mp4", str(tmp_path),
        enabled=True,
    )

    assert result == "ready"
    assert statuses(conn) == ["rendering", "ready"]
    uploaded_key = uploads[0][2]
    assert uploaded_key.startswith("reels/match-highlights-")
    assert uploaded_key.endswith(".mp4")
    assert ("delete", worker.R2_MEDIA_BUCKET,
            "reels/match-highlights-old.mp4", None) in uploads
