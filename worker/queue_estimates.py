"""Bounded, private queue projection. Never imports media code or claims work.

The September 13 baseline spans releases; it is not calibrated to the active
release. FPS above 30 widens only the upper bound, provisionally through 60.
These empirical ranges are estimates, not guaranteed service bounds.
"""
from datetime import datetime, timedelta, timezone
import json
import math

BASELINE = 'recent_baseline_20260913'
EXTRAPOLATED = 'recent_baseline_extrapolated'


def stamp(value):
    if isinstance(value, datetime):
        result = value
    else:
        try:
            result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            # Python 3.9 accepts only 3/6 fractional digits in fromisoformat;
            # PostgreSQL omits trailing zeros, so valid JSON may have 1–5.
            result = datetime.strptime(value, '%Y-%m-%dT%H:%M:%S.%f%z')
    if result.tzinfo is None:
        raise ValueError('Queue evidence requires a timezone')
    return result.astimezone(timezone.utc)


def number(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def workload(job, lane, pipeline):
    """Return READY, occupancy, tail bounds and provenance, or unknown.

    Effective profiles are already trimmed. Verified source metadata and
    linked original profiles are trimmed here exactly once.
    """
    if lane != 'main':
        return None
    kind, options = job['kind'], job.get('options') or {}
    fixed = {'content_check': (7.1, 38), 'placement_generate': (933, 1009)}
    if kind == 'reel' and not str(options.get('scope', '')).startswith('v:'):
        fixed[kind] = (48, 100.2)
    if kind in fixed:
        low, high = fixed[kind]
        return (low / 1.25, high * 1.25), (low / 1.25, high * 1.25), None, BASELINE
    if kind not in ('deadspace_cut', 'youtube_import'):
        return None
    profile = job.get('profile') or {}
    if profile:
        duration, fps, route = profile.get('duration_s'), profile.get('fps'), profile.get('route')
    else:
        if kind == 'youtube_import':
            return None  # Download duration is unknown until effective profile.
        source = job if job.get('source_metadata_verified_at') else job.get('source') or {}
        duration, fps = source.get('source_duration_s'), source.get('source_fps')
        if not source.get('source_metadata_verified_at'):
            duration = fps = None
        override = options.get('points_pipeline')
        selected = override if override in ('v1','v2','bodies') else pipeline
        route = selected + ':no-placement' if selected and options.get('points') is True and not options.get('placement') else None
        if number(duration):
            start, end = options.get('trim_start_s', 0), options.get('trim_end_s', duration)
            if start is None:
                start = 0
            if end is None:
                end = duration
            if (not isinstance(start, (int,float)) or isinstance(start,bool) or not math.isfinite(start)
                    or not number(end) or not 0 <= start < end <= duration):
                return None
            duration = end - start
    if route != 'bodies:no-placement' or not number(duration) or not number(fps) or not 29 <= fps <= 60:
        return None
    factor = max(1, fps / 30)
    basis = EXTRAPOLATED if fps > 30 else BASELINE
    return ((.89 * duration, 2.40 * duration * factor),
            (1.03 * duration, 2.55 * duration * factor),
            (.077 / 1.25 * duration, .185 * 1.25 * duration * factor), basis)


def estimate(snapshot):
    """Interval FIFO simulation, at most 256 queued messages per lane.

    At each next claim, low/high capacity scenarios must select the same
    visible message. Otherwise stop with explicit order uncertainty. This
    avoids claiming the two extreme simulations bound all middle orderings.
    """
    now = stamp(snapshot['observed_at'])
    output = {}

    def result(state='unknown', reason=None, start=None, ready=None, basis=BASELINE):
        def iso(value):
            return value.isoformat() if value is not None else None
        return dict(state=state, reason=reason, observed_at=now.isoformat(),
                    expires_at=(now+timedelta(seconds=90)).isoformat(), basis=basis,
                    start_earliest_at=iso(start[0]) if start else None,
                    start_latest_at=iso(start[1]) if start else None,
                    ready_earliest_at=iso(ready[0]) if ready else None,
                    ready_latest_at=iso(ready[1]) if ready else None)

    for lane in snapshot['lanes']:
        active = lane.get('active')
        events = (active or {}).get('events') or {}
        bad_receipts = any(stamp(value)>now or (events.get('claimed') and stamp(value)<stamp(events['claimed']))
                           for value in events.values())
        closed = bool(events.get('released') or events.get('failed'))
        if closed and not bad_receipts:
            active = None
        pending = [m for m in lane.get('messages', []) if m.get('job') and
                   m['job']['status'] not in ('done','cancelled') and
                   m.get('read_ct', 0) < 2 and not m['job'].get('terminal') and
                   (not active or m['job']['id'] != active['id'])]
        targets = [m['job'] for m in pending] + ([active] if active and active['status'] not in ('done','cancelled') else [])
        failure = None
        pulse = lane.get('pulse') or {}
        if lane['availability'] != 'available':
            failure = 'service_' + lane['availability']
        elif lane.get('overflow'):
            failure = 'queue_overflow'
        elif (not pulse.get('beat_at') or stamp(pulse['beat_at']) < now-timedelta(seconds=90)
              or stamp(pulse['beat_at']) > now+timedelta(seconds=5)
              or lane.get('contradictory') or bad_receipts or any(m['job']['status']=='processing' for m in pending)
              or (pulse.get('job_id') and not lane.get('active'))):
            failure = 'active_evidence_missing'
        elif pulse.get('stage') in ('drained','release_invalid','paused'):
            failure = 'service_unavailable'
        low = high = now
        basis = BASELINE
        if not failure and active:
            work = workload(active,lane['lane'],snapshot.get('points_pipeline'))
            claimed = events.get('claimed')
            if (not claimed or stamp(claimed) > now
                    or active.get('receipt_lane',lane['lane']) != lane['lane']):
                failure = 'active_evidence_missing'
            elif not work:
                failure = 'unsupported_work_ahead'
                if active['status'] not in ('done','cancelled'):
                    output[active['id']] = result(reason='unsupported_workload')
            else:
                ready, occupancy, tail, basis = work
                anchor = stamp(claimed)
                if active['status'] not in ('done','cancelled'):
                    deadline = anchor+timedelta(seconds=ready[1])
                    output[active['id']] = (result('overdue','ready_overdue',basis=basis) if deadline < now else
                        result('range',start=(anchor,anchor),ready=(max(now,anchor+timedelta(seconds=ready[0])),deadline),basis=basis))
                if events.get('ready'):
                    if not tail or not anchor <= stamp(events['ready']) <= now:
                        failure = 'active_evidence_missing'
                    else:
                        anchor, occupancy = stamp(events['ready']), tail
                elif active['status']=='done':
                    failure = 'active_evidence_missing'
                if not failure:
                    low, high = (anchor+timedelta(seconds=t) for t in occupancy)
                    if high < now:
                        failure = 'active_overdue'
                    low, high = max(now,low), max(now,high)
        if failure:
            for row in targets:
                if row['id'] not in output:
                    output[row['id']] = result(reason=failure)
            continue
        while pending:
            def next_at(at):
                at = max(at, min(stamp(m['vt']) for m in pending))
                chosen = min((m for m in pending if stamp(m['vt'])<=at),key=lambda m:m['msg_id'])
                return chosen, at
            first, low_start = next_at(low)
            last, high_start = next_at(high)
            # No invisible lower-ID message may become eligible inside this
            # interval. Equal endpoints therefore imply a stable ordering.
            if first['msg_id'] != last['msg_id']:
                failure = 'queue_order_uncertain'
                break
            row=first['job']
            pending.remove(first)
            work=workload(row,lane['lane'],snapshot.get('points_pipeline'))
            if work is None:
                output[row['id']]=result('queue_only','unsupported_workload',start=(low_start,high_start),basis=basis)
                failure='unsupported_work_ahead'
                break
            ready, occupancy, _, own_basis=work
            if own_basis==EXTRAPOLATED:
                basis=EXTRAPOLATED
            output[row['id']]=result('range',start=(low_start,high_start),
                ready=(low_start+timedelta(seconds=ready[0]),high_start+timedelta(seconds=ready[1])),basis=basis)
            low,high=low_start+timedelta(seconds=occupancy[0]),high_start+timedelta(seconds=occupancy[1])
        if failure:
            for message in pending:
                output[message['job']['id']]=result(reason=failure,basis=basis)
    return output


def refresh(connection):
    """One DB snapshot, one bounded calculation, one atomic cache replacement."""
    with connection:
        with connection.cursor() as cur:
            cur.execute('select pg_try_advisory_xact_lock(9171306200)')
            if not cur.fetchone()[0]:
                return
            cur.execute('select public.processing_estimate_snapshot()')
            snapshot=cur.fetchone()[0]
            rows=estimate(snapshot)
            lanes={m['job']['id']: lane['lane'] for lane in snapshot['lanes']
                   for m in lane['messages'] if m.get('job')}
            lanes.update({lane['active']['id']:lane['lane'] for lane in snapshot['lanes'] if lane.get('active')})
            batch={key:dict(lane=lanes[key],estimate=value) for key,value in rows.items()}
            cur.execute('select public.store_processing_estimates(%s::jsonb,%s::timestamptz)',
                        (json.dumps(batch,allow_nan=False),snapshot['observed_at']))
