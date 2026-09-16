"""Run the sealed match worker lanes inside one cloud container, and stop.

The worker itself is the untouched sealed release: the same `worker.py`, the
same models, the same settings the Mac Studio runs. This module only does
what launchd does on the Mac (start a process per lane) plus the three
things a cloud container needs that a Mac does not:

1. identity: the processes pulse as `modal:main` and `modal:fast` with host
   `modal`, so /admin/processing can tell the two machines apart;
2. housekeeping stays on the Mac: the retention sweep, the digests and the
   cost monitor must run in exactly one process, and that one is the Mac's
   main lane;
3. leaving: the container watches the database policy and its own idleness
   and goes away when the Mac is back or there is nothing left to do.

It also keeps the cloud's claim on a job alive. The Mac worker reads a queue
message with a thirty-minute visibility window and never extends it, which
is harmless with one worker and a race with two: after thirty minutes a job
the cloud is still processing would reappear to a returning Mac. While a
cloud lane reports a job, its message's window is pushed out every minute.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import timedelta
from pathlib import Path

import psycopg2
import psycopg2.extras

RELEASE_ROOT = '/opt/ponglens/releases'
CURRENT_FILE = '/opt/ponglens/current-release-id'
SHIM_DIR = '/opt/ponglens/shims'
PYTHON_SHIM = '/opt/ponglens/cloud_release/shim'
STATE_DIR = Path(os.environ.get('PONGLENS_CLOUD_STATE', '/tmp/ponglens-state'))

LANES = {'main': 'jobs', 'fast': 'jobs_fast'}
TICK_S = 20
DECISION_EVERY_S = 60
LEASE_EXTEND_S = 1800
IDLE_STOP_S = int(os.environ.get('PONGLENS_CLOUD_IDLE_STOP_S', '600'))
SOFT_DEADLINE_S = int(os.environ.get('PONGLENS_CLOUD_SOFT_DEADLINE_S', str(5 * 3600 + 30 * 60)))
MAC_ALIVE_S = 120
MAX_RESTARTS = 3


def say(*parts):
    print(time.strftime('%H:%M:%S'), 'supervisor:', *parts, flush=True)


def release_dir() -> Path:
    release_id = Path(CURRENT_FILE).read_text().strip()
    return Path(RELEASE_ROOT) / release_id


def read_manifest(release: Path) -> dict:
    return json.loads((release / 'manifest.json').read_text())


def connect():
    connection = psycopg2.connect(os.environ['DATABASE_URL'], connect_timeout=15)
    connection.autocommit = True
    return connection


def decision(connection) -> dict:
    # Ask, do not claim: only the dispatcher's own call may stamp a session
    # start, or this poll re-opens the start-up grace every time it runs
    # (migration 20260916185815).
    with connection.cursor() as cursor:
        cursor.execute('select public.cloud_worker_decision(false)')
        return cursor.fetchone()[0]


def session_event(connection, event: str, note: str | None = None) -> None:
    with connection.cursor() as cursor:
        cursor.execute('select public.cloud_worker_session(%s, %s)', (event, note))


def pulse(connection, worker_id: str) -> dict | None:
    with connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
        cursor.execute(
            'select job_id, job_kind, stage, beat_at, now() as db_now '
            'from public.worker_pulse where worker_id = %s', (worker_id,))
        return cursor.fetchone()


def extend_leases(connection, lanes) -> None:
    """Push out the visibility window of every message any lane is on.

    Both machines' lanes, not only the cloud's: while a cloud session is
    alive it protects the Mac's held jobs too, so a Mac job that runs past
    thirty minutes cannot reappear to this container. The Mac worker will
    do this for itself from the next sealed release; until then the cloud
    is the one that knows both sides.
    """
    for lane, queue in lanes.items():
        for host in ('modal', 'mac'):
            row = pulse(connection, f'{host}:{lane}')
            if not row or not row['job_id']:
                continue
            if row['beat_at'] < row['db_now'] - timedelta(seconds=MAC_ALIVE_S):
                continue  # a stale pulse holds nothing
            with connection.cursor() as cursor:
                cursor.execute(
                    f"select msg_id from pgmq.q_{queue} where message->>'job_id' = %s",
                    (str(row['job_id']),))
                for (msg_id,) in cursor.fetchall():
                    cursor.execute('select pgmq.set_vt(%s, %s, %s)', (queue, msg_id, LEASE_EXTEND_S))


def launch(lane: str, release: Path, label: str):
    import match_release
    from stable_release import stabilize
    stabilize(match_release)
    command, env, cwd = match_release.prepare_run(release, STATE_DIR, lane)
    env['PATH'] = SHIM_DIR + ':' + env['PATH']
    env['PYTHONPATH'] = PYTHON_SHIM + ':' + env['PYTHONPATH']
    # The sealed worker, started the way launchd starts it on the Mac, with
    # its identity and its housekeeping set from outside the sealed source.
    # Every name patched here is a module global the worker reads at call
    # time; nothing inside the release changes.
    code = (
        'import sys; sys.argv = ["worker.py", "--lane", %r]; import worker; '
        'worker.WORKER_ID = %r; worker.WORKER_HOST = "modal"; '
        'worker._code_version = lambda: %r; '
        'worker.retention_sweep = lambda conn: None; '
        'worker.maybe_send_feedback_digest = lambda conn: None; '
        'worker.maybe_send_qa_closed_digest = lambda conn: None; '
        'worker.start_cost_alert_monitor = lambda: None; '
        'worker.main()'
    ) % (lane, 'modal:' + lane, label)
    log_path = STATE_DIR / 'logs' / f'launcher-{lane}.log'
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(log_path, 'ab')
    process = subprocess.Popen([command[0], '-c', code], env=env, cwd=cwd,
                               stdout=handle, stderr=subprocess.STDOUT)
    say(f'{lane} lane started, pid {process.pid}')
    return process


def follow(path: Path, prefix: str, stop: threading.Event) -> None:
    """Copy a worker log into the container's stdout so Modal keeps it."""
    position = 0
    while not stop.is_set():
        try:
            if path.exists():
                with path.open('rb') as handle:
                    handle.seek(position)
                    chunk = handle.read()
                    position = handle.tell()
                for line in chunk.decode('utf-8', 'replace').splitlines():
                    print(prefix, line, flush=True)
        except Exception as error:  # noqa: BLE001
            print(prefix, 'log follow failed:', error, flush=True)
        stop.wait(5)


def drain_files(lanes) -> None:
    for lane in lanes:
        (STATE_DIR / f'drain-{lane}').touch()


def stop_processes(processes: dict) -> None:
    for lane, process in processes.items():
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
    deadline = time.time() + 30
    for lane, process in processes.items():
        while process.poll() is None and time.time() < deadline:
            time.sleep(1)
        if process.poll() is None:
            say(f'{lane} lane did not stop on SIGINT, killing')
            process.kill()
    say('lanes stopped:', {lane: process.poll() for lane, process in processes.items()})


def run(reason: str = 'manual') -> dict:
    started = time.time()
    release = release_dir()
    manifest = read_manifest(release)
    sys.path.insert(0, str(release / 'worker'))
    label = f"release {manifest['mac_release_id']} cloud {manifest['release_id'][:12]}"
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    for lane in LANES:
        drain = STATE_DIR / f'drain-{lane}'
        if drain.exists():
            drain.unlink()

    connection = connect()
    current = decision(connection)
    say('start requested:', reason, '| policy now:', json.dumps(current, default=str))
    if current.get('mode') == 'disabled':
        say('cloud is switched off; not starting')
        return {'started': False, 'reason': 'disabled'}
    if current.get('mode') == 'automatic' and current.get('mac_alive'):
        say('the Mac is reporting again; not starting')
        return {'started': False, 'reason': 'mac_alive'}
    session_event(connection, 'started', reason)

    stop = threading.Event()
    followers = []
    for lane in LANES:
        name = 'worker-fast.log' if lane == 'fast' else 'worker.log'
        thread = threading.Thread(target=follow, args=(STATE_DIR / 'logs' / name, f'[{lane}]', stop), daemon=True)
        thread.start()
        followers.append(thread)

    processes = {lane: launch(lane, release, label) for lane in LANES}
    restarts = {lane: 0 for lane in LANES}
    idle_since = time.time()
    last_decision = time.time()
    outcome = 'unknown'
    stopping = False
    try:
        while True:
            time.sleep(TICK_S)
            try:
                extend_leases(connection, LANES)
                pulses = {lane: pulse(connection, 'modal:' + lane) for lane in LANES}
            except psycopg2.Error as error:
                say('database hiccup:', error)
                try:
                    connection.close()
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(10)
                connection = connect()
                continue
            busy = any(row and row['job_id'] for row in pulses.values())
            if busy:
                idle_since = time.time()

            for lane, process in list(processes.items()):
                if process.poll() is not None and not stopping:
                    restarts[lane] += 1
                    say(f'{lane} lane exited with {process.returncode}, restart {restarts[lane]}')
                    if restarts[lane] > MAX_RESTARTS:
                        outcome = f'{lane}_lane_failing'
                        stopping = True
                        drain_files(LANES)
                    else:
                        time.sleep(10)
                        processes[lane] = launch(lane, release, label)

            if time.time() - last_decision >= DECISION_EVERY_S:
                last_decision = time.time()
                current = decision(connection)
                mode = current.get('mode')
                if mode == 'disabled':
                    want_stop, why = True, 'switched off'
                elif mode == 'automatic' and current.get('mac_alive'):
                    want_stop, why = True, 'the Mac is reporting again'
                elif time.time() - started > SOFT_DEADLINE_S:
                    want_stop, why = True, 'session time limit'
                elif time.time() - idle_since > IDLE_STOP_S:
                    want_stop, why = True, f'idle for {IDLE_STOP_S // 60} minutes'
                else:
                    want_stop, why = False, ''
                if want_stop and not stopping:
                    say('stopping after the current job:', why)
                    stopping = True
                    outcome = why
                    drain_files(LANES)

            if stopping and not busy:
                say('lanes idle, stopping now')
                break
    finally:
        stop.set()
        stop_processes(processes)
        try:
            session_event(connection, 'ended', outcome)
        except Exception as error:  # noqa: BLE001
            say('could not record session end:', error)
        try:
            connection.close()
        except Exception:  # noqa: BLE001
            pass
    return {'started': True, 'outcome': outcome, 'seconds': round(time.time() - started)}
