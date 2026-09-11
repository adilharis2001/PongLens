from datetime import datetime, timedelta, timezone

from processing_health import evaluate, alert_message


NOW = datetime(2026, 9, 11, 16, tzinfo=timezone.utc)


def run(job, status, minutes=10, release='a'):
    return {'job_id': job, 'attempt_key': job + ':1', 'status': status,
            'release_id': release, 'finished_at': (NOW - timedelta(minutes=minutes)).isoformat(),
            'requested_pipeline': 'bodies', 'reason_code': 'body_exception'}


def test_expected_refusal_and_single_failure_do_not_open_incident():
    assert evaluate([run('1', 'refused'), run('2', 'degraded')], [], NOW) == []


def test_retries_of_same_job_do_not_count_as_repeated_failures():
    assert evaluate([run('1', 'degraded', 20), run('1', 'degraded')], [], NOW) == []


def test_two_distinct_jobs_open_one_release_incident():
    changes = evaluate([run('1', 'degraded', 20), run('2', 'degraded')], [], NOW)
    assert len(changes) == 1
    assert changes[0]['action'] == 'open'
    assert changes[0]['release_id'] == 'a'
    assert changes[0]['details']['affected_jobs'] == 2


def test_active_incident_deduplicates_and_needs_new_success_to_recover():
    bad = [run('1', 'degraded', 20), run('2', 'degraded', 10)]
    incident = {**evaluate(bad, [], NOW)[0], 'id': 'incident', 'recovered_at': None}
    assert evaluate(bad, [incident], NOW)[0]['action'] == 'update'
    assert evaluate([], [incident], NOW + timedelta(days=3)) == []
    assert evaluate(bad + [run('3', 'used', 5)], [incident], NOW)[0]['action'] == 'update'
    changes = evaluate(bad + [run('3', 'used', 5), run('4', 'used', 1)], [incident], NOW)
    assert changes[0]['action'] == 'recover'


def test_old_failure_does_not_reopen_recovered_incident():
    bad = [run('1', 'degraded', 20), run('2', 'degraded', 10)]
    closed = {**evaluate(bad, [], NOW)[0], 'id': 'incident', 'recovered_at': NOW.isoformat()}
    assert evaluate(bad, [closed], NOW) == []


def test_success_from_another_release_is_not_recovery():
    bad = [run('1', 'degraded', 20), run('2', 'degraded', 10)]
    incident = {**evaluate(bad, [], NOW)[0], 'id': 'incident', 'recovered_at': None}
    changes = evaluate(bad + [run('3', 'used', 5, 'b'), run('4', 'used', 1, 'b')], [incident], NOW)
    assert changes[0]['action'] == 'update'


def test_admin_alert_contains_no_job_or_exception_details():
    message = alert_message({'kind': 'processing_degraded', 'release_id': 'a',
                             'details': {'raw_error': 'private media path'}})
    assert message.subject == 'Point processing needs attention'
    assert message.audience == 'admin'
    assert 'private' not in str(message)
    assert message.action['href'] == 'https://www.ponglens.com/admin/processing'


def test_already_recovered_before_monitor_woke_does_not_send_stale_alarm():
    assert evaluate([run('1', 'degraded', 20), run('2', 'degraded', 10),
                     run('3', 'used', 5), run('4', 'used', 1)], [], NOW) == []
