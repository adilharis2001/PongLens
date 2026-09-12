"""Contract tests for fail-open, privacy-safe match processing telemetry.

These tests intentionally precede ``worker/upload_feedback.py``.  They should
stay red until that module implements the contract exercised here.
"""

from datetime import datetime
import json
import math

import pytest


FIXED_TIME = "2026-09-12T16:05:04+00:00"


def telemetry(sent, **overrides):
    try:
        from upload_feedback import ProcessingTelemetry
    except ModuleNotFoundError:
        pytest.fail("worker/upload_feedback.py is missing")

    values = {
        "job_id": "11111111-1111-4111-8111-111111111111",
        "attempt": 2,
        "lane": "main",
        "release_id": "release-a",
        "send": sent.append,
        "clock": lambda: FIXED_TIME,
    }
    values.update(overrides)
    return ProcessingTelemetry(**values)


def test_emit_sends_the_attempt_envelope_with_a_stable_attempt_key():
    sent = []

    telemetry(sent).emit("claimed")

    assert sent == [{
        "attempt_key": "11111111-1111-4111-8111-111111111111:2",
        "job_id": "11111111-1111-4111-8111-111111111111",
        "attempt": 2,
        "lane": "main",
        "release_id": "release-a",
        "event": "claimed",
        "recorded_at": FIXED_TIME,
        "details": {},
    }]


@pytest.mark.parametrize(
    "event",
    ["claimed", "profile", "stage", "progress", "ready", "released", "failed"],
)
def test_each_documented_event_is_recorded(event):
    sent = []

    telemetry(sent).emit(event)

    assert [record["event"] for record in sent] == [event]


def test_unknown_event_is_ignored_without_raising():
    sent = []

    telemetry(sent).emit("private_new_event", stage="ball")

    assert sent == []


def test_emit_keeps_only_bounded_safe_details():
    sent = []
    private = "https://private.example/video?token=secret"

    telemetry(sent).emit(
        "stage",
        stage="b" * 80,
        progress=42,
        duration_s=600.5,
        fps=59.94,
        width=3840,
        height=2160,
        route="bodies:points-placement",
        trim_start_s=1200,
        reason_code="r" * 80,
        raw_path="/Users/player/private.mp4",
        input_url=private,
        error=RuntimeError(private),
        exception_message=private,
        access_token="secret",
    )

    assert sent[0]["details"] == {
        "stage": "b" * 60,
        "progress": 42,
        "duration_s": 600.5,
        "fps": 59.94,
        "width": 3840,
        "height": 2160,
        "route": "bodies:points-placement",
        "trim_start_s": 1200,
        "reason_code": "r" * 60,
    }
    encoded = json.dumps(sent[0])
    assert "private.example" not in encoded
    assert "/Users/player" not in encoded
    assert "secret" not in encoded


@pytest.mark.parametrize("progress", [-1, 101, math.nan, math.inf, "42"])
def test_invalid_progress_is_dropped_but_the_event_is_still_recorded(progress):
    sent = []

    telemetry(sent).emit("progress", stage="ball", progress=progress)

    assert sent[0]["details"] == {"stage": "ball"}


def test_profile_records_verified_shape_and_allows_absolute_trim_past_duration():
    sent = []

    telemetry(sent).profile(
        duration_s=600,
        fps=60,
        width=3840,
        height=2160,
        route="bodies:points-placement",
        trim_start_s=1200,
    )

    assert sent == [{
        "attempt_key": "11111111-1111-4111-8111-111111111111:2",
        "job_id": "11111111-1111-4111-8111-111111111111",
        "attempt": 2,
        "lane": "main",
        "release_id": "release-a",
        "event": "profile",
        "recorded_at": FIXED_TIME,
        "details": {
            "duration_s": 600,
            "fps": 60,
            "width": 3840,
            "height": 2160,
            "route": "bodies:points-placement",
            "trim_start_s": 1200,
        },
    }]


@pytest.mark.parametrize(
    "overrides",
    [
        {"duration_s": 0},
        {"duration_s": math.nan},
        {"duration_s": math.inf},
        {"fps": 0},
        {"fps": math.nan},
        {"width": 0},
        {"width": 1920.5},
        {"height": -1},
        {"trim_start_s": -0.1},
        {"trim_start_s": math.inf},
        {"trim_start_s": 86401},
        {"route": ""},
        {"route": "bodies/../../private"},
        {"route": "r" * 121},
    ],
)
def test_invalid_profile_is_ignored_without_raising(overrides):
    sent = []
    values = {
        "duration_s": 600,
        "fps": 30,
        "width": 1920,
        "height": 1080,
        "route": "bodies:points",
        "trim_start_s": 0,
    }
    values.update(overrides)

    telemetry(sent).profile(**values)

    assert sent == []


def test_sender_failure_never_fails_the_processing_call():
    def unavailable(_record):
        raise OSError("private database address")

    telemetry([], send=unavailable).emit("ready", stage="publish")


def test_clock_failure_is_also_fail_open():
    def unavailable_clock():
        raise RuntimeError("clock unavailable")

    sent = []

    telemetry(sent, clock=unavailable_clock).emit("claimed")

    assert sent == []


def test_default_clock_is_an_aware_utc_iso_timestamp():
    sent = []
    try:
        from upload_feedback import ProcessingTelemetry
    except ModuleNotFoundError:
        pytest.fail("worker/upload_feedback.py is missing")

    ProcessingTelemetry(
        job_id="11111111-1111-4111-8111-111111111111",
        attempt=1,
        lane="fast",
        release_id=None,
        send=sent.append,
    ).emit("claimed")

    stamp = datetime.fromisoformat(sent[0]["recorded_at"])
    assert stamp.utcoffset() is not None
    assert stamp.utcoffset().total_seconds() == 0

