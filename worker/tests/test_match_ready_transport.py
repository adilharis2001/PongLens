"""Real outbox and cost writes with a fake Resend HTTP boundary."""
import os
import sys
from unittest import mock

import pytest
import psycopg2
from worker import worker
from worker.tests.test_match_ready_delivery import (
    db, reset, complete, payload, query, release_lease, row,
)


@pytest.mark.parametrize('body', [ValueError('invalid JSON'), None, [], {},
                                  {'id': ''}, {'id': '  '}, {'id': 17}])
def test_ambiguous_success_stays_pending_and_retries_frozen_payload(db, body):
    job = complete(db)
    ambiguous = mock.Mock(status_code=200)
    if isinstance(body, Exception):
        ambiguous.json.side_effect = body
    else:
        ambiguous.json.return_value = body
    confirmed = mock.Mock(status_code=200)
    confirmed.json.return_value = {'id': 'provider-confirmed'}
    with (
        mock.patch.object(worker, 'match_ready_payload', side_effect=payload) as render,
        mock.patch.object(worker, 'address_suppressed', return_value=False),
        mock.patch.object(worker.requests, 'post', side_effect=[ambiguous, confirmed]) as post,
        mock.patch.object(worker.CostMeter, 'record') as costs,
    ):
        assert worker.retry_match_ready(db, job) is False
        pending = row(db)
        assert pending['state'] == 'pending'
        assert pending['provider_id'] is None and pending['sent_at'] is None
        assert pending['last_error'] == 'RuntimeError'
        costs.assert_not_called()
        release_lease(db)
        assert worker.retry_match_ready(db, job) is True
        assert row(db)['provider_id'] == 'provider-confirmed'
        assert row(db)['state'] == 'sent'
        assert render.call_count == 1
        assert post.call_count == 2
        for call in post.call_args_list:
            assert call.kwargs['json'] == pending['payload']
            assert call.kwargs['headers']['Idempotency-Key'] == 'match-ready/' + job


def test_monitor_retry_persists_cost_without_rebinding_active_job_meter(db, monkeypatch):
    import processing_health

    complete(db)
    # This function exists only in the explicitly guarded disposable database.
    query(db, 'create table ready_retry_cost_events(event jsonb)')
    query(db, '''create function public.record_cost_usage(events jsonb) returns void
        language sql as $$ insert into ready_retry_cost_events
        select value from jsonb_array_elements(events) $$''')
    active_connection = object()
    active_meter = worker.CostMeter(active_connection)
    response = mock.Mock(status_code=200)
    response.json.return_value = {'id': 'provider-metered'}
    monkeypatch.setenv('PONGLENS_DB_URL', os.environ['PONGLENS_READY_TEST_DSN'])
    monkeypatch.setattr(sys, 'argv', ['processing_health', '--once'])
    monkeypatch.setattr(processing_health, 'flush_spool', lambda _: None)
    monkeypatch.setattr(processing_health, 'refresh', lambda _: None)
    monkeypatch.setitem(sys.modules, 'worker', worker)
    try:
        with (
            mock.patch.object(worker, 'match_ready_payload', side_effect=payload),
            mock.patch.object(worker, 'address_suppressed', return_value=False),
            mock.patch.object(worker.requests, 'post', return_value=response),
            mock.patch.object(worker, 'COST_METER', active_meter),
            mock.patch.object(worker, 'connect', side_effect=AssertionError('Unrelated worker startup')),
        ):
            processing_health.main()
            assert worker.COST_METER is active_meter
            assert active_meter.connection is active_connection
        assert row(db)['state'] == 'sent'
        events = query(db, 'select event from ready_retry_cost_events')
        assert len(events) == 1
        assert events[0]['event']['provider'] == 'Resend'
        assert events[0]['event']['quantity'] == 1
        assert events[0]['event']['unit'] == 'email_recipient'
    finally:
        query(db, 'drop function public.record_cost_usage(jsonb)')
        query(db, 'drop table ready_retry_cost_events')


def test_failed_cost_write_does_not_retry_an_accepted_email(db, caplog):
    job = complete(db)
    query(db, '''create function public.record_cost_usage(events jsonb) returns void
        language plpgsql as $$ begin raise exception 'Fixture metering failure'; end $$''')
    connection = psycopg2.connect(os.environ['PONGLENS_READY_TEST_DSN'])
    assert not connection.autocommit
    response = mock.Mock(status_code=200)
    response.json.return_value = {'id': 'provider-accepted'}
    try:
        with (
            mock.patch.object(worker, 'match_ready_payload', side_effect=payload),
            mock.patch.object(worker, 'address_suppressed', return_value=False),
            mock.patch.object(worker.requests, 'post', return_value=response) as post,
        ):
            assert worker.retry_match_ready(connection, job) is True
            assert 'Fixture metering failure' in caplog.text
            sent = row(db)
            assert sent['state'] == 'sent'
            assert sent['provider_id'] == 'provider-accepted'
            assert sent['sent_at'] is not None
            release_lease(db)
            assert worker.retry_match_ready(connection, job) is False
            assert row(db)['attempts'] == 1
            assert post.call_count == 1
    finally:
        connection.close()
        query(db, 'drop function public.record_cost_usage(jsonb)')
