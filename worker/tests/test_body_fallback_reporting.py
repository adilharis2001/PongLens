"""Execute the real worker fallback functions without importing credentials."""
import ast
from contextlib import nullcontext
import io
import json
import logging
import os
from pathlib import Path
import shutil
from types import SimpleNamespace
import time

import pytest
from processing_outcome import ProcessingRun
import processing_outcome


def worker_functions():
    source = Path(__file__).parents[1] / 'worker.py'
    tree = ast.parse(source.read_text())
    names = {'run_body_points_pass', '_note_body_fallback', 'publish_processing_run'}
    module = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
    scope = dict(os=os, json=json, shutil=shutil, time=time, log=logging.getLogger('test'),
        processing_outcome=processing_outcome,
        RTMPOSE_PY='python', PLAYERS_SCRIPT='pose.py', RTMPOSE_MODEL='pose.onnx',
        RTMPOSE_BACKEND='onnxruntime', PLAYERS_TIMEOUT_S=60,
        COST_METER=SimpleNamespace(timed_stage=lambda *a: nullcontext()),
        players_window=lambda *a: ((0, 0, 1920, 1080), 'table'), players_device=lambda c: 'cpu',
        pulse_stage=lambda *a, **kw: None)
    exec(compile(module, str(source), 'exec'), scope)
    return scope


def first_pass(tmp_path, table=True):
    folder = tmp_path / 'points_out'
    folder.mkdir()
    match = {'pipeline': 'v2', 'points': [{'t0': 2, 't1': 5, 'cut_t0': 0}],
             'activity_gate': {'bbox': [0, 1920, 0, 1080]} if table else {}}
    (folder / 'match.json').write_text(json.dumps(match))
    return folder / 'match.json', match


@pytest.mark.parametrize('fault,reason', [('pose', 'pose_exception'), ('assembly', 'assembly_exception'), ('table', 'no_table')])
def test_fallback_keeps_real_cards_and_exposes_reason(tmp_path, fault, reason):
    scope = worker_functions()
    path, original = first_pass(tmp_path, fault != 'table')
    proc = SimpleNamespace(poll=lambda: 1 if fault == 'pose' else 0,
                           returncode=1 if fault == 'pose' else 0, stderr=io.StringIO('private path'))
    scope['subprocess'] = SimpleNamespace(Popen=lambda *a, **kw: proc, DEVNULL=-1, PIPE=-1)
    def broken(*args, **kwargs):
        path.write_text('{')  # A partial child write must not damage the kept cards.
        raise RuntimeError('private model path')
    scope['run_points_subprocess'] = broken
    scope['run_body_points_pass'](None, 'job', 'input.mp4', 'ball.json', str(tmp_path), {},
                                  points_kwargs={'pipeline': 'bodies'})
    result = json.loads(path.read_text())
    assert result['points'] == original['points']
    assert result['pipeline'] == 'v2'
    run = ProcessingRun('job:1', 'job', 'bodies', {})
    record = run.attach(path)
    assert record['reason_code'] == reason
    assert record['status'] == ('refused' if fault == 'table' else 'degraded')
    assert 'private' not in json.dumps(record)
