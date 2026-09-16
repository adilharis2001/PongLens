"""Exercise the real notification entry point with only external I/O replaced."""
from unittest import mock
import worker.worker as worker
from worker import match_ready_delivery


def test_managed_completion_does_not_fall_back_to_legacy_send():
    with mock.patch.object(worker, 'match_ready_delivery', match_ready_delivery, create=True), \
         mock.patch.object(match_ready_delivery, 'managed', return_value=True), \
         mock.patch.object(match_ready_delivery, 'deliver_one', return_value=False) as retry, \
         mock.patch.object(worker, 'get_job_original_name', return_value='Match'), \
         mock.patch.object(worker, 'get_job_match_id', return_value='sample'), \
         mock.patch.object(worker, 'get_user_email', return_value='player@example.test'), \
         mock.patch.object(worker, 'send_email') as legacy:
        worker.notify_job_done(object(), 'job', 'user')
    assert retry.called
    assert not legacy.called


def test_unknown_delivery_state_does_not_risk_duplicate_legacy_email():
    with mock.patch.object(worker, 'match_ready_delivery', match_ready_delivery, create=True), \
         mock.patch.object(match_ready_delivery, 'managed', side_effect=ConnectionError()), \
         mock.patch.object(worker, 'get_job_original_name', return_value='Match'), \
         mock.patch.object(worker, 'get_job_match_id', return_value='sample'), \
         mock.patch.object(worker, 'get_user_email', return_value='player@example.test'), \
         mock.patch.object(worker, 'send_email') as legacy:
        worker.notify_job_done(object(), 'job', 'user')
    assert not legacy.called


def test_legacy_completion_keeps_the_existing_email_when_capture_is_off():
    with mock.patch.object(worker, 'match_ready_delivery', match_ready_delivery, create=True), \
         mock.patch.object(match_ready_delivery, 'managed', return_value=False), \
         mock.patch.object(worker, 'get_job_original_name', return_value='Match'), \
         mock.patch.object(worker, 'get_job_match_id', return_value='sample'), \
         mock.patch.object(worker, 'get_user_email', return_value='player@example.test'), \
         mock.patch.object(worker, 'send_email') as legacy:
        worker.notify_job_done(object(), 'job', 'user')
    assert legacy.call_count == 1
    assert legacy.call_args.args[0] == 'player@example.test'
    assert '/match/sample' in legacy.call_args.args[1].text


def test_transport_preserves_full_frozen_payload_and_idempotency():
    assert hasattr(worker, 'send_email_payload'), 'Shared provider transport is missing'
    value = {'from': 'PongLens <support@ponglens.com>', 'to': ['player@example.test'],
             'reply_to': 'support@ponglens.com', 'subject': 'Ready', 'html': '<p>Ready</p>',
             'text': 'Ready', 'headers': {'X-PongLens-Template-Version': '1'}}
    response = mock.Mock(status_code=200)
    response.json.return_value = {'id': 'provider-1'}
    with mock.patch.object(worker.requests, 'post', return_value=response) as post:
        result = worker.send_email_payload(value, idempotency_key='match-ready/job', cost_meter=mock.Mock())
    assert result == 'provider-1'
    assert post.call_args.kwargs['json'] == value
    assert post.call_args.kwargs['headers']['Idempotency-Key'] == 'match-ready/job'
    assert post.call_args.kwargs['timeout'] == 30
