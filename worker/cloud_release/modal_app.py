"""PongLens match worker, cloud twin. Deploy from a sealed Mac release.

    cd worker/cloud_release
    PONGLENS_CLOUD_SOURCE_RELEASE="/Users/adil/Library/Application Support/PongLens/match-releases/<id>" \\
      modal deploy modal_app.py

The image carries the sealed release directory itself (worker source, models,
manifest) and four Linux Python environments built to the versions the Mac
release records. At build time `cloud_build.build_linux` writes the Linux
twin of the release next to it and verifies both share one pipeline_id.

Functions:

- dispatch     every minute, CPU only: asks the database whether a cloud
               worker should be running and starts one if so.
- run_worker   one T4 container running the sealed worker's main and fast
               lanes until the policy says stop (see supervisor.py).
- probe        proves the image: release verified, CUDA visible, tools
               pinned, BlurBall on the GPU. No credentials, no queue.
- register     records the deployed release identities in the database so
               the dispatcher can refuse a mismatched Mac.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import modal

HERE = Path(__file__).resolve().parent
for candidate in (str(HERE), '/opt/ponglens/cloud_release'):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

from cloud_build import (  # noqa: E402
    CURRENT_FILE, LINUX_FFMPEG_ROOT, PACKAGE_REMOTE, PYTHON_SHIM, RELEASE_ROOT,
    REQUIREMENTS_REMOTE, SOURCE_RELEASE_REMOTE, VENV_NAMES, VENV_ROOT,
    linux_media_install_commands, venv_install_commands,
)

APP_NAME = 'ponglens-match-worker'
SECRET_NAME = 'ponglens-match-worker-runtime'

_local_source = os.environ.get('PONGLENS_CLOUD_SOURCE_RELEASE')
SOURCE = Path(_local_source) if _local_source and Path(_local_source).exists() else Path(SOURCE_RELEASE_REMOTE)

app = modal.App(APP_NAME)
runtime_secret = modal.Secret.from_name(SECRET_NAME)

image = modal.Image.debian_slim(python_version='3.12').run_commands(*linux_media_install_commands())
image = image.pip_install('psycopg2-binary==2.9.12')
# The dependency lists go in on their own, before the environments are
# built, so an edit to the package code does not rebuild four environments.
for _name in VENV_NAMES:
    image = image.add_local_file(
        str(HERE / f'requirements-{_name}-linux.txt'),
        f'{REQUIREMENTS_REMOTE}/requirements-{_name}-linux.txt', copy=True)
image = (
    image
    .run_commands(*venv_install_commands())
    # rtmlib depends on the non-headless OpenCV build, which links libGL even
    # though nothing here opens a window. Installed after the environments so
    # a change to this line does not rebuild them.
    .run_commands('apt-get update && apt-get install -y --no-install-recommends libgl1 && rm -rf /var/lib/apt/lists/*')
    .add_local_dir(str(SOURCE), SOURCE_RELEASE_REMOTE, copy=True,
                   ignore=['__pycache__', '*.pyc', '.DS_Store'])
    .add_local_dir(str(HERE), PACKAGE_REMOTE, copy=True,
                   ignore=['__pycache__', '*.pyc', '.DS_Store'])
    .run_commands(
        f'PYTHONDONTWRITEBYTECODE=1 python3 -B {PACKAGE_REMOTE}/cloud_build.py --source {SOURCE_RELEASE_REMOTE} '
        f'--output {RELEASE_ROOT} --current {CURRENT_FILE}'
    )
    .env({'PYTHONDONTWRITEBYTECODE': '1'})
)


def _release():
    release_id = Path(CURRENT_FILE).read_text().strip()
    release = Path(RELEASE_ROOT) / release_id
    manifest = json.loads((release / 'manifest.json').read_text())
    return release, manifest


def _venv_python(name: str) -> str:
    return f'{VENV_ROOT}/{name}/bin/python'


@app.function(image=image, secrets=[runtime_secret], schedule=modal.Period(minutes=1),
              timeout=120, cpu=0.25, memory=256, min_containers=0, max_containers=1, retries=0)
def dispatch():
    import psycopg2
    import psycopg2.errors
    connection = psycopg2.connect(os.environ['DATABASE_URL'], connect_timeout=15)
    connection.autocommit = True
    try:
        with connection.cursor() as cursor:
            cursor.execute('select public.cloud_worker_decision()')
            verdict = cursor.fetchone()[0]
    except psycopg2.errors.UndefinedFunction:
        # The policy migration is not applied yet: nothing to decide, and a
        # once-a-minute traceback would only hide a real failure later.
        print(json.dumps({'event': 'cloud_policy_missing', 'run': False}))
        return {'run': False, 'reason': 'policy_missing'}
    finally:
        connection.close()
    if verdict.get('run'):
        run_worker.spawn(verdict.get('reason', 'policy'))
        print(json.dumps({'event': 'cloud_worker_started', 'reason': verdict.get('reason')}, default=str))
    return verdict


@app.function(image=image, secrets=[runtime_secret], gpu='T4', cpu=8.0, memory=16384,
              timeout=6 * 3600, min_containers=0, max_containers=1, retries=0, scaledown_window=30)
def run_worker(reason: str = 'manual'):
    import supervisor
    return supervisor.run(reason)


@app.function(image=image, gpu='T4', cpu=4.0, memory=8192, timeout=1800,
              min_containers=0, max_containers=1, retries=0)
def probe(ball_seconds: int = 20):
    """Prove the image without credentials or queue access."""
    import tempfile
    from cloud_build import pipeline_id, verify_linux_media_tools
    release, manifest = _release()
    sys.path.insert(0, str(release / 'worker'))
    import match_release
    from stable_release import stabilize
    stabilize(match_release)
    prepare_run = match_release.prepare_run
    report = {
        'release_id': manifest['release_id'],
        'pipeline_id': manifest['pipeline_id'],
        'mac_release_id': manifest['mac_release_id'],
        'source_commit': manifest['source_commit'],
        'pipeline_id_recomputed_matches': pipeline_id(manifest) == manifest['pipeline_id'],
        'media_tools': verify_linux_media_tools(),
    }
    with tempfile.TemporaryDirectory(prefix='ponglens-probe-') as directory:
        state = Path(directory) / 'state'
        command, env, cwd = prepare_run(release, state, 'main')
        env['PYTHONPATH'] = PYTHON_SHIM + ':' + env['PYTHONPATH']
        report['worker_command'] = command
        report['worker_python'] = env['PONGLENS_WORKER_PY']

        def run(python: str, code: str, timeout: int = 600, extra_env: dict | None = None) -> str:
            merged = dict(env, **(extra_env or {}))
            completed = subprocess.run([python, '-c', code], env=merged, cwd=cwd,
                                       capture_output=True, text=True, timeout=timeout)
            if completed.returncode:
                # Into the container log in full, and into the report in
                # brief, so one run says everything that is wrong.
                print(f'--- {python} exit {completed.returncode}\n{completed.stdout[-3000:]}\n{completed.stderr[-6000:]}', flush=True)
                return f'FAILED exit {completed.returncode}: ' + (completed.stderr.strip().splitlines() or ['no stderr'])[-1][:500]
            return completed.stdout.strip()

        report['pipeline_torch'] = run(env['PONGLENS_PIPELINE_PY'], (
            'import torch, cv2, numpy, scipy, skimage; '
            'print(torch.__version__, torch.version.cuda, torch.cuda.is_available(), '
            'torch.cuda.get_device_name(0) if torch.cuda.is_available() else None, '
            'cv2.__version__, numpy.__version__, scipy.__version__)'))
        report['table_torch'] = run(env['PONGLENS_TABLE_KEYPOINT_PY'], (
            'import torch, cv2, tomesd, einops; print(torch.__version__, torch.cuda.is_available(), cv2.__version__)'))
        report['rtmpose'] = run(env['PONGLENS_RTMPOSE_PY'], (
            'import onnxruntime, rtmlib, cv2; print(onnxruntime.__version__, onnxruntime.get_available_providers(), cv2.__version__)'))
        report['worker_imports'] = run(env['PONGLENS_WORKER_PY'], (
            'import sys; sys.argv=["worker.py","--lane","main"]; '
            'import os; os.environ.setdefault("DATABASE_URL","postgresql://probe"); '
            'os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY","probe"); os.environ.setdefault("SUPABASE_URL","https://probe.invalid"); '
            'import worker; print("worker imported", worker.LANE, worker.QUEUE_NAME, worker.VENV_PY, worker.RTMPOSE_PY)'),
            extra_env={'PATH': '/opt/ponglens/shims:' + env['PATH']})
        # A synthetic clip through the real detector on the real GPU.
        clip = Path(directory) / 'probe.mp4'
        subprocess.run([env['PONGLENS_FFMPEG'], '-v', 'error', '-y', '-f', 'lavfi',
                        '-i', f'testsrc2=size=1280x720:rate=30', '-t', str(ball_seconds),
                        '-pix_fmt', 'yuv420p', '-c:v', 'libx264', str(clip)], check=True, env=env)
        out = Path(directory) / 'blurball.jsonl'
        completed = subprocess.run(
            [env['PONGLENS_PIPELINE_PY'], env['PONGLENS_BLURBALL_INFER'], '--video', str(clip), '--out', str(out)],
            env=env, cwd=cwd, capture_output=True, text=True, timeout=900)
        report['blurball_exit'] = completed.returncode
        report['blurball_output'] = (completed.stdout + completed.stderr)[-1500:]
        report['blurball_lines'] = sum(1 for _ in out.open()) if out.exists() else 0
        table = Path(directory) / 'table.json'
        completed = subprocess.run(
            [env['PONGLENS_TABLE_KEYPOINT_PY'], str(release / 'worker' / 'table_keypoints.py'),
             '--video', str(clip), '--out', str(table), '--frames', '16', '--quiet'],
            env=env, cwd=cwd, capture_output=True, text=True, timeout=900)
        report['table_exit'] = completed.returncode
        report['table_output'] = (completed.stdout + completed.stderr)[-800:]
    return report


@app.function(image=image, secrets=[runtime_secret], timeout=300, cpu=0.5, memory=512, retries=0)
def register():
    """Record which release this deployment runs, for the dispatcher's gate."""
    import psycopg2
    _, manifest = _release()
    connection = psycopg2.connect(os.environ['DATABASE_URL'], connect_timeout=15)
    connection.autocommit = True
    with connection.cursor() as cursor:
        cursor.execute(
            'select public.cloud_worker_register(%s, %s, %s, %s)',
            (manifest['release_id'], manifest['pipeline_id'], manifest['mac_release_id'], manifest['source_commit']))
        result = cursor.fetchone()[0]
    connection.close()
    return result


@app.function(image=image, secrets=[runtime_secret], gpu='T4', cpu=8.0, memory=16384,
              timeout=4 * 3600, min_containers=0, max_containers=2, retries=0)
def shadow_run(job_id: str, out_prefix: str | None = None, label: str | None = None):
    """Replay one processed upload through the sealed pipeline; publish nothing."""
    release, manifest = _release()
    sys.path.insert(0, str(release / 'worker'))
    import match_release
    from stable_release import stabilize
    stabilize(match_release)
    state = Path('/tmp/ponglens-shadow-state')
    command, env, cwd = match_release.prepare_run(release, state, 'main')
    env['PATH'] = '/opt/ponglens/shims:' + env['PATH']
    env['PYTHONPATH'] = PYTHON_SHIM + ':' + env['PYTHONPATH']
    label = label or f"modal-{manifest['release_id'][:8]}"
    out = out_prefix or f'r2://ponglens-media/parity/{job_id}/{label}'
    process = subprocess.Popen(
        [env['PONGLENS_WORKER_PY'], f'{PACKAGE_REMOTE}/shadow.py', '--job-id', job_id, '--out', out, '--label', label],
        env=env, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    summary = None
    for line in process.stdout or ():
        line = line.rstrip()
        if line.startswith('SHADOW-SUMMARY '):
            summary = json.loads(line[len('SHADOW-SUMMARY '):])
        else:
            print(line, flush=True)
    code = process.wait()
    if summary is None:
        summary = {'status': 'failed', 'error': f'shadow exited {code} without a summary'}
    summary['exit_code'] = code
    try:
        import torch  # noqa: F401  (system python has no torch; the report below is from the child)
    except Exception:  # noqa: BLE001
        pass
    return summary


@app.local_entrypoint()
def main(command: str = 'probe', job_id: str = '', label: str = ''):
    if command == 'probe':
        print(json.dumps(probe.remote(), indent=2, default=str))
    elif command == 'register':
        print(json.dumps(register.remote(), indent=2, default=str))
    elif command == 'run':
        print(json.dumps(run_worker.remote('manual entrypoint'), indent=2, default=str))
    elif command == 'shadow':
        if not job_id:
            raise SystemExit('--job-id required')
        print(json.dumps(shadow_run.remote(job_id, None, label or None), indent=2, default=str))
    else:
        raise SystemExit(f'unknown command {command}')
