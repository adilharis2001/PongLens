"""Separate gated recovery to the complete signed pre-switch launchers.

Run phases separately: drain, stop, restore, start, resume. No TCC changes,
re-signing, queue deletion, coverage/email changes, or unrelated lane edits.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

sys.dont_write_bytecode = True
APPS = Path('/Users/adil/Applications')


def configure(release):
    global a, r, saved, labels, old
    path = Path(__file__).with_name('activate.py')
    assert hashlib.sha256(path.read_bytes()).hexdigest() == ACTIVATION_SHA256
    spec = importlib.util.spec_from_file_location('guarded_activation', path)
    a = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(a)
    a.configure(release)
    r = a.r
    saved = r.BACKUP / 'failed-candidate'
    labels = [v[0] for v in r.LANES.values()] + [r.MONITOR]
    spec = importlib.util.spec_from_file_location('rollback_recipe', a.RECIPE)
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    old.RELEASE_ID = r.OLD_ID
    old.RELEASE = r.RELEASE.parent / r.OLD_ID
    old.STATE = a.OLD_STATE
    old.LANES = r.LANES


def backups():
    a.prepared()
    sys.path.insert(0, str(r.RELEASE / 'worker'))
    from match_release import verify
    verify(old.RELEASE, r.OLD_ID)
    for _, app, _ in r.LANES.values():
        r.run(['/usr/bin/codesign', '--verify', '--deep', '--strict',
               str(r.BACKUP / (app + '.app'))])


def mark(phase, **values):
    path = r.STAGING / ('rollback-' + phase + '.json')
    assert not path.exists(), 'Rollback phase already recorded; inspect before retrying'
    path.write_text(json.dumps({'release_id': r.RELEASE_ID, 'old_release_id': r.OLD_ID,
                               **values}, indent=2))


def phase(name):
    value = json.loads((r.STAGING / ('rollback-' + name + '.json')).read_text())
    assert (value['release_id'], value['old_release_id']) == (r.RELEASE_ID, r.OLD_ID)
    return value


def process_snapshot():
    output = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,lstart=,command='], text=True)
    return {int(p[0]): (int(p[1]), ' '.join(p[2:7]), p[7])
            for line in output.splitlines() if len(p := line.strip().split(None, 7)) == 8}


def eligible_processes(processes, pulses):
    """Accept only exact app trees; an actual worker always needs a fresh pulse."""
    allowed = {}
    for lane, (_, app, _) in r.LANES.items():
        command = str(APPS / (app + '.app/Contents/MacOS/applet'))
        roots = [pid for pid, (_, _, cmd) in processes.items() if cmd == command]
        assert len(roots) <= 1, 'Duplicate applet processes'
        if not roots:
            continue
        descendants = set(roots)
        while True:
            found = {pid for pid, (parent, _, _) in processes.items() if parent in descendants}
            if found <= descendants:
                break
            descendants |= found
        for pid in descendants:
            parent, started, cmd = processes[pid]
            if pid in roots:
                allowed[pid] = processes[pid]
                continue
            worker = str(r.RELEASE / 'worker/worker.py') + ' --lane ' + lane
            if worker in cmd:
                assert pulses.get('mac:' + lane) == (pid, None, 'drained',
                    'release ' + r.RELEASE_ID, True), 'Worker needs fresh drained pulse'
                assert not any(ppid == pid for ppid, _, _ in processes.values()), 'Worker has a child'
            else:
                assert ('prepare_run' in cmd and ' -c ' in cmd and str(r.RELEASE) in cmd
                        and str(r.STATE) in cmd and '/worker/worker.py' not in cmd), 'Unexpected applet child'
            allowed[pid] = processes[pid]
    # Fail closed on an orphaned or separately launched media worker/bootstrap.
    for pid, (_, _, cmd) in processes.items():
        media = str(r.RELEASE / 'worker/worker.py') in cmd
        bootstrap = 'prepare_run' in cmd and str(r.RELEASE) in cmd and str(r.STATE) in cmd
        monitor = (str(r.RELEASE / 'worker/processing_health.py') in cmd and
                   ('--once' in cmd or bootstrap))
        assert str(r.RELEASE.parent / r.OLD_ID / 'worker/worker.py') not in cmd, 'Old worker unexpectedly running'
        if monitor:
            assert not any(ppid == pid for ppid, _, _ in processes.values()), 'Monitor has an unexpected child'
            allowed[pid] = processes[pid]
        elif media or bootstrap or str(r.RELEASE) + '/' in cmd:
            assert pid in allowed, 'Candidate process outside checked applet tree'
    return allowed


def drain():
    backups()
    a.phase('stop')  # The original workers must have been safely stopped first.
    assert not (r.STAGING / 'rollback-drain.json').exists(), 'Rollback drain already attempted; inspect first'
    assert not any(str(old.RELEASE / 'worker/worker.py') in command
                   for _, _, command in process_snapshot().values()), 'Old worker is already running; inspect before rollback'
    for state in (r.STATE, old.STATE):
        for lane in r.LANES:
            (state / ('drain-' + lane)).touch(exist_ok=True)
    mark('drain')
    print('Candidate and rollback are paused. Existing candidate work must finish before stop.')


def stop():
    backups()
    phase('drain')
    assert all((state / ('drain-' + lane)).is_file()
               for state in (r.STATE, old.STATE) for lane in r.LANES)
    with r.connection() as conn:
        with conn.cursor() as cur:
            cur.execute('lock table pgmq.q_jobs,pgmq.q_jobs_fast in share mode')
            selected = eligible_processes(process_snapshot(), a.rows(conn))
            for label in labels:
                if r.loaded(label):
                    r.run(['/bin/launchctl', 'bootout', f'gui/{os.getuid()}/{label}'])
                    cur.execute('select 1')
            # launchctl may have exited the trees already. Recheck birth time,
            # command and ancestry before every remaining signal; never kill a reused PID.
            for pid, identity in selected.items():
                current = process_snapshot()
                if pid not in current:
                    continue
                assert current[pid][1:] == identity[1:], 'Process identity changed; inspect before signalling'
                assert not any(ppid == pid and child not in selected
                               for child, (ppid, _, _) in current.items()), 'New child appeared'
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                current = process_snapshot()
                if not any(pid in current for pid in selected):
                    break
                time.sleep(.2)
            assert not any(pid in process_snapshot() for pid in selected), 'Processes remain; do not restore'
    assert not any(r.loaded(label) for label in labels)
    mark('stop', pids=list(selected))
    print('Only checked candidate applet trees and monitor stopped. Ready to restore signed backups.')


def stopped():
    evidence = phase('stop')
    current = process_snapshot()
    assert not any(pid in current for pid in evidence['pids']), 'Recorded PID exists; inspect before proceeding'
    assert not any(r.loaded(label) for label in labels)
    assert not eligible_processes(current, {}), 'Candidate processes remain'


def bundle_fingerprint(root):
    return {str(p.relative_to(root)): ({'link': os.readlink(p)} if p.is_symlink() else
            {'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'mode': p.stat().st_mode & 0o7777})
            for p in root.rglob('*') if p.is_file() or p.is_symlink()}


def restored():
    for _, app, _ in r.LANES.values():
        target = APPS / (app + '.app')
        assert bundle_fingerprint(target) == bundle_fingerprint(r.BACKUP / target.name)
        r.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(target)])
    for label in labels:
        name = label + '.plist'
        assert (r.PLISTS / name).read_bytes() == (r.BACKUP / name).read_bytes()


def restore():
    backups()
    stopped()
    assert not saved.exists(), 'Restore already attempted; inspect partial state before retrying'
    saved.mkdir()
    for _, app, _ in r.LANES.values():
        target = APPS / (app + '.app')
        target.rename(saved / target.name)
        shutil.copytree(r.BACKUP / target.name, target, copy_function=shutil.copy2)
        r.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(target)])
    for label in labels:
        name = label + '.plist'
        shutil.copy2(r.PLISTS / name, saved / name)
        shutil.copy2(r.BACKUP / name, r.PLISTS / name)
    restored()
    mark('restore')
    print('Both complete original signed apps and all three launchers restored. Not started.')


def start():
    backups()
    phase('restore')
    stopped()
    restored()
    mark('start', started_at=datetime.now(timezone.utc).isoformat())
    old.start()
    print('Rollback started paused. Fresh exact old-release pulses and a new monitor run are required.')


def resume():
    started = datetime.fromisoformat(phase('start')['started_at'])
    with r.connection(True) as conn:
        a.dependencies(conn)
        with conn.cursor() as cur:
            cur.execute("select worker_id,pid,job_id,stage,code_version,beat_at,"
                        "now()-beat_at<interval '45 seconds' from public.worker_pulse "
                        "where worker_id in ('mac:main','mac:fast')")
            pulses = {row[0]: row[1:] for row in cur.fetchall()}
            current = process_snapshot()
            for lane in r.LANES:
                pid, job, stage, version, beat, fresh = pulses['mac:' + lane]
                assert (job, stage, version, fresh) == (None, 'drained', 'release ' + r.OLD_ID, True)
                assert beat >= started, 'Rollback pulse predates startup'
                assert str(old.RELEASE / 'worker/worker.py') + ' --lane ' + lane in current[pid][2]
                assert not any(parent == pid for parent, _, _ in current.values()), 'Rollback worker has a child'
            cur.execute('select monitor_at from public.worker_processing_health_control')
            assert cur.fetchone()[0] >= started, 'Restored monitor must complete after startup'
    old.resume()


ACTIVATION_SHA256 = 'd9dbba619b5185bbe1838efe9e3a385a10c9650e3d27f6f414ac6f3ec6dbe0c4'
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['drain', 'stop', 'restore', 'start', 'resume'])
    parser.add_argument('--release', required=True, help='Full failed candidate release ID')
    args = parser.parse_args()
    configure(args.release)
    {'drain': drain, 'stop': stop, 'restore': restore, 'start': start, 'resume': resume}[args.mode]()
