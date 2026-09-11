"""Exercise the real queue boundary without importing credentials or claiming work."""
import ast
import logging
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest


def boundary_scope():
    source = Path(__file__).parents[1] / "worker.py"
    tree = ast.parse(source.read_text())
    scope = {"os": os, "log": logging.getLogger("test")}
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    loop = next(n for n in main.body if isinstance(n, ast.While))
    boundary = []
    for node in loop.body[0].body:
        if isinstance(node, ast.If) and "housekeeping" in ast.unparse(node.test):
            break
        boundary.append(node)
    # One actual loop iteration; reaching housekeeping ends this isolated check.
    check = ast.While(test=ast.Constant(True), body=[*boundary, ast.Break()], orelse=[])
    program = ast.fix_missing_locations(ast.Module(body=[check], type_ignores=[]))
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
