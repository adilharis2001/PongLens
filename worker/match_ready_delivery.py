"""Quiet retries for the existing initial match-ready email, not new mail kinds.

The full provider payload is frozen before the first POST. Resend's 24-hour
deduplication window is bounded here to 23 hours, measured by the database.
The independent health monitor retries without waiting for media processing.
"""
import logging
from uuid import uuid4

from psycopg2 import errors
from psycopg2.extras import Json, RealDictCursor

log = logging.getLogger(__name__)


def managed(connection, job_id):
    """A captured row never falls back to the legacy sender, even if paused.

    Enabled capture manages only the primary kind that the trigger captures;
    legacy YouTube completions retain their existing sender.
    Missing migration retains the old behavior. Other database errors must
    propagate to the caller's nonfatal boundary, not trigger a duplicate.
    """
    try:
        with connection:
            with connection.cursor() as cur:
                cur.execute('''select exists(select 1 from public.match_ready_deliveries where job_id=%s)
                    or exists(select 1 from public.match_ready_delivery_control c
                        cross join public.jobs j
                        where c.singleton and c.enabled and j.id=%s and j.kind='deadspace_cut')''',
                    (job_id, job_id))
                return cur.fetchone()[0]
    except errors.UndefinedTable:
        return False


def _claim(connection, build_payload, job_id):
    with connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute('select enabled from public.match_ready_delivery_control where singleton')
            control = cur.fetchone()
            if not control or not control['enabled']:
                return None
            # Expire only a bounded set per monitor run. Never resurrect an
            # uncertain delivery once the provider may have forgotten its key.
            cur.execute('''update public.match_ready_deliveries set state='expired',lease_until=null
                where job_id in (select job_id from public.match_ready_deliveries
                  where state='pending' and (lease_until is null or lease_until<now())
                    and (first_attempt_at<=now()-interval '23 hours' or attempts>=24)
                  order by next_attempt_at limit 50 for update skip locked)''')
            cur.execute('''select * from public.match_ready_deliveries
                where state='pending' and next_attempt_at<=now()
                  and (lease_until is null or lease_until<now())
                  and (first_attempt_at is null or first_attempt_at>now()-interval '23 hours')
                  and attempts<24 and (%s::uuid is null or job_id=%s::uuid)
                order by next_attempt_at,created_at for update skip locked limit 1''', (job_id, job_id))
            item = cur.fetchone()
            if not item:
                return None
            value = item['payload']
            if value is None:
                value = build_payload(connection, str(item['job_id']), str(item['user_id']))
                if not value:
                    cur.execute("update public.match_ready_deliveries set state='unaddressed' where job_id=%s", (item['job_id'],))
                    return None
            token = str(uuid4())
            cur.execute('''update public.match_ready_deliveries
                set payload=%s,first_attempt_at=coalesce(first_attempt_at,now()),
                    attempts=attempts+1,lease_until=now()+interval '2 minutes',lease_token=%s
                where job_id=%s returning attempts''', (Json(value), token, item['job_id']))
            item.update(payload=value, lease_token=token, attempts=cur.fetchone()['attempts'])
            return item


def _finish(connection, item, state, provider_id=None, error=None):
    with connection:
        with connection.cursor() as cur:
            cur.execute('''update public.match_ready_deliveries set state=%s,
                provider_id=%s,last_error=%s,lease_until=null,lease_token=null,
                sent_at=case when %s='sent' then now() else sent_at end,
                next_attempt_at=now()+%s*interval '1 second'
                where job_id=%s and lease_token=%s and state='pending' ''',
                (state, provider_id, error, state,
                 min(3600, 60 * 2 ** min(item['attempts'], 6)),
                 item['job_id'], item['lease_token']))


def _may_send(connection, item):
    # Recheck after recipient lookup, which may have been slow. A retired
    # process cannot reuse a newer process's lease or an expired provider key.
    with connection:
        with connection.cursor() as cur:
            cur.execute('''select exists(select 1 from public.match_ready_deliveries d
                cross join public.match_ready_delivery_control c
                where c.singleton and c.enabled and d.job_id=%s and d.lease_token=%s
                  and d.state='pending' and d.lease_until>clock_timestamp()
                  and d.first_attempt_at>clock_timestamp()-interval '23 hours')''',
                (item['job_id'], item['lease_token']))
            return cur.fetchone()[0]


def deliver_one(connection, build_payload, send_payload, suppressed=lambda _address: False, *, job_id=None):
    """Deliver at most one due intent. Database/provider failures never escape.

    Only the provider transport is injected; real state and leases live in
    PostgreSQL. Suppression lookup retains the project's fail-open policy.
    """
    try:
        item = _claim(connection, build_payload, job_id)
        if not item:
            return False
        for address in item['payload']['to']:
            try:
                blocked = suppressed(address)
            except Exception:
                log.warning('Match-ready suppression lookup unavailable; preserving fail-open policy')
                blocked = False
            if blocked:
                _finish(connection, item, 'suppressed')
                return False
        if not _may_send(connection, item):
            return False
        try:
            provider_id = send_payload(item['payload'], 'match-ready/' + str(item['job_id']))
            if not provider_id:
                raise RuntimeError('Provider did not confirm a message ID')
        except Exception as exc:
            _finish(connection, item, 'pending', error=type(exc).__name__[:80])
            return False
        _finish(connection, item, 'sent', provider_id=str(provider_id))
        return True
    except Exception as exc:
        # The full exception can contain a credential or provider payload.
        log.warning('Match-ready delivery pending: %s', type(exc).__name__)
        return False
