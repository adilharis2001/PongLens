"""Exercise the real queue boundary without importing credentials or claiming work."""
import ast
import logging
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest


def boundary_scope(through_claim=False):
    source = Path(__file__).parents[1] / "worker.py"
    tree = ast.parse(source.read_text())
    scope = {"os": os, "log": logging.getLogger("test")}
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    loop = next(n for n in main.body if isinstance(n, ast.While))
    boundary = []
    for node in loop.body[0].body:
        if not through_claim and isinstance(node, ast.If) and "housekeeping" in ast.unparse(node.test):
            break
        boundary.append(node)
        if through_claim and isinstance(node, ast.Assign) and any(
                isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == 'read_message'
                for call in ast.walk(node)):
            break
    # One actual loop iteration; reaching housekeeping ends this isolated check.
    check = ast.While(test=ast.Constant(True), body=[*boundary, ast.Break()], orelse=[])
    helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'worker_claim_ready']
    program = ast.fix_missing_locations(ast.Module(body=[*helpers, check], type_ignores=[]))
    return scope, compile(program, str(source), "exec")


def test_pause_clears_before_next_idle_claim(monkeypatch, tmp_path):
    scope, boundary = boundary_scope()
    stage = ["drained"]
    scope.update(pulse_stage=lambda value: stage.__setitem__(0, value), POLL_SLEEP_S=5)
    monkeypatch.delenv("PONGLENS_MATCH_RELEASE", raising=False)
    monkeypatch.setenv("PONGLENS_DRAIN_FILE", str(tmp_path / "absent"))
    exec(boundary, scope)
    assert stage[0] is None


@pytest.mark.parametrize("invalid,expected", [(False, "drained"), (True, "release_invalid")])
def test_pause_blocks_boundary_until_next_poll(monkeypatch, tmp_path, invalid, expected):
    scope, boundary = boundary_scope()
    drain = tmp_path / "drain"
    drain.touch()
    monkeypatch.setenv("PONGLENS_DRAIN_FILE", str(drain))
    monkeypatch.setenv("PONGLENS_MATCH_RELEASE", "/test/release")
    def verify(_):
        if invalid:
            raise ValueError("changed")
    monkeypatch.setitem(sys.modules, "match_release", SimpleNamespace(verify_unchanged=verify))
    stage = []
    class PollEnded(Exception):
        pass
    def sleep(seconds):
        assert seconds == (30 if invalid else 5)
        raise PollEnded
    scope.update(pulse_stage=stage.append, POLL_SLEEP_S=5, time=SimpleNamespace(sleep=sleep))
    with pytest.raises(PollEnded):
        exec(boundary, scope)
    assert stage == [expected]


@pytest.mark.parametrize('phase', ['retention', 'feedback', 'qa'])
@pytest.mark.parametrize('fault', ['drain', 'integrity'])
def test_housekeeping_changes_are_checked_before_actual_claim_boundary(monkeypatch, tmp_path, phase, fault):
    scope, boundary = boundary_scope(through_claim=True)
    drain = tmp_path / 'drain'
    monkeypatch.setenv('PONGLENS_DRAIN_FILE', str(drain))
    monkeypatch.setenv('PONGLENS_MATCH_RELEASE', '/test/release')
    invalid, claims, stages = [], [], []
    def verify(_):
        if invalid:
            raise ValueError('release changed during housekeeping')
    monkeypatch.setitem(sys.modules, 'match_release', SimpleNamespace(verify_unchanged=verify))
    def housekeeping(name):
        if name == phase:
            if fault == 'drain': drain.touch()
            else: invalid.append(True)
    class PollEnded(Exception):
        pass
    def sleep(_): raise PollEnded
    scope.update(conn=object(), housekeeping=True, last_cleanup=0, last_digest_check=0,
        CLEANUP_EVERY_S=60, DIGEST_CHECK_EVERY_S=60, POLL_SLEEP_S=5,
        time=SimpleNamespace(time=lambda: 100, sleep=sleep), pulse_stage=stages.append,
        retention_sweep=lambda _: housekeeping('retention'),
        maybe_send_feedback_digest=lambda _: housekeeping('feedback'),
        maybe_send_qa_closed_digest=lambda _: housekeeping('qa'),
        read_message=lambda _: claims.append('claim'))
    with pytest.raises(PollEnded): exec(boundary, scope)
    assert claims == []
    assert stages[-1] == ('drained' if fault == 'drain' else 'release_invalid')


def test_early_drain_skips_housekeeping_and_resume_clears_pause_before_claim(monkeypatch, tmp_path):
    scope, boundary = boundary_scope(through_claim=True)
    drain = tmp_path / 'drain'
    drain.touch()
    monkeypatch.setenv('PONGLENS_DRAIN_FILE', str(drain))
    monkeypatch.delenv('PONGLENS_MATCH_RELEASE', raising=False)
    events, stages = [], []
    def sleep(_):
        assert events == []
        assert stages[-1] == 'drained'
        drain.unlink()
    def claim(_):
        assert stages[-1] is None
        events.append('claim')
    scope.update(conn=object(), housekeeping=True, last_cleanup=0, last_digest_check=0,
        CLEANUP_EVERY_S=60, DIGEST_CHECK_EVERY_S=60, POLL_SLEEP_S=5,
        time=SimpleNamespace(time=lambda: 100, sleep=sleep), pulse_stage=stages.append,
        retention_sweep=lambda _: events.append('retention'),
        maybe_send_feedback_digest=lambda _: events.append('feedback'),
        maybe_send_qa_closed_digest=lambda _: events.append('qa'), read_message=claim)
    exec(boundary, scope)
    assert events == ['retention', 'feedback', 'qa', 'claim']
