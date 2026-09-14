"""Run the real child-command builder without credentials or external services."""
import ast
from contextlib import nullcontext
import logging
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


@pytest.fixture
def command_builder():
    source = Path(__file__).resolve().parents[1] / "worker.py"
    tree = ast.parse(source.read_text())
    module = ast.Module(body=[
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "run_points_subprocess"
    ], type_ignores=[])
    subprocess_run = Mock()
    scope = dict(
        os=os, log=logging.getLogger(__name__),
        VENV_PY="python", POINTS_PIPELINE="points_pipeline.py",
        SERVE_SURFACE_PAD_DEFAULT="0.15", SERVE_MERGE_S_DEFAULT="1.5",
        VALID_STRICTNESS=("normal",),
        COST_METER=SimpleNamespace(timed_stage=lambda *args: nullcontext()),
        subprocess=SimpleNamespace(run=subprocess_run),
        points_child_env=lambda workdir: ({}, "unused-usage.json"),
        record_vision_usage_sidecar=Mock(),
    )
    exec(compile(module, str(source), "exec"), scope)
    return scope["run_points_subprocess"], subprocess_run


@pytest.mark.parametrize("option", [None, False, True, "true", 1],
                         ids=["absent", "false", "true", "string", "integer"])
@pytest.mark.parametrize("pipeline,players,rally_end", [
    ("bodies", "players.json", True),
    ("bodies", "players.json", False),
    ("bodies", None, True),
    ("v2", None, True),
], ids=["supported", "end-rule-off", "players-missing", "ball-pipeline"])
def test_reviewed_splits_require_literal_true_and_supported_body_pass(
        command_builder, tmp_path, option, pipeline, players, rally_end):
    build, run = command_builder
    options = {} if option is None else {"reviewed_net_splits": option}
    build("input.mp4", "ball.json", str(tmp_path), options,
          pipeline=pipeline, players_json=players, rally_end=rally_end)
    run.assert_called_once()
    command = run.call_args.args[0]
    expected = option is True and pipeline == "bodies" and players is not None and rally_end
    assert ("--reviewed-net-splits" in command) == expected
    if expected:
        assert command[command.index("--pipeline") + 1] == "bodies"
        assert "--rally-end" in command
        assert command[command.index("--players") + 1] == players


@pytest.mark.parametrize('option', [None, False, True, 'true', 1])
@pytest.mark.parametrize('anchor,end,pipeline,players', [
    (True,True,'bodies','players.json'), (False,True,'bodies','players.json'),
    (True,False,'bodies','players.json'), (True,True,'v2',None),
    (True,True,'bodies',None)])
def test_combined_cuts_require_literal_opt_in_and_both_edges(
        command_builder,tmp_path,option,anchor,end,pipeline,players):
    build,run=command_builder
    build('input.mp4','ball.json',str(tmp_path),{'combined_cuts':option},
          pipeline=pipeline,players_json=players,serve_anchor=anchor,rally_end=end)
    expected=option is True and anchor and end and pipeline=='bodies' and players is not None
    assert ('--combined-cuts' in run.call_args.args[0])==expected
