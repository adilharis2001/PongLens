from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

# Import the daemon without consulting the user's Keychain or a live service.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1/test")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
os.environ.setdefault("SUPABASE_URL", "https://example.invalid")

import worker


RESULT = {
    "schema": 1,
    "status": "stable",
    "reason_code": "dominant_static_background",
    "sample_count": 12,
    "sample_timestamps_s": [],
    "window_start_s": 200.0,
    "window_end_s": 300.0,
    "changes": [],
    "evidence": [],
}


def _frames(workdir: Path, indices=range(12)) -> list[str]:
    folder = workdir / "content_check"
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for index in indices:
        path = folder / f"frame{index:02d}.jpg"
        path.write_bytes(b"jpeg")
        paths.append(str(path))
    return paths


def _fake_cli(monkeypatch, captured, result=None):
    output = dict(result or RESULT)

    def run(command, **kwargs):
        captured["command"] = command
        captured["timeout"] = kwargs.get("timeout")
        input_path = Path(command[command.index("--samples-json") + 1])
        out_path = Path(command[command.index("--out") + 1])
        captured["input"] = json.loads(input_path.read_text())
        rendered = dict(output)
        rendered["sample_timestamps_s"] = [x[0] for x in captured["input"]["samples"]]
        out_path.write_text(json.dumps(rendered))
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(worker.subprocess, "run", run)


def test_run_camera_view_check_reuses_cached_content_frames_and_preserves_offsets(
        tmp_path: Path, monkeypatch):
    # Eight cached frames are enough; their filename indices, rather than
    # enumeration order, determine their original-video timestamps.
    cached = _frames(tmp_path, [0, 1, 2, 4, 6, 8, 10, 11])
    monkeypatch.setattr(worker, "_video_duration_s", lambda _video, **_kwargs: 100.0)
    monkeypatch.setattr(
        worker, "_sample_frames",
        lambda *_args, **_kwargs: pytest.fail("cached content frames were re-extracted"),
    )
    captured = {}
    _fake_cli(monkeypatch, captured)
    queued = []
    monkeypatch.setattr(worker, "_queue_camera_check",
                        lambda *args: queued.append(args), raising=False)

    result = worker.run_camera_view_check(
        object(), "match-a", "job-a", "/local/raw.mov", str(tmp_path), offset_s=200.0)

    assert result["status"] == "stable"
    assert captured["timeout"] == pytest.approx(20.0, abs=0.1)
    assert captured["command"][0] == worker.VENV_PY
    assert captured["command"][1].endswith("/camera_view_check.py")
    assert captured["input"]["window_start_s"] == 200.0
    assert captured["input"]["window_end_s"] == 300.0
    assert [sample[1] for sample in captured["input"]["samples"]] == cached
    expected = [203.0 + 94.0 * index / 11 for index in [0, 1, 2, 4, 6, 8, 10, 11]]
    assert [sample[0] for sample in captured["input"]["samples"]] == pytest.approx(expected)
    assert queued == [("match-a", "job-a", 200.0, 300.0, result)]


def test_run_camera_view_check_extracts_when_content_gate_left_too_few_frames(
        tmp_path: Path, monkeypatch):
    _frames(tmp_path, range(7))
    extracted_dir = tmp_path / "fallback"
    extracted_dir.mkdir()
    extracted = []
    for index in range(12):
        path = extracted_dir / f"frame{index:02d}.jpg"
        path.write_bytes(b"jpeg")
        extracted.append(str(path))
    calls = []
    monkeypatch.setattr(worker, "_video_duration_s", lambda _video, **_kwargs: 80.0)

    def sample(video, workdir, *, duration_s, total_timeout_s):
        calls.append((video, workdir, duration_s, total_timeout_s))
        return extracted

    monkeypatch.setattr(worker, "_sample_frames", sample)
    captured = {}
    _fake_cli(monkeypatch, captured)
    monkeypatch.setattr(worker, "_queue_camera_check", lambda *_args: None,
                        raising=False)

    result = worker.run_camera_view_check(
        object(), "match-b", "job-b", "/local/raw.mov", str(tmp_path))

    assert result["status"] == "stable"
    assert calls == [("/local/raw.mov", str(tmp_path), 80.0, 8.0)]
    assert len(captured["input"]["samples"]) == 12


def test_sample_frames_stops_after_bounded_fallback_timeout(
        tmp_path: Path, monkeypatch):
    """A stuck advisory extraction cannot inherit the gate's 120s/frame cap."""
    monkeypatch.setattr(
        worker, "_video_duration_s",
        lambda _video: pytest.fail("known duration was probed again"),
    )
    seen_timeouts = []

    def stuck(_command, **kwargs):
        seen_timeouts.append(kwargs["timeout"])
        raise subprocess.TimeoutExpired("ffmpeg", kwargs["timeout"])

    monkeypatch.setattr(worker.subprocess, "run", stuck)

    frames = worker._sample_frames(
        "/local/raw.mov",
        str(tmp_path),
        duration_s=100.0,
        total_timeout_s=8.0,
    )

    assert frames == []
    assert len(seen_timeouts) == 1
    assert 0 < seen_timeouts[0] <= 8.0


def test_run_camera_view_check_shares_one_twenty_second_deadline(
        tmp_path: Path, monkeypatch):
    _frames(tmp_path, [])
    fallback = tmp_path / "fallback"
    fallback.mkdir()
    extracted = []
    for index in range(12):
        path = fallback / f"frame{index:02d}.jpg"
        path.write_bytes(b"jpeg")
        extracted.append(str(path))
    clock = [100.0]
    duration_timeouts = []
    extraction_budgets = []

    monkeypatch.setattr(worker.time, "monotonic", lambda: clock[0])

    def duration(_video, *, timeout_s):
        duration_timeouts.append(timeout_s)
        clock[0] += 5.0
        return 80.0

    def sample(_video, _workdir, *, duration_s, total_timeout_s):
        assert duration_s == 80.0
        extraction_budgets.append(total_timeout_s)
        clock[0] += 8.0
        return extracted

    monkeypatch.setattr(worker, "_video_duration_s", duration)
    monkeypatch.setattr(worker, "_sample_frames", sample)
    captured = {}
    _fake_cli(monkeypatch, captured)
    monkeypatch.setattr(worker, "_queue_camera_check", lambda *_args: None,
                        raising=False)

    result = worker.run_camera_view_check(
        object(), "match-budget", "job-budget", "/local/raw.mov", str(tmp_path))

    assert result["status"] == "stable"
    assert duration_timeouts == [20.0]
    assert extraction_budgets == [8.0]
    assert captured["timeout"] == pytest.approx(7.0)


def test_run_camera_view_check_timeout_is_fail_open_and_not_recorded(
        tmp_path: Path, monkeypatch):
    _frames(tmp_path)
    monkeypatch.setattr(worker, "_video_duration_s", lambda _video, **_kwargs: 100.0)

    def timeout(*_args, **_kwargs):
        raise subprocess.TimeoutExpired("camera-view", 20)

    monkeypatch.setattr(worker.subprocess, "run", timeout)
    queued = []
    monkeypatch.setattr(worker, "_queue_camera_check",
                        lambda *args: queued.append(args), raising=False)

    result = worker.run_camera_view_check(
        object(), "match-c", "job-c", "/local/raw.mov", str(tmp_path))

    assert result is None
    assert queued == []


def test_camera_view_record_failure_never_fails_the_match(tmp_path: Path, monkeypatch):
    _frames(tmp_path)
    monkeypatch.setattr(worker, "_video_duration_s", lambda _video, **_kwargs: 100.0)
    captured = {}
    _fake_cli(monkeypatch, captured)

    def unavailable(*_args):
        raise OSError("private database address")

    monkeypatch.setattr(worker, "_queue_camera_check", unavailable, raising=False)

    result = worker.run_camera_view_check(
        object(), "match-d", "job-d", "/local/raw.mov", str(tmp_path))

    assert result["status"] == "stable"
