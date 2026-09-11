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


@pytest.mark.parametrize('pipeline,reason', [(None, 'missing'), ('', 'invalid'), ('private-invalid-value', 'invalid')])
def test_missing_or_invalid_pipeline_reports_default_not_intentional_v1(pipeline, reason):
    values = {'points_pipeline': pipeline, 'body_serve_anchor': 'off', 'body_rally_end': 'off'}
    settings = outcome.configuration({}, values.get)
    assert settings['pipeline'] == 'v1'
    assert settings['requested_pipeline'] == 'unknown'
    assert settings['pipeline_source'] == 'default_' + reason
    assert 'points_pipeline_' + reason in settings['config_errors']
    assert 'private-invalid-value' not in json.dumps(settings)


@pytest.mark.parametrize('pipeline', ['v1', 'v2', 'bodies'])
def test_explicit_valid_pipeline_and_edge_settings_remain_authoritative(pipeline):
    values = {'points_pipeline': pipeline, 'body_serve_anchor': 'on', 'body_rally_end': 'off'}
    configured = outcome.configuration({}, values.get)
    assert configured['requested_pipeline'] == pipeline
    assert configured['pipeline_source'] == 'app_config'
    assert configured['serve_anchor'] is True and configured['rally_end'] is False
    assert configured['config_errors'] == []
    override = outcome.configuration({'points_pipeline': pipeline}, lambda key: values.get(key) if key != 'points_pipeline' else None)
    assert override['pipeline_source'] == 'job' and override['requested_pipeline'] == pipeline


@pytest.mark.parametrize('value,reason', [(None, 'missing'), ('private-edge-value', 'invalid')])
@pytest.mark.parametrize('key', ['body_serve_anchor', 'body_rally_end'])
def test_missing_or_invalid_edges_preserve_off_default_and_report_each_source(key, value, reason):
    values = {'points_pipeline': 'bodies', 'body_serve_anchor': 'on', 'body_rally_end': 'on', key: value}
    settings = outcome.configuration({}, values.get)
    field = 'serve_anchor' if key == 'body_serve_anchor' else 'rally_end'
    other = 'rally_end' if field == 'serve_anchor' else 'serve_anchor'
    assert settings[field] is False and settings[other] is True
    assert settings[field + '_source'] == 'default_' + reason
    assert settings[other + '_source'] == 'app_config'
    assert key + '_' + reason in settings['config_errors']
    assert 'private-edge-value' not in json.dumps(settings)


def test_partial_edge_exception_preserves_existing_both_off_fallback_with_provenance():
    def partial(key):
        if key == 'body_rally_end': raise OSError('private database address')
        return 'bodies' if key == 'points_pipeline' else 'on'
    settings = outcome.configuration({}, partial)
    assert settings['serve_anchor'] is False and settings['rally_end'] is False
    assert settings['serve_anchor_source'] == 'default_edge_read_failure'
    assert settings['rally_end_source'] == 'default_unavailable'
    assert 'body_rally_end_unavailable' in settings['config_errors']
    assert 'private' not in json.dumps(settings)


def test_absent_config_keys_are_reported_without_claiming_healthy_body_settings(tmp_path):
    absent = outcome.configuration({}, {}.get)
    assert absent['pipeline'] == 'v1' and absent['requested_pipeline'] == 'unknown'
    assert set(absent['config_errors']) == {
        'points_pipeline_missing', 'body_serve_anchor_missing', 'body_rally_end_missing'}
    settings = outcome.configuration({'points_pipeline': 'bodies'}, {}.get)
    run = outcome.ProcessingRun('job:1', 'job', 'bodies', settings)
    path = tmp_path / 'match.json'
    path.write_text(json.dumps({'pipeline': 'bodies', 'points': [1],
                               'processing': {'body': {'status': 'used'}}}))
    final = run.attach(path)
    assert final['status'] == 'degraded'
    assert final['reason_code'] == 'config_read_failed'


def test_first_edge_exception_preserves_short_circuit_and_both_off_sources():
    calls = []
    def partial(key):
        calls.append(key)
        if key == 'body_serve_anchor': raise OSError('private connection')
        return 'on'
    settings = outcome.configuration({'points_pipeline': 'bodies'}, partial)
    assert calls == ['body_serve_anchor']
    assert not settings['serve_anchor'] and not settings['rally_end']
    assert settings['serve_anchor_source'] == 'default_unavailable'
    assert settings['rally_end_source'] == 'default_edge_read_failure'
    assert settings['config_errors'] == ['body_serve_anchor_unavailable']
