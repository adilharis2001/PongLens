"""Scoped correction of the two blocked match workers and their monitor."""
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import signal
import subprocess
import sys
import time

# This bootstrap itself imports the sealed runner before prepare_run can
# apply the child environment. Do not generate bytecode inside that source.
sys.dont_write_bytecode = True

OLD_ID = 'c9c012af733163130a87b4cb17612ec5fa2798e26ec83392f240fcbe296b07e9'
RELEASE_ID = 'beb02a6c1002577ec521d2dce12916cdd9f8cbba3dbd640ea7dec7014c3bcf9b'
RELEASE = Path('/Users/adil/Library/Application Support/PongLens/match-releases') / RELEASE_ID
STATE = Path('/Users/adil/Library/Caches/PongLens/match-runtime') / RELEASE_ID
STAGING = Path('/private/tmp/ponglens-cache-fix-launchers')
BACKUP = Path('/Users/adil/Library/Application Support/PongLens/launcher-backups/20260911-model-cache-correction')
PLISTS = Path('/Users/adil/Library/LaunchAgents')
PYTHON = '/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python'
LANES = {'main': ('com.adil.ponglens-worker', 'PongLensWorker', 64716),
         'fast': ('com.adil.ponglens-worker-fast', 'PongLensWorkerFast', 64714)}
MONITOR = 'com.adil.ponglens-processing-health'

def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, timeout=30, **kwargs)

def connection(readonly=False):
    import psycopg2
    dsn = subprocess.check_output(['security', 'find-generic-password', '-a', 'openclaw', '-s', 'ponglens-db-url', '-w'], text=True, stderr=subprocess.DEVNULL).strip()
    opts = '-c lock_timeout=3000 -c statement_timeout=5000 -c idle_in_transaction_session_timeout=30000'
    if readonly:
        opts += ' -c default_transaction_read_only=on'
    return psycopg2.connect(dsn, connect_timeout=5, options=opts)

def bootstrap(lane, monitor=False):
    code = (f'import sys,os;sys.path.insert(0,{str(RELEASE / "worker")!r});'
            f'from match_release import prepare_run;c,e,d=prepare_run({str(RELEASE)!r},{str(STATE)!r},{lane!r});')
    if monitor:
        code += f'c=[c[0],{str(RELEASE / "worker/processing_health.py")!r},"--once"];'
    return [PYTHON, '-I', '-B', '-c', code + 'os.chdir(d);os.execve(c[0],c,e)']

def loaded(label):
    # Never expose launchctl's environment, which may contain credentials.
    return subprocess.run(['/bin/launchctl', 'print', f'gui/{os.getuid()}/{label}'], capture_output=True).returncode == 0

def prepare():
    sys.path.insert(0, str(RELEASE / 'worker'))
    from match_release import verify, prepare_run
    verify(RELEASE, RELEASE_ID)
    STAGING.mkdir(exist_ok=True)
    BACKUP.mkdir(parents=True, exist_ok=False)
    for lane, (label, app, _) in LANES.items():
        app_path = Path('/Users/adil/Applications') / (app + '.app')
        shutil.copytree(app_path, BACKUP / app_path.name)
        plist_path = PLISTS / (label + '.plist')
        shutil.copy2(plist_path, BACKUP / plist_path.name)
        settings = plistlib.loads(subprocess.check_output(['/usr/bin/plutil', '-convert', 'xml1', '-o', '-', str(plist_path)]))
        settings['StandardOutPath'] = str(STATE / f'logs/launchd-{lane}-stdout.log')
        settings['StandardErrorPath'] = str(STATE / f'logs/launchd-{lane}-stderr.log')
        (STAGING / plist_path.name).write_bytes(plistlib.dumps(settings))
        command = shlex.join(bootstrap(lane)) + ' >>' + shlex.quote(str(STATE / f'logs/launcher-{lane}.log')) + ' 2>&1'
        run(['/usr/bin/osacompile', '-o', str(STAGING / (lane + '.scpt')), '-e', 'do shell script ' + json.dumps(command)])
        _, env, _ = prepare_run(RELEASE, STATE, lane)
        assert env['TORCH_HOME'] == str(STATE / 'cache/torch')
        (STATE / f'drain-{lane}').touch(exist_ok=False)
    monitor_path = PLISTS / (MONITOR + '.plist')
    shutil.copy2(monitor_path, BACKUP / monitor_path.name)
    settings = plistlib.loads(subprocess.check_output(['/usr/bin/plutil', '-convert', 'xml1', '-o', '-', str(monitor_path)]))
    assert settings.get('ProcessType') != 'Background'
    settings['ProgramArguments'] = bootstrap('main', True)
    settings['StandardOutPath'] = str(STATE / 'logs/health-stdout.log')
    settings['StandardErrorPath'] = str(STATE / 'logs/health-stderr.log')
    (STAGING / monitor_path.name).write_bytes(plistlib.dumps(settings))
    print('Verified candidate, backed up existing launchers, prepared explicit paths and paused startup.')

def stop():
    assert all((STATE / f'drain-{lane}').exists() for lane in LANES)
    with connection() as conn:
        with conn.cursor() as c:
            c.execute('lock table pgmq.q_jobs,pgmq.q_jobs_fast in share mode')
            c.execute("select worker_id,pid,job_id,stage,code_version,now()-beat_at<interval '45 seconds' from public.worker_pulse where worker_id in ('mac:main','mac:fast')")
            rows = {r[0]: r[1:] for r in c.fetchall()}
            for lane, (_, _, pid) in LANES.items():
                assert rows['mac:' + lane] == (pid, None, 'release_invalid', 'release ' + OLD_ID, True), rows
            ps = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,command='], text=True)
            processes = {int(parts[0]): (int(parts[1]), parts[2]) for line in ps.splitlines() if len(parts := line.strip().split(None, 2)) == 3}
            validated = []
            for lane, (_, app, pid) in LANES.items():
                parent, command = processes[pid]
                assert OLD_ID + '/worker/worker.py --lane ' + lane in command
                app_pid = processes[parent][0]
                assert processes[app_pid][1] == f'/Users/adil/Applications/{app}.app/Contents/MacOS/applet'
                assert not any(ppid == pid for ppid, _ in processes.values()), 'Worker has active child'
                validated.extend([pid, parent, app_pid])
            assert processes[13780][1].endswith('worker.py --lane hand'), 'Hand worker identity changed; inspect'
            for label in [x[0] for x in LANES.values()] + [MONITOR]:
                run(['/bin/launchctl', 'bootout', f'gui/{os.getuid()}/{label}'])
                c.execute('select 1')
            for pid in validated:
                try: os.kill(pid, signal.SIGTERM)
                except ProcessLookupError: pass
            deadline = time.monotonic() + 8
            alive = validated
            while time.monotonic() < deadline:
                alive = []
                for pid in validated:
                    try: os.kill(pid, 0); alive.append(pid)
                    except ProcessLookupError: pass
                if not alive: break
                time.sleep(.2)
            assert not alive, ('Processes remain; keep startup paused', alive)
    print('Stopped only the blocked main/fast workers and their monitor under queue claim barrier. Queued jobs preserved.')

def install():
    assert not any(loaded(label) for label in [x[0] for x in LANES.values()] + [MONITOR])
    for lane, (label, app, _) in LANES.items():
        target = Path('/Users/adil/Applications') / (app + '.app')
        shutil.copy2(STAGING / (lane + '.scpt'), target / 'Contents/Resources/Scripts/main.scpt')
        run(['/usr/bin/codesign', '--force', '--sign', '-', str(target)])
        run(['/usr/bin/codesign', '--verify', str(target)])
        shutil.copy2(STAGING / (label + '.plist'), PLISTS / (label + '.plist'))
    shutil.copy2(STAGING / (MONITOR + '.plist'), PLISTS / (MONITOR + '.plist'))
    print('Installed corrected explicit release paths. Not started.')

def start():
    assert all((STATE / f'drain-{lane}').exists() for lane in LANES)
    for label in [x[0] for x in LANES.values()] + [MONITOR]:
        run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', str(PLISTS / (label + '.plist'))])
    print('Started corrected main/fast paused, with independent monitor. Verify before resuming.')

def resume():
    with connection(True) as conn:
        with conn.cursor() as c:
            c.execute("select worker_id,job_id,stage,code_version,now()-beat_at<interval '45 seconds' from public.worker_pulse where worker_id in ('mac:main','mac:fast')")
            rows = {r[0]: r[1:] for r in c.fetchall()}
            assert all(rows['mac:' + lane] == (None, 'drained', 'release ' + RELEASE_ID, True) for lane in LANES), rows
            c.execute("select now()-monitor_at<interval '180 seconds' from public.worker_processing_health_control")
            assert c.fetchone()[0], 'Monitor must recover before resume'
    for lane in LANES:
        (STATE / f'drain-{lane}').unlink()
    print('Removed only the two startup pause files. Both corrected workers may now claim queued work.')

def status():
    with connection(True) as conn:
        with conn.cursor() as c:
            for name, sql in [
                ('pulses', "select worker_id,pid,stage,job_id,code_version,now()-beat_at as age from public.worker_pulse order by worker_id"),
                ('queues', 'select (select count(*) from pgmq.q_jobs),(select count(*) from pgmq.q_jobs_fast)'),
                ('health', 'select monitor_at,expected_after,email_enabled from public.worker_processing_health_control'),
                ('recent_outcomes', 'select status,requested_pipeline,delivered_pipeline,release_id,started_at,finished_at from public.worker_processing_runs order by started_at desc limit 5')]:
                c.execute(sql); print(name, json.dumps(c.fetchall(), default=str))

if __name__ == '__main__':
    {'prepare': prepare, 'stop': stop, 'install': install, 'start': start, 'resume': resume, 'status': status}[sys.argv[1]]()
