"""Real monitor tests; only the explicitly named disposable loopback DB is allowed."""
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
from uuid import uuid4

import psycopg2
from psycopg2.extensions import parse_dsn
from psycopg2.extras import RealDictCursor
import pytest

from processing_health import refresh, deliver_notifications
from processing_outcome import database_sender, publish, flush_spool

DATABASE = 'ponglens_worker_health_integration'
ROOT = Path(__file__).resolve().parents[2]


def guarded_dsn(value):
    parsed = parse_dsn(value)
    if (parsed.get('host') not in ('127.0.0.1', '::1', 'localhost') or
            parsed.get('hostaddr', parsed.get('host')) not in ('127.0.0.1', '::1', 'localhost') or
            parsed.get('dbname') != DATABASE or parsed.get('service')):
        raise ValueError('Health tests require the dedicated loopback integration database')
    return value


@pytest.fixture(scope='module')
def connection():
    value = os.environ.get('PONGLENS_HEALTH_TEST_DSN')
    if not value:
        pytest.skip('Set PONGLENS_HEALTH_TEST_DSN to the dedicated local integration database')
    db = psycopg2.connect(guarded_dsn(value), connect_timeout=5)
    db.autocommit = True
    with db.cursor() as cur:
        cur.execute('select current_database()')
        assert cur.fetchone()[0] == DATABASE
        # Explicit test-owned objects only. Reapply edited migration on every
        # suite run; never accidentally test a previous copy of its functions.
        cur.execute('''drop function if exists public.admin_processing_health();
            drop function if exists public.worker_processing_missing();
            drop function if exists public.record_worker_processing_run(jsonb);
            drop table if exists public.worker_processing_reporting_gaps, public.worker_processing_runs,
                public.worker_processing_incidents, public.worker_processing_health_control,
                public.jobs, public.matches cascade;
            drop function if exists public.is_admin();''')
        cur.execute((ROOT / 'worker/tests/processing_health_bootstrap.sql').read_text())
        cur.execute('grant select on public.jobs,public.matches to ponglens_worker')
        cur.execute((ROOT / 'supabase/migrations/20260911143000_worker_processing_health.sql').read_text())
    db.autocommit = False
    yield db
    db.close()


@pytest.fixture
def db(connection):
    with connection:
        with connection.cursor() as cur:
            cur.execute('''reset role; reset test.is_admin;
                truncate public.worker_processing_reporting_gaps, public.worker_processing_runs, public.worker_processing_incidents,
                public.jobs, public.matches;
                update public.worker_processing_health_control set expected_after=null,
                    monitor_at=null,email_enabled=false;''')
    return connection


def query(db, sql, args=()):
    with db:
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, args)
            return list(cur.fetchall()) if cur.description else []


def record(job, attempt, status, start_minutes, finish_minutes=None):
    now = datetime.now(timezone.utc)
    return {'schema': 1, 'attempt_key': f'{job}:{attempt}', 'job_id': job,
            'release_id': 'integration-release', 'requested_pipeline': 'bodies',
            'status': status, 'started_at': (now - timedelta(minutes=start_minutes)).isoformat(),
            'finished_at': ((now - timedelta(minutes=finish_minutes)).isoformat()
                            if finish_minutes is not None else None),
            'reason_code': 'missing_body_outcome' if status == 'unknown' else None,
            'delivered_pipeline': 'bodies' if status == 'used' else None}


def send_record(db, value):
    with db:
        database_sender(db)(value)


def active(db):
    return query(db, 'select * from public.worker_processing_incidents where recovered_at is null')


def terminal_job(db, job):
    query(db, '''insert into public.jobs(id,kind,status,options,created_at,updated_at)
        values (%s,'deadspace_cut','failed','{"points":true}',now()-interval '2 hours',now()-interval '20 minutes')''', (job,))


def test_guard_rejects_remote_or_other_database():
    for dsn in ('host=example.com dbname=' + DATABASE,
                'host=127.0.0.1 dbname=postgres',
                'host=127.0.0.1 hostaddr=10.0.0.1 dbname=' + DATABASE):
        with pytest.raises(ValueError): guarded_dsn(dsn)


@pytest.mark.parametrize('final', ['used', 'refused', 'failed', 'degraded', 'unknown'])
def test_unknown_persists_through_running_retry_until_conclusive_final(db, final):
    job = str(uuid4())
    send_record(db, record(job, 1, 'unknown', 60, 50))
    refresh(db)
    incident = active(db)[0]['id']
    send_record(db, record(job, 2, 'running', 30))
    refresh(db)
    assert [r['id'] for r in active(db)] == [incident]
    send_record(db, record(job, 2, final, 30, 10))
    refresh(db)
    if final == 'unknown':
        assert [r['id'] for r in active(db)] == [incident]
    else:
        assert active(db) == []
        assert query(db, 'select recovered_at from public.worker_processing_incidents where id=%s', (incident,))[0]['recovered_at']


def test_terminal_start_without_match_is_unknown_and_late_real_final_supersedes(db):
    job = str(uuid4())
    terminal_job(db, job)
    started = record(job, 1, 'running', 40)
    send_record(db, started)
    refresh(db)
    assert active(db)[0]['kind'] == 'telemetry_missing'
    assert query(db, 'select status from public.worker_processing_runs')[0]['status'] == 'running'
    query(db, "set test.is_admin='true'")
    dashboard = query(db, 'select public.admin_processing_health() as health')[0]['health']
    assert dashboard['runs'][0]['status'] == 'unknown'
    assert dashboard['runs'][0]['reason_code'] == 'missing_final_outcome'
    assert dashboard['runs'][0]['details']['outcome_inferred'] is True
    assert dashboard['missing'][0]['job_id'] == job
    final = {**started, 'status': 'used', 'delivered_pipeline': 'bodies',
             'finished_at': datetime.now(timezone.utc).isoformat()}
    send_record(db, final)
    send_record(db, started)  # A delayed start must not overwrite the real final.
    refresh(db)
    assert active(db) == []
    assert query(db, 'select status from public.worker_processing_runs')[0]['status'] == 'used'
    dashboard = query(db, 'select public.admin_processing_health() as health')[0]['health']
    assert dashboard['runs'][0]['status'] == 'used'
    assert not dashboard['runs'][0]['details'].get('outcome_inferred')


def test_rejected_job_without_start_or_published_match_is_not_missing(db):
    terminal_job(db, str(uuid4()))
    query(db, "update public.worker_processing_health_control set expected_after=now()-interval '3 hours'")
    refresh(db)
    assert active(db) == []
    assert query(db, 'select * from public.worker_processing_missing()') == []


def test_observed_missing_final_survives_retry_and_observation_replay(db):
    job = str(uuid4())
    terminal_job(db, job)
    send_record(db, record(job, 1, 'running', 40))
    refresh(db)
    refresh(db)
    incident = active(db)[0]['id']
    gaps = query(db, 'select * from public.worker_processing_reporting_gaps')
    assert len(gaps) == 1 and gaps[0]['observed_at'] is not None
    query(db, "update public.jobs set status='processing',updated_at=now() where id=%s", (job,))
    send_record(db, record(job, 2, 'running', 5))
    refresh(db)
    assert [r['id'] for r in active(db)] == [incident]
    send_record(db, record(job, 2, 'failed', 5, 1))
    refresh(db)
    assert active(db) == []
    assert query(db, "select count(*) as n from public.worker_processing_runs where status='used'")[0]['n'] == 0
    # Observation remains historical evidence; it is not a forged completion.
    assert query(db, 'select * from public.worker_processing_reporting_gaps') == gaps


def test_missing_legacy_record_does_not_recover_when_retry_starts(db):
    job = str(uuid4())
    terminal_job(db, job)
    query(db, "update public.worker_processing_health_control set expected_after=now()-interval '3 hours'")
    query(db, 'insert into public.matches(id,job_id,match_json_path) values (%s,%s,%s)',
          (str(uuid4()), job, 'test-only/match.json'))
    refresh(db)
    incident = active(db)[0]['id']
    query(db, "update public.jobs set status='processing',updated_at=now() where id=%s", (job,))
    send_record(db, record(job, 2, 'running', 5))
    refresh(db)
    assert [r['id'] for r in active(db)] == [incident]
    send_record(db, record(job, 2, 'refused', 5, 1))
    refresh(db)
    assert active(db) == []


def test_delayed_older_final_spool_cannot_clear_newer_unknown(db, tmp_path):
    job = str(uuid4())
    older = record(job, 1, 'used', 60, 5)  # Later finish timestamp, older attempt.
    newer = record(job, 2, 'unknown', 30, 10)
    def unavailable(_): raise ConnectionError('test outage')
    assert not publish(older, unavailable, tmp_path)
    send_record(db, newer)
    refresh(db)
    incident = active(db)[0]['id']
    with db:
        assert flush_spool(database_sender(db), tmp_path) == 1
    refresh(db)
    assert [r['id'] for r in active(db)] == [incident]
    assert list(tmp_path.glob('*.json')) == []


def test_notification_failure_lease_retry_and_dedup_use_real_database(db):
    send_record(db, record(str(uuid4()), 1, 'unknown', 60, 50))
    refresh(db)
    refresh(db)
    incident = active(db)[0]['id']
    attempts = []
    def failing_send(message, **kwargs):
        attempts.append(kwargs['idempotency_key'])
        raise RuntimeError('private provider error must not be stored')
    assert not deliver_notifications(db, failing_send)  # Default off.
    assert attempts == []
    query(db, 'update public.worker_processing_health_control set email_enabled=true')
    assert not deliver_notifications(db, failing_send)
    assert not deliver_notifications(db, failing_send)  # Lease blocks duplicate send.
    row = active(db)[0]
    assert row['notification_attempts'] == 1
    assert row['notification_error'] == 'RuntimeError'
    assert row['notification_lease_until'] is not None
    query(db, "update public.worker_processing_incidents set notification_lease_until=now()-interval '1 second'")
    assert deliver_notifications(db, lambda message, **kwargs: attempts.append(kwargs['idempotency_key']))
    assert attempts == [f'worker-processing/{incident}'] * 2
    assert not deliver_notifications(db, failing_send)
    row = active(db)[0]
    assert row['notification_attempts'] == 2
    assert row['notified_at'] and row['notification_error'] is None
    assert len(query(db, 'select * from public.worker_processing_incidents')) == 1


def test_reporting_observations_are_admin_only_and_worker_append_only(db):
    job = str(uuid4())
    terminal_job(db, job)
    send_record(db, record(job, 1, 'running', 40))
    query(db, 'set role ponglens_worker')
    refresh(db)  # Exercise the actual restricted monitor grants and transaction.
    assert len(query(db, 'select * from public.worker_processing_reporting_gaps')) == 1
    query(db, "reset role; set role authenticated; set test.is_admin='false'")
    assert query(db, 'select * from public.worker_processing_reporting_gaps') == []
    query(db, "set test.is_admin='true'")
    assert len(query(db, 'select * from public.worker_processing_reporting_gaps')) == 1
    query(db, 'reset role')
    rights = query(db, '''select
        has_table_privilege('anon','public.worker_processing_reporting_gaps','select') as anon_read,
        has_table_privilege('service_role','public.worker_processing_reporting_gaps','update') as service_update,
        has_table_privilege('service_role','public.worker_processing_reporting_gaps','delete') as service_delete,
        has_table_privilege('ponglens_worker','public.worker_processing_reporting_gaps','update') as worker_update,
        has_table_privilege('ponglens_worker','public.worker_processing_reporting_gaps','delete') as worker_delete''')[0]
    assert not any(rights.values())


def test_real_refresh_requires_two_used_jobs_for_processing_recovery(db):
    for minutes in (40, 30):
        send_record(db, record(str(uuid4()), 1, 'degraded', minutes+5, minutes))
    refresh(db)
    incident = active(db)[0]['id']
    assert active(db)[0]['kind'] == 'processing_degraded'
    send_record(db, record(str(uuid4()), 1, 'refused', 20, 15))
    send_record(db, record(str(uuid4()), 1, 'used', 10, 5))
    refresh(db)
    assert [r['id'] for r in active(db)] == [incident]
    send_record(db, record(str(uuid4()), 1, 'used', 3, 1))
    refresh(db)
    assert active(db) == []


def test_existing_rls_rpc_and_idempotency_assertions(db):
    assertions = (ROOT / 'worker/tests/processing_health_assertions.sql').read_text()
    with db:
        with db.cursor() as cur:
            cur.execute('\n'.join(line for line in assertions.splitlines() if not line.startswith('\\')))
