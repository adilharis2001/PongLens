"""Worker integration contract for non-blocking processing measurements."""

import json
import re
from contextlib import nullcontext
from pathlib import Path

import pytest

import worker


JOB = "11111111-1111-4111-8111-111111111111"


class Cursor:
    def __init__(self, claimed=True):
        self.claimed = claimed
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, params=None):
        self.calls.append((" ".join(query.split()), params))

    def fetchone(self):
        return (JOB,) if self.claimed else None


class Connection:
    def __init__(self, claimed=True):
        self.cursor_value = Cursor(claimed)

    def cursor(self, **_kwargs):
        return self.cursor_value


def message(kind="deadspace_cut"):
    return {
        "msg_id": 91,
        "read_ct": 2,
        "message": {
            "job_id": JOB,
            "user_id": "22222222-2222-4222-8222-222222222222",
            "kind": kind,
            "input_path": "fixture.mp4",
            "options": {},
        },
    }


def queued_records():
    return [record for kind, record in worker._feedback_pending if kind == "event"]


def clear_records():
    worker._feedback_pending.clear()
    worker._feedback_telemetry = None


def test_decorator_preserves_identity_and_orders_ready_before_post_ready_release():
    clear_records()
    observed = []

    @worker._record_processing
    def measured(conn, msg):
        worker._feedback_telemetry.emit("claimed")
        worker._feedback_telemetry.profile(600, 30, 1920, 1080, "bodies:points")
        worker.pulse_stage("ball")
        worker.update_job(conn, JOB, progress=42)
        worker.update_job(conn, JOB, status="done", progress=100)
        # The match publication boundary owns READY; a generic job update
        # cannot know whether its output is a reviewable match.
        worker._feedback_telemetry.emit("ready")
        observed.append("post_ready_work")
        assert [record["event"] for record in queued_records()][-1] == "ready"
        return "finished"

    assert measured.__name__ == "measured"
    assert measured(Connection(), message()) == "finished"
    assert observed == ["post_ready_work"]
    assert [record["event"] for record in queued_records()] == [
        "claimed", "profile", "stage", "progress", "progress", "ready", "released",
    ]
    assert queued_records()[3]["details"] == {"progress": 42, "stage": "ball"}
    assert queued_records()[4]["details"] == {"progress": 100, "stage": "ball"}
    assert queued_records()[5]["details"] == {}


def test_exception_records_failure_and_release_then_reraises_the_original_error():
    clear_records()

    @worker._record_processing
    def measured(_conn, _msg):
        worker._feedback_telemetry.emit("claimed")
        raise RuntimeError("/private/player/video.mp4?token=secret")

    with pytest.raises(RuntimeError, match="private/player"):
        measured(Connection(), message())

    assert [record["event"] for record in queued_records()] == [
        "claimed", "failed", "released",
    ]
    encoded = json.dumps(queued_records())
    assert "/private/player" not in encoded and "token" not in encoded
    reason = queued_records()[1]["details"].get("reason_code", "")
    assert re.fullmatch(r"[A-Za-z0-9_:-]{1,60}", reason)


def test_telemetry_queue_failure_cannot_replace_the_job_exception(monkeypatch):
    clear_records()
    monkeypatch.setattr(
        worker,
        "_queue_feedback_event",
        lambda _record: (_ for _ in ()).throw(OSError("database offline")),
    )

    @worker._record_processing
    def measured(_conn, _msg):
        worker._feedback_telemetry.emit("claimed")
        raise LookupError("the real processing failure")

    with pytest.raises(LookupError, match="real processing failure"):
        measured(Connection(), message())


def test_cancelled_queue_delivery_has_release_without_a_false_claim(monkeypatch):
    clear_records()
    archived = []
    monkeypatch.setattr(
        worker,
        "archive_ordinary_delivery",
        lambda _conn, msg: archived.append(msg["msg_id"]),
    )

    worker.process_job(Connection(claimed=False), message())

    assert archived == [91]
    assert [record["event"] for record in queued_records()] == ["released"]


def test_content_check_completion_does_not_claim_the_match_is_reviewable():
    clear_records()

    @worker._record_processing
    def check_only(conn, _msg):
        worker._feedback_telemetry.emit("claimed", route="content_check")
        worker.update_job(conn, JOB, status="done", progress=100)

    check_only(Connection(), message("content_check"))

    assert [record["event"] for record in queued_records()] == [
        "claimed", "progress", "released",
    ]


def test_enqueue_is_memory_only_and_the_newest_measurements_survive_pressure(monkeypatch):
    clear_records()
    monkeypatch.setattr(
        worker.psycopg2,
        "connect",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("enqueue attempted database I/O")
        ),
    )

    limit = worker._feedback_pending.maxlen
    for index in range(limit + 5):
        worker._queue_feedback_event({"event": "progress", "details": {"progress": index}})

    assert len(queued_records()) == limit
    assert queued_records()[-1]["details"]["progress"] == limit + 4


def test_flush_uses_one_bounded_connection_and_at_most_one_statement_per_kind(monkeypatch):
    clear_records()
    worker._queue_feedback_event({"event": "claimed", "details": {}})
    worker._queue_feedback_event({"event": "stage", "details": {"stage": "ball"}})
    worker._queue_camera_check("match-1", JOB, 0, 30, {"status": "stable"})
    worker._queue_camera_check("match-2", JOB, 30, 60, {"status": "changed"})
    calls = []

    class FlushCursor:
        def __enter__(self): return self
        def __exit__(self, *_args): return False
        def execute(self, query, params=None): calls.append((" ".join(query.split()), params))

    class FlushConnection:
        def cursor(self): return FlushCursor()
        def commit(self): calls.append(("commit", None))
        def close(self): calls.append(("close", None))

    def connect(*args, **kwargs):
        calls.append(("connect", (args, kwargs)))
        return FlushConnection()

    monkeypatch.setattr(worker.psycopg2, "connect", connect)

    worker._flush_feedback()

    connect_kwargs = calls[0][1][1]
    assert connect_kwargs["connect_timeout"] == 2
    assert "statement_timeout=2000" in connect_kwargs["options"]
    statements = [call for call in calls if call[0].startswith("select public.record_")]
    assert len(statements) == 2, "events and camera checks each need one bounded batch statement"
    assert list(worker._feedback_pending) == []


def test_failed_flush_keeps_the_batch_for_a_later_pulse(monkeypatch):
    clear_records()
    worker._queue_feedback_event({"event": "claimed", "details": {}})
    before = list(worker._feedback_pending)

    class BrokenCursor:
        def __enter__(self): return self
        def __exit__(self, *_args): return False
        def execute(self, *_args, **_kwargs): raise OSError("database offline")

    class BrokenConnection:
        def cursor(self): return BrokenCursor()
        def close(self): pass

    monkeypatch.setattr(worker.psycopg2, "connect", lambda *_args, **_kwargs: BrokenConnection())

    worker._flush_feedback()

    assert list(worker._feedback_pending) == before


def test_video_profile_uses_verified_effective_media_shape_without_its_path(monkeypatch):
    clear_records()
    worker._feedback_telemetry = worker.ProcessingTelemetry(
        JOB, 1, "main", "release-a", worker._queue_feedback_event,
        clock=lambda: "2026-09-12T16:00:00+00:00",
    )
    monkeypatch.setattr(worker, "_ffprobe_streams", lambda _path: {
        "format": {"duration": "600.25"},
        "streams": [
            {"codec_type": "audio"},
            {
                "codec_type": "video",
                "avg_frame_rate": "60000/1001",
                "width": 3840,
                "height": 2160,
            },
        ],
    })

    worker._record_video_profile(
        "/private/player/source.mp4", "bodies:no-placement", 1200,
    )

    assert len(queued_records()) == 1
    details = queued_records()[0]["details"]
    assert details == {
        "duration_s": 600.25,
        "fps": 60000 / 1001,
        "width": 3840,
        "height": 2160,
        "route": "bodies:no-placement",
        "trim_start_s": 1200,
    }
    assert "/private/player" not in json.dumps(queued_records())


def test_ordinary_legacy_workflow_profiles_the_applied_trim_offset(
        tmp_path: Path, monkeypatch):
    destination = worker.MatchProcessingDestination.active(
        "job-ordinary", "user-ordinary", "r2://raw/source.mp4",
        {"match_id": "match-ordinary", "points": False},
    )
    cut = tmp_path / "cut.mp4"
    cut.write_bytes(b"cut")
    profiles = []

    monkeypatch.setattr(
        worker, "_record_video_profile",
        lambda video, route, offset: profiles.append((video, route, offset)),
    )
    monkeypatch.setattr(worker, "run_pipeline", lambda *_args, **_kwargs: (str(cut), "ball"))
    monkeypatch.setattr(worker, "locked_ordinary_match_attempt", lambda *_args, **_kwargs: nullcontext())
    monkeypatch.setattr(worker, "update_job", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(worker, "pulse_stage", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(worker, "ledger_append", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        worker, "r2",
        lambda: type("R2", (), {"upload_file": lambda *_args, **_kwargs: None})(),
    )

    result_path, points_match_id = worker.run_match_processing_workflow(
        object(), destination, "/work/actually-trimmed.mp4", str(tmp_path),
        attempt_key="job-ordinary:1", profile_offset_s=120.0,
    )

    assert profiles == [("/work/actually-trimmed.mp4", "legacy_spans", 120.0)]
    assert result_path.endswith("/user-ordinary/job-ordinary.mp4")
    assert points_match_id is None


@pytest.mark.parametrize(
    "probe",
    [
        {"format": {"duration": "NaN"}, "streams": []},
        {"format": {"duration": "600"}, "streams": [
            {"codec_type": "video", "avg_frame_rate": "0/0", "width": 1920, "height": 1080},
        ]},
        {"format": {"duration": "600"}, "streams": [
            {"codec_type": "video", "avg_frame_rate": "30/1", "width": 0, "height": 1080},
        ]},
    ],
)
def test_malformed_video_profile_is_fail_open_and_records_nothing(monkeypatch, probe):
    clear_records()
    worker._feedback_telemetry = worker.ProcessingTelemetry(
        JOB, 1, "main", "release-a", worker._queue_feedback_event,
    )
    monkeypatch.setattr(worker, "_ffprobe_streams", lambda _path: probe)

    worker._record_video_profile("/private/player/source.mp4", "bodies:no-placement")

    assert queued_records() == []
