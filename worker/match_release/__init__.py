"""Content-addressed Mac worker payloads with checked external runtime anchors.

This is an integrity boundary, not a signature or an OS write-protection system.
Runtime environments must not be upgraded while a release uses them.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import tempfile


class ReleaseError(RuntimeError):
    pass


RUNTIMES = ('worker', 'pipeline', 'rtmpose', 'table', 'ffmpeg', 'ffprobe', 'ytdlp')
ASSETS = {'blurball': 'models/blurball', 'table': 'models/table-keypoints',
          'pose': 'models/rtmpose/end2end.onnx',
          'detector': 'models/rtmpose/rtmdet-person.onnx'}
_runtime_cache = {}
_payload_cache = {}


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def _hash(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def _skip(path):
    return path.name in ('.git', '__pycache__', '.DS_Store')


def _inventory(root, *, anchored=False, metadata=False, filtered=False):
    """Runtime symlinks are recorded AND their targets recursively checked."""
    result = {}

    def walk(path, relative, ancestors):
        if (anchored or filtered) and _skip(path):
            return
        if path.is_symlink() and not anchored:
            raise ReleaseError(f'Symlink in payload or source: {path}')
        try:
            resolved = path.resolve(strict=True)
            info = path.stat()
        except OSError as exc:
            raise ReleaseError(f'Missing dependency: {path}') from exc
        record = {'mode': stat.S_IMODE(info.st_mode)}
        if path.is_symlink():
            record['link'] = os.readlink(path)
            record['resolved'] = str(resolved)
        if metadata:
            record['stat'] = [info.st_dev, info.st_ino, info.st_size,
                              info.st_mtime_ns, info.st_ctime_ns]
        if path.is_dir():
            if resolved in ancestors:
                raise ReleaseError(f'Cyclic runtime symlink: {path}')
            record['type'] = 'directory'
            result[relative] = record
            for child in sorted(path.iterdir()):
                walk(child, f'{relative}/{child.name}' if relative else child.name,
                     ancestors | {resolved})
        elif path.is_file():
            record['type'] = 'file'
            if not metadata:
                record['sha256'] = _hash(path)
            result[relative] = record
        else:
            raise ReleaseError(f'Unsupported dependency type: {path}')

    walk(root, '', set())
    return result


def _copy(source, target):
    source = Path(source).expanduser().absolute()
    before = _inventory(source, filtered=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, target, ignore=lambda p, names: [n for n in names if _skip(Path(n))])
    else:
        shutil.copy2(source, target)
    # Source mutation, including replacement while copying, cannot pass unnoticed.
    after = _inventory(source, filtered=True)
    copied = _inventory(target)
    before = {k: v for k, v in before.items() if not any(_skip(Path(p)) for p in Path(k).parts)}
    after = {k: v for k, v in after.items() if not any(_skip(Path(p)) for p in Path(k).parts)}
    if before != after or before != copied:
        raise ReleaseError(f'Dependency changed during collection: {source}')


def _payload_inventory(root):
    inventory = _inventory(root)
    inventory.pop('', None)
    inventory.pop('manifest.json', None)
    return inventory


def _git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def _source(repo, commit, target):
    rows = _git(repo, 'ls-tree', '-rz', commit, '--', 'worker').split(b'\0')
    for row in rows:
        if not row:
            continue
        metadata, name = row.split(b'\t', 1)
        mode, kind, oid = metadata.split()
        if mode not in (b'100644', b'100755') or kind != b'blob':
            raise ReleaseError(f'Non-regular committed source: {name!r}')
        path = target / name.decode()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_git(repo, 'cat-file', 'blob', oid.decode()))
        path.chmod(0o755 if mode == b'100755' else 0o644)


def _anchor_runtime(config):
    if set(config) != set(RUNTIMES):
        raise ReleaseError(f'Required runtime names: {RUNTIMES}')
    result = {}
    for name, entry in config.items():
        executable = Path(entry['executable']).expanduser().absolute()
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise ReleaseError(f'Missing runtime executable: {executable}')
        # Preserve a venv's bin/python spelling: resolving its symlink loses the venv.
        roots = [str(Path(p).expanduser().absolute()) for p in entry['roots']]
        if not any(executable == Path(p) or Path(p) in executable.parents for p in roots):
            roots.append(str(executable))
        result[name] = {'executable': str(executable),
                        'roots': {p: _inventory(Path(p), anchored=True) for p in roots},
                        'identity': entry.get('identity', {})}
    return result


def build(repo, output, config, commit='HEAD'):
    """Read committed worker files; capture external assets; never set current."""
    repo, output = Path(repo).resolve(), Path(output).resolve()
    commit = _git(repo, 'rev-parse', f'{commit}^{{commit}}').decode().strip()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.building-', dir=output) as temporary:
        payload = Path(temporary) / 'payload'
        payload.mkdir()
        _source(repo, commit, payload)
        for required in ('worker.py', 'points_pipeline.py', 'rtm_accel.py'):
            if not (payload / 'worker' / required).is_file():
                raise ReleaseError(f'Missing committed source: {required}')
        version = config['body_model']
        if not isinstance(version, str) or not version or Path(version).name != version or version in ('.', '..'):
            raise ReleaseError('Invalid body model version')
        model = payload / 'worker/body_model' / version
        for name in ('model.npz', 'edge.npz', 'features.sha'):
            if not (model / name).is_file():
                raise ReleaseError(f'Missing body model asset: {name}')
        for name, destination in ASSETS.items():
            if name not in config['assets']:
                raise ReleaseError(f'Missing asset configuration: {name}')
            _copy(config['assets'][name], payload / destination)
        wrapper = payload / 'worker/blurball_infer.py'
        if wrapper.exists():
            raise ReleaseError('Committed blurball_infer.py requires an explicit packaging adapter review')
        _copy(config['assets']['wrapper'], wrapper)
        original = _hash(wrapper)
        text = wrapper.read_text()
        old = 'REPO = "/Users/adil/Desktop/Projects/TTVid/vendor/blurball"'
        if text.count(old) != 1:
            raise ReleaseError('External BlurBall wrapper changed; review its REPO adapter')
        wrapper.write_text(text.replace(old, 'REPO = os.environ["PONGLENS_BLURBALL_HOME"]'))
        runtime = _anchor_runtime(config['runtime'])
        for name in ('ffmpeg', 'ffprobe', 'ytdlp'):
            path = payload / 'bin' / ('yt-dlp' if name == 'ytdlp' else name)
            path.parent.mkdir(exist_ok=True)
            path.write_text('#!/bin/sh\nexec ' + shlex.quote(runtime[name]['executable']) + ' "$@"\n')
            path.chmod(0o755)
        # Python runs this before importing processing code. Every child checks
        # anchors independently; a .pth is part of the anchored runtime too.
        (payload / 'worker/sitecustomize.py').write_text(
            'import os\n'
            'if os.environ.get("PONGLENS_MATCH_RELEASE"):\n'
            '    try:\n'
            '        from match_release import verify_unchanged\n'
            '        verify_unchanged(os.environ["PONGLENS_MATCH_RELEASE"])\n'
            '    except BaseException as error:\n'
            '        os.write(2, ("Release verification failed: " + str(error) + "\\n").encode())\n'
            '        os._exit(78)\n')
        manifest = {'schema': 1, 'source_commit': commit,
                    'files': _payload_inventory(payload), 'runtime': runtime,
                    'body_model': {'version': version, 'files': _inventory(model)},
                    'adapters': {'blurball_original_sha256': original,
                                 'blurball_repo': 'PONGLENS_BLURBALL_HOME'}}
        manifest['release_id'] = hashlib.sha256(_canonical(manifest)).hexdigest()
        (payload / 'manifest.json').write_bytes(_canonical(manifest) + b'\n')
        verify(payload, expected_id=manifest['release_id'])
        destination = output / manifest['release_id']
        if destination.exists():
            verify(destination, expected_id=manifest['release_id'])
        else:
            os.rename(payload, destination)
        return destination


def _manifest(path, expected_id=None):
    root = Path(path).resolve(strict=True)
    manifest_file = root / 'manifest.json'
    if manifest_file.is_symlink():
        raise ReleaseError('Symlinked manifest')
    try:
        manifest = json.loads(manifest_file.read_text())
        release_id = manifest.pop('release_id')
        if manifest['schema'] != 1 or hashlib.sha256(_canonical(manifest)).hexdigest() != release_id:
            raise ReleaseError('Release manifest identity mismatch')
        manifest['release_id'] = release_id
        if re.fullmatch(r'[0-9a-f]{64}', root.name) and root.name != release_id:
            raise ReleaseError('Content-addressed directory identity mismatch')
        if expected_id is not None and release_id != expected_id:
            raise ReleaseError('Unexpected release identity')
        return root, manifest
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ReleaseError('Missing or invalid release manifest') from exc


def verify_runtime_unchanged(path):
    """Full hashes on first use; inode/ctime/size prefilter thereafter per process.

    No persistent cache is trusted. Changed metadata forces another complete
    content comparison, including newly added files and resolved symlinks.
    """
    root, manifest = _manifest(path)
    os_build = manifest['runtime']['worker'].get('identity', {}).get('os_build')
    if os_build and subprocess.check_output(['/usr/bin/sw_vers', '-buildVersion'], text=True).strip() != os_build:
        raise ReleaseError('macOS build changed; rebuild and smoke-test the runtime')
    visited = set()
    for entry in manifest['runtime'].values():
        for name, expected in entry['roots'].items():
            if name in visited:
                continue
            visited.add(name)
            key = (manifest['release_id'], name)
            before = _inventory(Path(name), anchored=True, metadata=True)
            if _runtime_cache.get(key) == before:
                continue
            if _inventory(Path(name), anchored=True) != expected:
                raise ReleaseError(f'Runtime anchor changed: {name}')
            after = _inventory(Path(name), anchored=True, metadata=True)
            if before != after:
                raise ReleaseError(f'Runtime changed during verification: {name}')
            _runtime_cache[key] = after
    return manifest


def verify(path, expected_id=None):
    root, manifest = _manifest(path, expected_id)
    before = _inventory(root, metadata=True)
    if _payload_inventory(root) != manifest['files']:
        raise ReleaseError('Release files changed, missing, added or replaced')
    after = _inventory(root, metadata=True)
    if before != after:
        raise ReleaseError('Release changed during verification')
    _payload_cache[(str(root), manifest['release_id'])] = after
    verify_runtime_unchanged(root)
    return manifest


def verify_unchanged(path):
    """Before each claim: metadata prefilter, full hashes on first use or change."""
    root, manifest = _manifest(path)
    key = (str(root), manifest['release_id'])
    if _payload_cache.get(key) != _inventory(root, metadata=True):
        return verify(root)
    verify_runtime_unchanged(root)
    return manifest


def prepare_run(path, state, lane='main'):
    root = Path(path).resolve(strict=True)
    manifest = verify(root)
    if root.name != manifest['release_id']:
        raise ReleaseError('Runner requires the content-addressed release directory')
    state = Path(state).expanduser().resolve()
    if root == state or root in state.parents or state in root.parents:
        raise ReleaseError('Writable state must be separate from the release')
    env = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'PYTHONSTARTUP', 'VIRTUAL_ENV'):
        env.pop(key, None)
    runtime = manifest['runtime']
    env.update({
        'PONGLENS_MATCH_RELEASE': str(root),
        'PONGLENS_RELEASE_ID': manifest['release_id'],
        'PONGLENS_WORKER_PY': runtime['worker']['executable'],
        'PONGLENS_PIPELINE_PY': runtime['pipeline']['executable'],
        'PONGLENS_BLURBALL_INFER': str(root / 'worker/blurball_infer.py'),
        'PONGLENS_BLURBALL_HOME': str(root / 'models/blurball'),
        'PONGLENS_RTMPOSE_PY': runtime['rtmpose']['executable'],
        'PONGLENS_RTMPOSE_MODEL': str(root / ASSETS['pose']),
        'PONGLENS_RTMPOSE_DET_MODEL': str(root / ASSETS['detector']),
        'DET_MODEL': str(root / ASSETS['detector']),
        'PONGLENS_TABLE_KEYPOINT_HOME': str(root / ASSETS['table']),
        'PONGLENS_TABLE_KEYPOINT_PY': runtime['table']['executable'],
        'PONGLENS_BODY_MODEL': manifest['body_model']['version'],
        'PONGLENS_COREML_CACHE': str(state / 'coreml-cache'),
        'TORCH_HOME': str(root / ASSETS['table'] / 'torchhub'),
        'PONGLENS_WORK_DIR': str(state / 'work'),
        'PONGLENS_LOG_DIR': str(state / 'logs'),
        'PONGLENS_STATE_DIR': str(state),
        'PONGLENS_DRAIN_FILE': str(state / f'drain-{lane}'),
        'XDG_CACHE_HOME': str(state / 'cache'),
        'MPLCONFIGDIR': str(state / 'cache/matplotlib'),
        'TMPDIR': str(state / 'tmp'),
        'PYTHONPATH': str(root / 'worker'),
        'PYTHONNOUSERSITE': '1', 'PYTHONDONTWRITEBYTECODE': '1',
        'WORKER_LANE': lane,
        'PATH': str(root / 'bin') + ':/usr/bin:/bin:/usr/sbin:/sbin',
        'PONGLENS_FFMPEG': runtime['ffmpeg']['executable'],
        'PONGLENS_FFPROBE': runtime['ffprobe']['executable'],
        'PONGLENS_YTDLP': runtime['ytdlp']['executable'],
    })
    for name in ('work', 'logs', 'cache/matplotlib', 'tmp', 'coreml-cache'):
        (state / name).mkdir(parents=True, exist_ok=True)
    # Avoid reading existing runtime __pycache__ files. This fresh directory is
    # shared by children, and PYTHONDONTWRITEBYTECODE keeps it empty.
    env['PYTHONPYCACHEPREFIX'] = tempfile.mkdtemp(prefix='python-cache-', dir=state / 'tmp')
    return [runtime['worker']['executable'], str(root / 'worker/worker.py'), '--lane', lane], env, str(state / 'work')


def stage(path, destination):
    source = Path(path).resolve(strict=True)
    manifest = verify(source)
    destination = Path(destination).expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / manifest['release_id']
    if target.exists():
        verify(target, manifest['release_id'])
        return target
    with tempfile.TemporaryDirectory(prefix='.staging-', dir=destination) as tmp:
        payload = Path(tmp) / 'payload'
        shutil.copytree(source, payload)
        verify(payload, manifest['release_id'])
        os.rename(payload, target)
    return target
