"""Linux twin of a sealed Mac match release.

The Mac release (`worker/match_release`) seals worker source, models and the
Mac's own Python environments into one content-addressed directory. The
cloud runs the same source and the same models from that same sealed payload,
with Linux environments anchored in a sibling manifest.

Two identities:

- `release_id`  sha256 of a manifest, runtime anchors included. Different on
                the Mac and on Linux by construction, because the runtime is
                different. This is what `match_release` verifies.
- `pipeline_id` sha256 over what decides what a match becomes: every payload
                file except the three media launchers in `bin/` and the
                BlurBall wrapper (whose device line is the one reviewed
                per-platform adapter), plus the sealed behavior settings and
                the body model. Identical on both machines for one release.

A cloud worker may only take work when the Mac's release and the cloud's
release share a pipeline_id. The cloud manifest also records the exact Mac
release it was built from (`mac_release_id`), which is what the dispatcher
compares against the Mac's own pulse until the Mac reports a pipeline_id.

Nothing here rewrites the Mac release. `build_linux` reads it and writes a
new directory.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

# Static FFmpeg for Linux from the 8.1 release branch, the branch the Mac's
# Homebrew 8.1.2 comes from. The publisher keeps one rolling asset per
# branch, so the URL is stable and the bytes are not: the lesson-video
# worker pinned an individual asset on 2026-09-05 and that asset was gone
# eleven days later. The binary that arrives is sealed by content hash in
# the Linux manifest's runtime anchors, exactly as the Mac seals its own
# FFmpeg, so a rebuild that fetches a newer build produces a new release ID.
LINUX_FFMPEG_ARTIFACT_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz'
LINUX_FFMPEG_BRANCH = 'n8.1'
LINUX_FFMPEG_ROOT = '/opt/ponglens-ffmpeg'

# Fixed image layout. The four environments mirror the four the Mac release
# anchors: the worker's own, the TTVid pipeline (BlurBall, points, cut), the
# RTMPose runtime (players, side changes) and the table-keypoint runtime.
VENV_ROOT = '/opt/ponglens/venvs'
RELEASE_ROOT = '/opt/ponglens/releases'
SOURCE_RELEASE_REMOTE = '/opt/ponglens/source-release'
CURRENT_FILE = '/opt/ponglens/current-release-id'
SHIM_DIR = '/opt/ponglens/shims'
PACKAGE_REMOTE = '/opt/ponglens/cloud_release'
# First on PYTHONPATH for every process the sealed release starts; see
# stable_release.py and shim/sitecustomize.py.
PYTHON_SHIM = PACKAGE_REMOTE + '/shim'

VENV_NAMES = ('worker', 'pipeline', 'rtmpose', 'table')
BLURBALL_WRAPPER = 'worker/blurball_infer.py'

# The one reviewed per-platform adapter: the wrapper picks CUDA when it is
# there. On the Mac the same lines still choose MPS, so behavior there is
# untouched. Both replacements must match exactly once or the build refuses.
BLURBALL_DEVICE_ADAPTER = (
    ('ap.add_argument("--device", default="auto", choices=["auto", "mps", "cpu"])',
     'ap.add_argument("--device", default="auto", choices=["auto", "cuda", "mps", "cpu"])'),
    ('    if args.device == "auto":\n'
     '        device = "mps" if torch.backends.mps.is_available() else "cpu"\n',
     '    if args.device == "auto":\n'
     '        device = ("cuda" if torch.cuda.is_available()\n'
     '                  else "mps" if torch.backends.mps.is_available() else "cpu")\n'),
)


class CloudBuildError(RuntimeError):
    pass


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def pipeline_id(manifest: dict) -> str:
    """Platform-independent identity of what the release does. See module doc."""
    files = {
        name: record for name, record in manifest['files'].items()
        if not (name == 'bin' or name.startswith('bin/')) and name != BLURBALL_WRAPPER
    }
    identity = {
        'schema': 1,
        'files': files,
        'behavior_env': manifest['behavior_env'],
        'body_model': manifest['body_model'],
        'blurball_original_sha256': manifest['adapters']['blurball_original_sha256'],
    }
    return hashlib.sha256(_canonical(identity)).hexdigest()


def read_manifest(release: Path) -> dict:
    return json.loads((Path(release) / 'manifest.json').read_text())


def linux_media_install_commands() -> tuple[str, ...]:
    artifact = '/tmp/ponglens-ffmpeg.tar.xz'
    return (
        'apt-get update && apt-get install -y --no-install-recommends '
        'ca-certificates curl xz-utils libglib2.0-0 libgomp1 && rm -rf /var/lib/apt/lists/*',
        f"curl -fsSL '{LINUX_FFMPEG_ARTIFACT_URL}' -o {artifact}",
        f'mkdir -p {LINUX_FFMPEG_ROOT} && tar -xJf {artifact} -C {LINUX_FFMPEG_ROOT} --strip-components=1 && rm -f {artifact}',
        f'{LINUX_FFMPEG_ROOT}/bin/ffmpeg -version | head -1 && sha256sum {LINUX_FFMPEG_ROOT}/bin/ffmpeg {LINUX_FFMPEG_ROOT}/bin/ffprobe',
        f'mkdir -p {SHIM_DIR} && printf "#!/bin/sh\\nexit 44\\n" > {SHIM_DIR}/security && chmod 755 {SHIM_DIR}/security',
    )


REQUIREMENTS_REMOTE = '/opt/ponglens/requirements'


def venv_install_commands() -> tuple[str, ...]:
    commands = []
    for name in VENV_NAMES:
        venv = f'{VENV_ROOT}/{name}'
        requirements = f'{REQUIREMENTS_REMOTE}/requirements-{name}-linux.txt'
        commands.append(
            f'python3 -m venv {venv} && {venv}/bin/pip install --no-cache-dir '
            f'--disable-pip-version-check --upgrade pip && '
            f'{venv}/bin/pip install --no-cache-dir --disable-pip-version-check -r {requirements} && '
            f'{venv}/bin/pip check'
        )
    return tuple(commands)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify_linux_media_tools() -> dict:
    """The tools must be the 8.1 branch and must carry libx264 and aac,
    which the pipeline's cuts and clips depend on. Their exact identity is
    sealed by the manifest's runtime anchors, not by a constant here."""
    root = Path(LINUX_FFMPEG_ROOT)
    report = {}
    for tool in ('ffmpeg', 'ffprobe'):
        path = root / 'bin' / tool
        version = subprocess.check_output([str(path), '-version'], text=True)
        first = version.splitlines()[0]
        if f'{tool} version {LINUX_FFMPEG_BRANCH}' not in first:
            raise CloudBuildError(f'Linux {tool} is not from the {LINUX_FFMPEG_BRANCH} branch: {first}')
        report[tool] = {'version': first, 'sha256': _sha256(path)}
    encoders = subprocess.check_output([str(root / 'bin' / 'ffmpeg'), '-hide_banner', '-encoders'], text=True)
    if 'libx264' not in encoders or ' aac ' not in encoders:
        raise CloudBuildError('Linux FFmpeg lacks libx264 or aac')
    return report


def linux_runtime_config() -> dict:
    """Anchor the four image environments and the media tools, like
    `match_release inspect-local` does on the Mac."""
    from match_release.__main__ import _python_runtime  # payload's own inspector
    runtime = {}
    for name in VENV_NAMES:
        runtime[name] = _python_runtime(Path(VENV_ROOT) / name / 'bin' / 'python')
    runtime['worker']['identity']['platform'] = 'linux'
    for name, executable in (
        ('ffmpeg', Path(LINUX_FFMPEG_ROOT) / 'bin' / 'ffmpeg'),
        ('ffprobe', Path(LINUX_FFMPEG_ROOT) / 'bin' / 'ffprobe'),
        ('ytdlp', Path(VENV_ROOT) / 'worker' / 'bin' / 'yt-dlp'),
    ):
        executable = executable.resolve(strict=True)
        runtime[name] = {'executable': str(executable), 'roots': [str(executable)]}
    return runtime


def build_linux(source_release, output, runtime: dict | None = None) -> Path:
    """Write `<output>/<linux release_id>` from a sealed Mac release."""
    import match_release
    from stable_release import diagnose, stabilize
    stabilize(match_release)
    from match_release import _anchor_runtime, _hash, _manifest, _payload_inventory, verify

    source, manifest = _manifest(Path(source_release))
    if manifest.get('platform', 'mac') != 'mac':
        raise CloudBuildError('Build the Linux twin from the Mac release, not from another twin')
    # Importing the sealed packaging module from the copied release can
    # leave a bytecode cache beside it (this process runs with bytecode
    # off, but be certain). A cache is never part of a sealed payload.
    for cache in source.rglob('__pycache__'):
        if cache.is_dir():
            shutil.rmtree(cache, ignore_errors=True)
    # The copy into the image keeps every byte and drops the permission
    # bits (a 755 script arrives 644). The manifest records the modes, so
    # they are put back before the payload is compared to it: content is
    # what the comparison must catch, and a changed byte still fails here.
    for name, record in manifest['files'].items():
        path = source / name
        if path.exists() and not path.is_symlink():
            path.chmod(record['mode'])
    found = _payload_inventory(source)
    if found != manifest['files']:
        expected = manifest['files']
        differences = sorted(
            name for name in set(found) | set(expected)
            if found.get(name) != expected.get(name)
        )
        raise CloudBuildError(
            'Source release files changed, missing, added or replaced: '
            + ', '.join(differences[:12]) + ('…' if len(differences) > 12 else ''))
    verify_linux_media_tools()
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    runtime = runtime or linux_runtime_config()
    with tempfile.TemporaryDirectory(prefix='.building-linux-', dir=output) as temporary:
        payload = Path(temporary) / 'payload'
        shutil.copytree(
            source, payload,
            ignore=lambda directory, names: ['manifest.json'] if Path(directory) == source else [],
        )
        for name in ('ffmpeg', 'ffprobe', 'ytdlp'):
            launcher = payload / 'bin' / ('yt-dlp' if name == 'ytdlp' else name)
            launcher.write_text('#!/bin/sh\nexec ' + shlex.quote(runtime[name]['executable']) + ' "$@"\n')
            launcher.chmod(0o755)
        wrapper = payload / BLURBALL_WRAPPER
        mac_wrapper_sha256 = _hash(wrapper)
        text = wrapper.read_text()
        for old, new in BLURBALL_DEVICE_ADAPTER:
            if text.count(old) != 1:
                raise CloudBuildError('BlurBall wrapper changed; review its device adapter before building')
            text = text.replace(old, new)
        wrapper.write_text(text)
        anchored = _anchor_runtime(runtime)
        linux = {
            'schema': 1,
            'platform': 'linux',
            'source_commit': manifest['source_commit'],
            'mac_release_id': manifest['release_id'],
            'files': _payload_inventory(payload),
            'runtime': anchored,
            'behavior_env': manifest['behavior_env'],
            'body_model': manifest['body_model'],
            'adapters': dict(
                manifest['adapters'],
                blurball_device='cuda-first',
                blurball_mac_sha256=mac_wrapper_sha256,
            ),
        }
        # pipeline_id is derived from the fields above and written into the
        # manifest for readers; the release_id hash then covers it too, so
        # the Mac verifier's identity check (everything but release_id) holds.
        linux['pipeline_id'] = pipeline_id(linux)
        if linux['pipeline_id'] != pipeline_id(manifest):
            raise CloudBuildError('Linux twin does not share the Mac pipeline identity')
        linux['release_id'] = hashlib.sha256(_canonical(linux)).hexdigest()
        (payload / 'manifest.json').write_bytes(_canonical(linux) + b'\n')
        # The verifier walks the tree's metadata before and after hashing it
        # and refuses if anything moved. On the image builder's filesystem a
        # file written a moment ago can still be reporting its size and
        # timestamp lazily, so wait until two consecutive walks agree.
        os.sync()
        walk = getattr(match_release, '_ponglens_original_inventory', match_release._inventory)
        for attempt in range(20):
            first = walk(payload, metadata=True)
            time.sleep(0.5)
            if walk(payload, metadata=True) == first:
                print(f'payload metadata settled after {attempt + 1} check(s)', file=sys.stderr)
                break
        else:
            raise CloudBuildError('Payload metadata never settled on this filesystem')
        try:
            verify(payload, expected_id=linux['release_id'])
        except Exception:
            # Say what moved, for the build log: which stat fields change
            # once a file has been read on this filesystem.
            for line in diagnose(match_release, payload):
                print('  ', line, file=sys.stderr)
            raise
        destination = output / linux['release_id']
        if destination.exists():
            verify(destination, expected_id=linux['release_id'])
        else:
            os.rename(payload, destination)
    return destination


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default=SOURCE_RELEASE_REMOTE)
    parser.add_argument('--output', default=RELEASE_ROOT)
    parser.add_argument('--current', default=CURRENT_FILE)
    args = parser.parse_args(argv)
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(args.source) / 'worker'))
    destination = build_linux(args.source, args.output)
    manifest = read_manifest(destination)
    Path(args.current).write_text(manifest['release_id'] + '\n')
    print(json.dumps({
        'release_id': manifest['release_id'],
        'pipeline_id': manifest['pipeline_id'],
        'mac_release_id': manifest['mac_release_id'],
        'source_commit': manifest['source_commit'],
    }, indent=2))


if __name__ == '__main__':
    main()
