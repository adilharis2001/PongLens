"""Guarded-openings main/fast/monitor switch from the combined release.

Every command is separate. Prepare does not pause live workers; drain does
not interrupt a job. Stop refuses unless both workers are freshly drained.
No schema, queue message, scored match, health preference or other lane edit.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone

sys.dont_write_bytecode = True
RECIPE = Path('/private/tmp/ponglens-cache-fix-rollout.py')
assert hashlib.sha256(RECIPE.read_bytes()).hexdigest() == 'eb4d6a4af4071fe10e0f5142d06f6ef9b6111fb4d13ade2d094725ce2fb84e32'
spec = importlib.util.spec_from_file_location('recipe', RECIPE)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
def configure(release):
    global OLD_STATE
    assert len(release) == 64 and all(c in '0123456789abcdef' for c in release)
    assert release != r.RELEASE_ID
    r.OLD_ID = '7bc22c834fd237f866cc957fc17967524c43aa469d31e3e812854b0c59697576'
    assert release != r.OLD_ID
    r.RELEASE_ID = release
    r.RELEASE = r.RELEASE.parent / release
    r.STATE = r.STATE.parent / release
    r.STAGING = Path('/private/tmp') / ('ponglens-guarded-launchers-' + release[:12])
    r.BACKUP = r.BACKUP.parent / ('20260912-guarded-' + release[:12])
    r.LANES = {'main': ('com.adil.ponglens-worker', 'PongLensWorker', 0),
               'fast': ('com.adil.ponglens-worker-fast', 'PongLensWorkerFast', 0)}
    OLD_STATE = r.STATE.parent / r.OLD_ID


def rows(conn):
    with conn.cursor() as cur:
        cur.execute("select worker_id,pid,job_id,stage,code_version,now()-beat_at<interval '45 seconds' "
                    "from public.worker_pulse where worker_id in ('mac:main','mac:fast')")
        return {row[0]: row[1:] for row in cur.fetchall()}


def dependencies(conn):
    with conn.cursor() as cur:
        cur.execute("select to_regprocedure('public.record_match_processing_event(jsonb)') is not null, "
                    "to_regprocedure('public.record_match_video_check(uuid,uuid,double precision,double precision,jsonb)') is not null, "
                    "to_regprocedure('public.my_match_processing_feedback(uuid[])') is not null")
        assert cur.fetchone() == (True, True, True), 'Upload feedback migration is not ready'


def preparation_files():
    """Fingerprint the complete recovery set and every staged launcher."""
    files = {}
    def record(path):
        assert path.is_file() or path.is_symlink(), 'Missing preparation artifact: ' + str(path)
        files[str(path)] = ({'symlink': os.readlink(path)} if path.is_symlink() else
                            {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                             'mode': path.stat().st_mode & 0o7777})
    for lane, (label, app, _) in r.LANES.items():
        bundle = r.BACKUP / (app + '.app')
        assert bundle.is_dir() and not bundle.is_symlink(), 'Missing whole app backup'
        for path in sorted(bundle.rglob('*')):
            if path.is_file() or path.is_symlink():
                record(path)
        assert (bundle / 'Contents/Resources/Scripts/main.scpt').is_file()
        assert (bundle / 'Contents/MacOS/applet').is_file()
        record(r.STAGING / (lane + '.scpt'))
        for root in (r.BACKUP, r.STAGING):
            record(root / (label + '.plist'))
    for root in (r.BACKUP, r.STAGING):
        record(root / (r.MONITOR + '.plist'))
    return files


def prepared():
    evidence = phase('prepare')
    assert evidence.get('files') == preparation_files(), 'Preparation or rollback artifacts changed'
    return evidence


def prepare():
    assert r.RELEASE.is_dir()
    # Never adapt a launcher that was independently switched by another task.
    for _, app, _ in r.LANES.values():
        script = Path('/Users/adil/Applications') / (app + '.app/Contents/Resources/Scripts/main.scpt')
        source = subprocess.check_output(['/usr/bin/osadecompile', str(script)], text=True)
        assert r.OLD_ID in source and str(OLD_STATE) in source
    sys.path.insert(0, str(r.RELEASE / 'worker'))
    from match_release import verify
    verify(r.RELEASE.parent / r.OLD_ID, r.OLD_ID)
    r.prepare()
    for _, app, _ in r.LANES.values():
        bundle = r.BACKUP / (app + '.app')
        r.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(bundle)])
        source = subprocess.check_output(['/usr/bin/osadecompile', str(
            bundle / 'Contents/Resources/Scripts/main.scpt')], text=True)
        assert r.OLD_ID in source and str(OLD_STATE) in source
    monitor_backup = r.plistlib.loads((r.BACKUP / (r.MONITOR + '.plist')).read_bytes())
    assert monitor_backup['ProgramArguments'] == [
        part.replace(r.RELEASE_ID, r.OLD_ID) for part in r.bootstrap('main', True)]
    assert monitor_backup.get('ProcessType') != 'Background'
    evidence = {'release_id': r.RELEASE_ID, 'old_release_id': r.OLD_ID,
                'files': preparation_files()}
    marker = r.STAGING / 'prepare-complete.json'
    assert not marker.exists(), 'Preparation already completed'
    marker.write_text(json.dumps(evidence, indent=2))
    print('Prepared new launchers and verified backups; live workers unchanged.')


def drain():
    prepared()
    assert (r.BACKUP / 'PongLensWorker.app').is_dir()
    assert all((r.STATE / ('drain-' + lane)).exists() for lane in r.LANES)
    with r.connection(True) as conn:
        dependencies(conn)
        current = rows(conn)
        assert all(current['mac:' + lane][3] == 'release ' + r.OLD_ID
                   and current['mac:' + lane][4] for lane in r.LANES), current
    for lane in r.LANES:
        (OLD_STATE / ('drain-' + lane)).touch(exist_ok=False)
    print('Both old-release drain files created. Running jobs may finish; no process stopped.')


def stop():
    prepared()
    assert all((r.STATE / ('drain-' + lane)).exists() and
               (OLD_STATE / ('drain-' + lane)).exists() for lane in r.LANES)
    # The queue lock closes the claim race, and all process identities are
    # resolved from fresh pulses while this barrier is held.
    with r.connection() as conn:
        dependencies(conn)
        with conn.cursor() as cur:
            cur.execute('lock table pgmq.q_jobs,pgmq.q_jobs_fast in share mode')
            current = rows(conn)
            ps = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,lstart=,command='], text=True)
            identities = {int(parts[0]): (int(parts[1]), ' '.join(parts[2:7]), parts[7])
                          for line in ps.splitlines() if len(parts := line.strip().split(None, 7)) == 8}
            processes = {pid: (value[0], value[2]) for pid, value in identities.items()}
            validated = []
            for lane, (_, app, _) in r.LANES.items():
                pid, job, stage, version, fresh = current['mac:' + lane]
                assert (job, stage, version, fresh) == (None, 'drained', 'release ' + r.OLD_ID, True), current
                parent, command = processes[pid]
                assert r.OLD_ID + '/worker/worker.py --lane ' + lane in command
                app_pid = processes[parent][0]
                assert processes[app_pid][1] == '/Users/adil/Applications/' + app + '.app/Contents/MacOS/applet'
                assert not any(ppid == pid for ppid, _ in processes.values()), 'Worker has active child'
                validated.extend([pid, parent, app_pid])
            (r.STAGING / 'stopped-processes.json').write_text(json.dumps(current, indent=2))
            for label in [x[0] for x in r.LANES.values()] + [r.MONITOR]:
                r.run(['/bin/launchctl', 'bootout', f'gui/{os.getuid()}/{label}'])
                cur.execute('select 1')
            for pid in validated:
                latest = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,lstart=,command='], text=True)
                current_processes = {int(parts[0]): (int(parts[1]), ' '.join(parts[2:7]), parts[7])
                    for line in latest.splitlines() if len(parts := line.strip().split(None, 7)) == 8}
                if pid not in current_processes:
                    continue
                assert current_processes[pid][1:] == identities[pid][1:], 'PID identity changed; inspect before signalling'
                assert not any(parent == pid and child not in validated
                    for child, (parent, _, _) in current_processes.items()), 'New child appeared'
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            deadline = time.monotonic() + 8
            alive = validated
            while time.monotonic() < deadline:
                alive = []
                for pid in validated:
                    try:
                        os.kill(pid, 0)
                        alive.append(pid)
                    except ProcessLookupError:
                        pass
                if not alive:
                    break
                time.sleep(.2)
            assert not alive, ('Do not install/start; processes remain', alive)
    print('Only drained main/fast and their monitor stopped. Queue messages preserved.')
    (r.STAGING / 'stop-complete.json').write_text(json.dumps({
        'release_id': r.RELEASE_ID, 'old_release_id': r.OLD_ID, 'pids': validated}))


def phase(name):
    path = r.STAGING / (name + '-complete.json')
    assert path.is_file(), name + ' has not completed'
    value = json.loads(path.read_text())
    assert value.get('release_id') == r.RELEASE_ID and value.get('old_release_id') == r.OLD_ID
    return value


def stopped():
    evidence = phase('stop')
    assert evidence.get('pids'), 'Missing stopped process identities'
    for pid in evidence['pids']:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            continue
        raise AssertionError('A recorded old PID exists; inspect before proceeding')
    assert not any(r.loaded(label) for label in [x[0] for x in r.LANES.values()] + [r.MONITOR])


def installed():
    for lane, (label, app, _) in r.LANES.items():
        target = Path('/Users/adil/Applications') / (app + '.app/Contents/Resources/Scripts/main.scpt')
        source = subprocess.check_output(['/usr/bin/osadecompile', str(target)], text=True)
        expected = subprocess.check_output(['/usr/bin/osadecompile', str(r.STAGING / (lane + '.scpt'))], text=True)
        assert source == expected and r.RELEASE_ID in source and str(r.STATE) in source and r.OLD_ID not in source
        assert (r.PLISTS / (label + '.plist')).read_bytes() == (r.STAGING / (label + '.plist')).read_bytes()
    monitor = r.PLISTS / (r.MONITOR + '.plist')
    assert monitor.read_bytes() == (r.STAGING / monitor.name).read_bytes()
    settings = r.plistlib.loads(monitor.read_bytes())
    assert settings['ProgramArguments'] == r.bootstrap('main', True)
    assert settings.get('ProcessType') != 'Background'


def install():
    prepared()
    stopped()
    assert not (r.STAGING / 'install-complete.json').exists(), 'Install already completed; inspect instead of overwriting'
    r.install()
    installed()
    (r.STAGING / 'install-complete.json').write_text(json.dumps({
        'release_id': r.RELEASE_ID, 'old_release_id': r.OLD_ID,
        'installed_launchers_match': True}))


def start():
    assert phase('install').get('installed_launchers_match') is True
    stopped()
    installed()
    started = datetime.now(timezone.utc).isoformat()
    (r.STAGING / 'started-at.txt').write_text(started)
    r.start()


def resume():
    started = datetime.fromisoformat((r.STAGING / 'started-at.txt').read_text())
    with r.connection(True) as conn:
        dependencies(conn)
        with conn.cursor() as cur:
            cur.execute('select monitor_at from public.worker_processing_health_control')
            assert cur.fetchone()[0] >= started, 'New monitor has not completed a run yet'
    # The original recipe verifies fresh drained pulses and exact new IDs.
    r.resume()


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('mode', choices=['prepare', 'drain', 'stop', 'install', 'start', 'resume', 'status'])
    ap.add_argument('--release', required=True)
    args = ap.parse_args()
    configure(args.release)
    {'prepare': prepare, 'drain': drain, 'stop': stop, 'install': install,
     'start': start, 'resume': resume, 'status': r.status}[args.mode]()
