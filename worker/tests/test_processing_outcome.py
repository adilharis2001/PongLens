import json
import subprocess
from pathlib import Path

import pytest

import processing_outcome as outcome


def test_real_body_exception_is_degraded_but_missing_players_is_expected():
    assert outcome.failure('body', ValueError('private filename')) == {
        'status': 'error', 'reason_code': 'body_exception', 'error_kind': 'ValueError'}
    class BodyPointsUnavailable(Exception):
        pass
    assert outcome.failure('body', BodyPointsUnavailable('both players seen in only 20% of samples'))['status'] == 'refused'
    assert outcome.failure('body', BodyPointsUnavailable('feature columns differ from the frozen model'))['status'] == 'error'
    assert outcome.failure('assembly', subprocess.TimeoutExpired('private command', 30))['reason_code'] == 'assembly_timeout'


def test_final_result_uses_delivered_pipeline_and_preserves_outer_failure(tmp_path):
    run = outcome.ProcessingRun('job:1', 'job', 'bodies', {'pipeline': 'bodies'}, 'release-a', 'v2')
    run.body = outcome.failure('assembly', RuntimeError('secret'))
    path = tmp_path / 'match.json'
    path.write_text(json.dumps({'pipeline': 'v1', 'points': [{'t0': 2, 't1': 5}]}))
    record = run.attach(path)
    assert record['delivered_pipeline'] == 'v1'
    assert record['status'] == 'degraded'
    assert record['reason_code'] == 'assembly_exception'
    assert 'secret' not in json.dumps(record)
    assert json.loads(path.read_text())['processing']['release_id'] == 'release-a'


def test_success_requires_body_record_not_only_nonempty_points(tmp_path):
    run = outcome.ProcessingRun('job:1', 'job', 'bodies', {}, 'release-a', 'v2')
    path = tmp_path / 'match.json'
    path.write_text(json.dumps({'pipeline': 'bodies', 'points': [1]}))
    assert run.attach(path)['status'] == 'unknown'


def test_v3_error_does_not_hide_successful_body_assembly(tmp_path):
    run = outcome.ProcessingRun('job:1', 'job', 'bodies', {}, 'release-a', 'v2')
    path = tmp_path / 'match.json'
    path.write_text(json.dumps({'pipeline': 'bodies', 'points': [1], 'processing': {
        'body': {'status': 'used'}, 'edges': {'status': 'error', 'reason_code': 'serve_v3_exception'}}}))
    result = run.attach(path)
    assert result['status'] == 'degraded'
    assert result['delivered_pipeline'] == 'bodies'
    assert result['reason_code'] == 'serve_v3_exception'


def test_success_and_expected_refusal_have_distinct_health(tmp_path):
    for body, delivered, expected in [({'status': 'used'}, 'bodies', 'used'),
                                     ({'status': 'refused', 'reason_code': 'low_player_coverage'}, 'v2', 'refused')]:
        run = outcome.ProcessingRun('job:1', 'job', 'bodies', {}, 'release-a', 'v2')
        path = tmp_path / 'match.json'
        path.write_text(json.dumps({'pipeline': delivered, 'points': [1], 'processing': {'body': body}}))
        assert run.attach(path)['status'] == expected


def test_spool_retries_final_record_without_regressing_to_started(tmp_path):
    run = outcome.ProcessingRun('job:1', 'job', 'bodies', {}, 'release-a', 'v2')
    def unavailable(_):
        raise OSError('offline')
    assert outcome.publish(run.record(), unavailable, tmp_path) is False
    run.finished_at = '2026-09-11T14:00:00+00:00'
    run.status = 'degraded'
    assert outcome.publish(run.record(), unavailable, tmp_path) is False
    sent = []
    assert outcome.flush_spool(sent.append, tmp_path) == 1
    assert len(sent) == 1 and sent[0]['status'] == 'degraded'
    assert not list(tmp_path.glob('*.json'))


def test_malformed_spool_does_not_prevent_other_deliveries(tmp_path):
    (tmp_path / 'broken.json').write_text('{')
    run = outcome.ProcessingRun('job:1', 'job', 'bodies', {}, 'release-a', 'v2')
    outcome.publish(run.record(), lambda _: (_ for _ in ()).throw(OSError()), tmp_path)
    sent = []
    assert outcome.flush_spool(sent.append, tmp_path) == 1
    assert (tmp_path / 'broken.json').exists()


def test_configuration_keeps_override_and_existing_fail_open_defaults():
    def unavailable(key):
        raise OSError('private database URL')
    missing = outcome.configuration({}, unavailable)
    assert missing['pipeline'] == 'v1'
    assert missing['requested_pipeline'] == 'unknown'
    assert missing['serve_anchor'] is False
    assert missing['rally_end'] is False
    override = outcome.configuration({'points_pipeline': 'v2'}, unavailable)
    assert override['requested_pipeline'] == 'v2'
    assert override['pipeline_source'] == 'job'
    assert 'private' not in json.dumps(override)


def test_delivery_of_started_snapshot_cannot_remove_concurrent_final(tmp_path):
    run = outcome.ProcessingRun('job:1', 'job', 'bodies', {})
    started = run.record()
    def deliver_started(_):
        run.status = 'used'
        run.finished_at = outcome.now()
        outcome.publish(run.record(), lambda _: (_ for _ in ()).throw(OSError()), tmp_path)
    assert outcome.publish(started, deliver_started, tmp_path)
    sent = []
    outcome.flush_spool(sent.append, tmp_path)
    assert sent[0]['status'] == 'used'


def test_release_identity_uses_resolved_manifest_directory(tmp_path, monkeypatch):
    (tmp_path / 'manifest.json').write_text(json.dumps({
        'release_id': 'release-a', 'body_model': {'version': 'v2'}}))
    monkeypatch.setenv('PONGLENS_MATCH_RELEASE', str(tmp_path))
    assert outcome.release_identity() == ('release-a', 'v2')
