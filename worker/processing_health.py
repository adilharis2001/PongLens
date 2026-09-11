"""Independent processing-health monitor; no media imports or queue claims.

Run once per minute with launchd. Spool retries happen before incident checks.
Failures remain visible in monitor freshness, not in a player's job status.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import logging
import os
import subprocess

from processing_outcome import database_sender, flush_spool

log = logging.getLogger(__name__)


def stamp(value):
    return value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))


def evaluate(runs, incidents, now):
    """Two different failing jobs open an incident; two later body successes close it.

    Expected evidence refusals are neutral. Ageing out, silence, another
    release succeeding, and retrying one bad job never constitute recovery.
    """
    latest = {}
    for run in sorted((r for r in runs if r.get('finished_at')),
                      key=lambda r: stamp(r['finished_at'])):
        latest[run['job_id']] = run
    groups = {}
    for run in latest.values():
        if run['requested_pipeline'] in ('bodies', 'unknown'):
            groups.setdefault(run.get('release_id') or 'unsealed', []).append(run)
    changes = []
    releases = set(groups) | {i['release_id'] for i in incidents if i['kind'] == 'processing_degraded'}
    for release in sorted(releases):
        history = [i for i in incidents if i['release_id'] == release and i['kind'] == 'processing_degraded']
        active = next((i for i in history if not i.get('recovered_at')), None)
        recovered = max((stamp(i['recovered_at']) for i in history if i.get('recovered_at')),
                        default=datetime.min.replace(tzinfo=timezone.utc))
        records = groups.get(release, [])
        bad = [r for r in records if r['status'] in ('degraded', 'failed')
               and stamp(r['finished_at']) > recovered
               and stamp(r['finished_at']) >= now - timedelta(hours=24)]
        if not active and len(bad) < 2:
            continue
        last_fault = max([stamp(r['finished_at']) for r in bad] +
                         ([stamp(active['last_fault_at'])] if active else []))
        good = [r for r in records if r['status'] == 'used' and stamp(r['finished_at']) > last_fault]
        if not active and len(good) >= 2:
            continue
        if active and len(good) >= 2:
            changes.append({'action': 'recover', 'id': active['id'],
                            'recovered_at': max(stamp(r['finished_at']) for r in good).isoformat()})
        elif bad:
            changes.append({'action': 'update' if active else 'open',
                'id': active['id'] if active else None, 'kind': 'processing_degraded',
                'release_id': release, 'last_fault_at': last_fault.isoformat(),
                'details': {'affected_jobs': len(bad),
                            'reason_codes': sorted({r.get('reason_code') or 'unknown' for r in bad})}})
    return changes


def refresh(connection):
    """One transaction + advisory lock makes overlapping launches idempotent."""
    from psycopg2.extras import RealDictCursor
    with connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("select pg_try_advisory_xact_lock(9171101430) as locked")
            if not cur.fetchone()['locked']:
                return
            cur.execute("select now() as now")
            now = cur.fetchone()['now']
            # Keep the latest fact for each job, including unresolved unknown
            # outcomes. Ageing out is not evidence that reporting recovered.
            cur.execute("select distinct on (job_id) * from public.worker_processing_runs order by job_id,started_at desc")
            runs = list(cur.fetchall())
            cur.execute("select * from public.worker_processing_incidents where recovered_at is null or recovered_at >= now() - interval '7 days'")
            incidents = list(cur.fetchall())
            changes = evaluate(runs, incidents, now)
            cur.execute('select * from public.worker_processing_missing()')
            missing = list(cur.fetchall())
            latest = {}
            for run in sorted(runs, key=lambda r: stamp(r['started_at'])):
                latest[run['job_id']] = run
            missing.extend({'job_id': r['job_id'], 'finished_at': stamp(r['finished_at'])}
                           for r in latest.values() if r['status'] == 'unknown' and r.get('finished_at'))
            gap = next((i for i in incidents if i['kind'] == 'telemetry_missing' and not i['recovered_at']), None)
            if missing:
                changes.append({'action': 'update' if gap else 'open', 'id': gap['id'] if gap else None,
                    'kind': 'telemetry_missing', 'release_id': 'unknown',
                    'last_fault_at': max(r['finished_at'] for r in missing).isoformat(),
                    'details': {'affected_jobs': len(missing)}})
            elif gap:
                changes.append({'action': 'recover', 'id': gap['id'], 'recovered_at': now.isoformat()})
            for change in changes:
                if change['action'] == 'recover':
                    cur.execute('update public.worker_processing_incidents set recovered_at=%s where id=%s',
                                (change['recovered_at'], change['id']))
                elif change['action'] == 'update':
                    cur.execute('update public.worker_processing_incidents set last_fault_at=%s,details=%s::jsonb where id=%s',
                                (change['last_fault_at'], json.dumps(change['details']), change['id']))
                else:
                    cur.execute('insert into public.worker_processing_incidents(kind,release_id,last_fault_at,details) values (%s,%s,%s,%s::jsonb)',
                                (change['kind'], change['release_id'], change['last_fault_at'], json.dumps(change['details'])))
            cur.execute('update public.worker_processing_health_control set monitor_at=now() where singleton')


def keychain(service):
    return subprocess.check_output(['security', 'find-generic-password', '-a', 'openclaw', '-s', service, '-w'],
                                   stderr=subprocess.DEVNULL, text=True, timeout=10).strip()


def alert_message(incident):
    from email_templates import EmailMessage
    gap = incident['kind'] == 'telemetry_missing'
    explanation = ('Some completed matches have incomplete processing records. Their body-processing outcome is unknown.'
                   if gap else 'Point processing encountered problems on more than one job. Some matches may have used the ball-based fallback.')
    return EmailMessage(
        template_id='worker-processing-health', template_version=1,
        category='operational', audience='admin',
        subject='Point processing needs attention', preheader=explanation,
        heading='Point processing needs attention',
        blocks=[{'type': 'paragraph', 'text': explanation}],
        reason='You receive processing alerts as the PongLens administrator.',
        action={'label': 'Open processing', 'href': 'https://www.ponglens.com/admin/processing'},
        support=False)


def deliver_notifications(connection, send):
    """Durable lease plus provider idempotency key; one email per incident.

    Notifications are opt-in at rollout. Import the existing sender only
    when enabled, so it keeps suppression checks and the approved renderer.
    """
    from psycopg2.extras import RealDictCursor
    from email_templates import render_email
    with connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""select i.* from public.worker_processing_incidents i
                cross join public.worker_processing_health_control c
                where c.email_enabled and i.recovered_at is null and i.notified_at is null
                  and (i.notification_lease_until is null or i.notification_lease_until < now())
                order by i.opened_at for update of i skip locked limit 1""")
            incident = cur.fetchone()
            if not incident:
                return False
            cur.execute("""update public.worker_processing_incidents
                set notification_lease_until=now()+interval '5 minutes',
                    notification_attempts=notification_attempts+1 where id=%s""", (incident['id'],))
    try:
        send(render_email(alert_message(incident)), idempotency_key='worker-processing/' + str(incident['id']))
    except Exception as exc:
        with connection:
            with connection.cursor() as cur:
                cur.execute('update public.worker_processing_incidents set notification_error=%s where id=%s',
                            (type(exc).__name__[:80], incident['id']))
        log.warning('processing alert delivery pending: %s', type(exc).__name__)
        return False
    with connection:
        with connection.cursor() as cur:
            cur.execute('update public.worker_processing_incidents set notified_at=now(),notification_error=null,notification_lease_until=null where id=%s',
                        (incident['id'],))
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true', help='Retry outcomes and refresh incidents once (the only mode).')
    parser.parse_args()
    import psycopg2
    logging.basicConfig(level=logging.INFO)
    database = os.environ.get('PONGLENS_DB_URL') or keychain('ponglens-db-url')
    connection = psycopg2.connect(database, connect_timeout=5,
        options='-c statement_timeout=10000 -c lock_timeout=2000')
    try:
        connection.autocommit = True
        flush_spool(database_sender(connection))
        connection.autocommit = False
        refresh(connection)
        with connection:
            with connection.cursor() as cur:
                cur.execute('select email_enabled from public.worker_processing_health_control where singleton')
                email_enabled = cur.fetchone()[0]
        if email_enabled:
            import worker as worker_mail
            def send(message, **kwargs):
                if not worker_mail.RESEND_API_KEY:
                    raise RuntimeError('email unavailable')
                return worker_mail.send_email(worker_mail.ADMIN_EMAIL, message, **kwargs)
            deliver_notifications(connection, send)
    finally:
        connection.close()


if __name__ == '__main__':
    main()
