"""Real disposable PostgreSQL outbox tests; transport never reaches a network."""
import importlib.util
import os
import sys
from types import SimpleNamespace
from pathlib import Path
from uuid import uuid4

import psycopg2
from psycopg2.extensions import parse_dsn
from psycopg2.extras import RealDictCursor
import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.find_spec('match_ready_delivery')
if SPEC:
    import match_ready_delivery as delivery
else:
    delivery = None
DATABASE = 'ponglens_match_ready_delivery_test'


@pytest.fixture(scope='module')
def db():
    dsn = os.environ.get('PONGLENS_READY_TEST_DSN')
    if not dsn:
        pytest.skip('Dedicated local database required')
    parsed = parse_dsn(dsn)
    assert parsed.get('host') == '127.0.0.1'
    assert parsed.get('hostaddr', '127.0.0.1') == '127.0.0.1'
    assert parsed.get('dbname') == DATABASE and not parsed.get('service')
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute('''create table if not exists public.jobs(
            id uuid primary key,user_id uuid not null,kind text not null,status text not null);
            create table if not exists public.worker_processing_health_control(
              singleton boolean primary key default true,email_enabled boolean default false);
            insert into public.worker_processing_health_control(singleton) values(true) on conflict do nothing;
            create or replace function public.is_admin() returns boolean language sql
            as $$select false$$;''')
        migration = ROOT / 'supabase/migrations/20260913061000_match_ready_delivery.sql'
        if migration.exists():
            cur.execute(migration.read_text())
    yield conn
    conn.close()


def query(db, sql, args=()):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql, args)
        return list(cur.fetchall()) if cur.description else []


@pytest.fixture(autouse=True)
def reset(db):
    assert delivery is not None, 'Durable match-ready delivery is not implemented'
    query(db, 'truncate public.match_ready_deliveries,public.jobs')
    query(db, 'update public.match_ready_delivery_control set enabled=false')


def complete(db, kind='deadspace_cut', enabled=True):
    if enabled:
        query(db, 'update public.match_ready_delivery_control set enabled=true')
    job = str(uuid4())
    query(db, 'insert into public.jobs values (%s,%s,%s,\'processing\')',
          (job, str(uuid4()), kind))
    query(db, "update public.jobs set status='done' where id=%s", (job,))
    return job


def payload(_conn, _job, _user):
    return {'from': 'PongLens <support@ponglens.com>', 'to': ['player@example.test'],
            'reply_to': 'support@ponglens.com', 'subject': 'Your match is ready',
            'html': '<p>Ready</p>', 'text': 'Ready',
            'headers': {'X-PongLens-Template-Id': 'match-ready',
                        'X-PongLens-Template-Version': '1'}}


def row(db):
    return query(db, 'select * from public.match_ready_deliveries')[0]


def release_lease(db):
    query(db, "update public.match_ready_deliveries set lease_until=null,next_attempt_at=now()-interval '1 second'")


def test_capture_is_disabled_by_default_and_never_backfills(db):
    old = complete(db, enabled=False)
    assert not delivery.managed(db, old)
    query(db, 'update public.match_ready_delivery_control set enabled=true')
    assert query(db, 'select * from public.match_ready_deliveries') == []
    assert not delivery.deliver_one(db, payload, lambda *_: pytest.fail('No historical mail'))


def test_only_new_primary_completion_is_captured_once(db):
    for kind in ['content_check', 'youtube_import', 'reclip', 'reel', 'hand_cut', 'placement_generate']:
        complete(db, kind)
    assert query(db, 'select * from public.match_ready_deliveries') == []
    job = complete(db)
    query(db, "update public.jobs set status='done' where id=%s", (job,))
    assert len(query(db, 'select * from public.match_ready_deliveries')) == 1
    assert delivery.managed(db, job)


def test_completion_and_capture_commit_or_rollback_together(db):
    query(db, 'update public.match_ready_delivery_control set enabled=true')
    query(db, 'begin')
    complete(db, enabled=False)
    assert len(query(db, 'select * from public.match_ready_deliveries')) == 1
    query(db, 'rollback')
    assert query(db, 'select * from public.match_ready_deliveries') == []


def test_success_persists_and_prevents_another_send(db):
    job = complete(db)
    accepted = []
    assert delivery.deliver_one(db, payload, lambda value, key: accepted.append((value, key)) or 'provider-1')
    assert row(db)['state'] == 'sent' and row(db)['sent_at'] is not None
    assert row(db)['provider_id'] == 'provider-1'
    assert not delivery.deliver_one(db, payload, lambda *_: pytest.fail('Duplicate'))
    assert accepted[0][1] == f'match-ready/{job}' and len(accepted) == 1


def test_uncertain_send_reuses_frozen_full_payload_and_key_after_restart(db):
    complete(db)
    accepted = {}
    def uncertain(value, key):
        accepted[key] = value
        raise TimeoutError('accepted but reply lost')
    assert not delivery.deliver_one(db, payload, uncertain)
    assert row(db)['state'] == 'pending' and row(db)['attempts'] == 1
    assert not delivery.deliver_one(db, payload, lambda *_: pytest.fail('Retry before due'))
    release_lease(db)
    restarted = psycopg2.connect(os.environ['PONGLENS_READY_TEST_DSN'])
    restarted.autocommit = True
    try:
        def accepted_retry(value, key):
            assert value == accepted[key]
            return 'same-provider-id'
        assert delivery.deliver_one(restarted,
            lambda *_: pytest.fail('Payload changed on retry'), accepted_retry)
    finally:
        restarted.close()
    assert row(db)['state'] == 'sent' and row(db)['attempts'] == 2
    assert len(accepted) == 1


def test_uncertain_send_cannot_escape_provider_dedup_window(db):
    complete(db)
    assert not delivery.deliver_one(db, payload, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    query(db, "update public.match_ready_deliveries set first_attempt_at=now()-interval '23 hours 1 second'")
    release_lease(db)
    assert not delivery.deliver_one(db, payload, lambda *_: pytest.fail('Unsafe late retry'))
    assert row(db)['state'] == 'expired'


def test_lease_prevents_overlapping_deliveries(db):
    complete(db)
    def overlapping(value, key):
        other = psycopg2.connect(os.environ['PONGLENS_READY_TEST_DSN'])
        other.autocommit = True
        try:
            assert not delivery.deliver_one(other, payload, lambda *_: pytest.fail('Concurrent duplicate'))
        finally:
            other.close()
        return 'one'
    assert delivery.deliver_one(db, payload, overlapping)
    assert row(db)['attempts'] == 1


def test_suppression_checked_on_retry_and_lookup_failure_keeps_existing_fail_open(db):
    complete(db)
    assert not delivery.deliver_one(db, payload, lambda *_: pytest.fail('Suppressed'), lambda _: True)
    assert row(db)['state'] == 'suppressed'
    query(db, 'truncate public.match_ready_deliveries,public.jobs')
    complete(db)
    def lookup_failed(_):
        raise ConnectionError('test lookup unavailable')
    assert delivery.deliver_one(db, payload, lambda *_: 'allowed-existing-policy', lookup_failed)


def test_missing_address_finishes_quietly_and_disabled_control_stops_pending(db):
    complete(db)
    assert not delivery.deliver_one(db, lambda *_: None, lambda *_: pytest.fail('No recipient'))
    assert row(db)['state'] == 'unaddressed'
    query(db, 'truncate public.match_ready_deliveries,public.jobs')
    job = complete(db)
    query(db, 'update public.match_ready_delivery_control set enabled=false')
    assert delivery.managed(db, job)  # Never fall back to a second legacy sender.
    assert not delivery.deliver_one(db, payload, lambda *_: pytest.fail('Disabled'))


def test_expired_or_retired_lease_cannot_send_after_slow_preparation(db):
    complete(db)
    def retired(_):
        query(db, "update public.match_ready_deliveries set lease_until=now()-interval '1 second'")
        return False
    assert not delivery.deliver_one(db, payload, lambda *_: pytest.fail('Retired lease'), retired)


def test_attempt_limit_stops_permanently_failing_delivery(db):
    complete(db)
    query(db, 'update public.match_ready_deliveries set attempts=24')
    assert not delivery.deliver_one(db, payload, lambda *_: pytest.fail('Unbounded retry'))
    assert row(db)['state'] == 'expired'


def test_outbox_and_controls_are_not_exposed_to_players(db):
    complete(db)
    rights = query(db, """select
        has_table_privilege('anon','public.match_ready_deliveries','select') as anon_read,
        has_table_privilege('authenticated','public.match_ready_deliveries','update') as player_write,
        has_table_privilege('authenticated','public.match_ready_delivery_control','update') as player_control,
        has_function_privilege('authenticated','public.capture_match_ready_delivery()','execute') as player_capture""")[0]
    assert not any(rights.values())
    query(db, 'set role authenticated')
    try:
        assert query(db, 'select * from public.match_ready_deliveries') == []
    finally:
        query(db, 'reset role')


def test_independent_monitor_retries_without_media_job_or_admin_alerts(db, monkeypatch):
    import processing_health
    complete(db)
    monkeypatch.setenv('PONGLENS_DB_URL', os.environ['PONGLENS_READY_TEST_DSN'])
    monkeypatch.setattr(sys, 'argv', ['processing_health', '--once'])
    monkeypatch.setattr(processing_health, 'flush_spool', lambda _: None)
    monkeypatch.setattr(processing_health, 'refresh', lambda _: None)
    monkeypatch.setitem(sys.modules, 'worker', SimpleNamespace(retry_match_ready=lambda conn:
        delivery.deliver_one(conn, payload, lambda *_: 'monitor-delivered')))
    processing_health.main()
    assert row(db)['state'] == 'sent' and row(db)['provider_id'] == 'monitor-delivered'
