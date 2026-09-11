"""Build, verify and stage. `run` is explicit; no command changes launchd."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess

from . import BEHAVIOR_DEFAULTS, ReleaseError, behavior_environment, build, verify, stage, prepare_run


def _native_dependency_roots(roots):
    """Read installed Mach-O linkage, including dependencies absent from brew metadata."""
    magics = {b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf',
              b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca',
              b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}
    seen, pending, anchors = set(), [], set()

    def collect(root):
        root = Path(root)
        paths = [root] if root.is_file() else root.rglob('*')
        for path in paths:
            if not path.is_file() or (path.suffix not in ('.so', '.dylib') and not os.access(path, os.X_OK)):
                continue
            resolved = path.resolve(strict=True)
            if resolved in seen:
                continue
            seen.add(resolved)
            with resolved.open('rb') as stream:
                if stream.read(4) in magics:
                    pending.append(resolved)

    for root in roots:
        collect(root)
    while pending:
        batch, pending = pending[:64], pending[64:]
        identities = subprocess.check_output(['/usr/bin/otool', '-D', *map(str, batch)], text=True)
        install_ids, owner = {}, None
        for line in identities.splitlines():
            if line.endswith(':'):
                owner = Path(line[:-1].split(' (architecture ', 1)[0])
            elif owner and line.strip():
                install_ids[owner] = line.strip()
        output = subprocess.check_output(['/usr/bin/otool', '-L', *map(str, batch)], text=True)
        owner = None
        for line in output.splitlines():
            if not line.startswith('\t'):
                if line.endswith(':'):
                    owner = Path(line[:-1].split(' (architecture ', 1)[0])
                continue
            dependency = line.strip().split(' (', 1)[0]
            # -L prints a dylib's own install-name first. Build-machine install
            # IDs in Python wheels are not dependencies loaded from that path.
            if dependency == install_ids.get(owner):
                continue
            if dependency.startswith('@loader_path/') and owner:
                dependency = str(owner.parent / dependency[len('@loader_path/'):])
            if not dependency.startswith('/') or dependency.startswith(('/usr/lib/', '/System/')):
                continue
            path = Path(dependency).absolute()
            path.resolve(strict=True)
            # Preserve the nearest dynamic link through which dyld loads this
            # file, and recursively inventory its target. Direct Cellar references
            # still get an individual file anchor.
            anchor = next((p for p in [path, *path.parents] if p.is_symlink()), path)
            if str(anchor) not in anchors:
                anchors.add(str(anchor))
                collect(anchor)
    # Do not repeat thousands of library file inventories already covered by
    # a prefix tree. A newly discovered symlink still needs its own link record.
    original = [Path(root).absolute() for root in roots]
    def covered(anchor):
        path = Path(anchor)
        return any(path == root or root in path.parents or
                   (not path.is_symlink() and
                    (path.resolve() == root.resolve() or root.resolve() in path.resolve().parents))
                   for root in original)
    return sorted(anchor for anchor in anchors if not covered(anchor))


def _python_runtime(executable):
    code = ('import sys,json,importlib.metadata; print(json.dumps(dict('
            'prefix=sys.prefix,base_prefix=sys.base_prefix,paths=sys.path,'
            'version=sys.version,packages=sorted((d.metadata["Name"],d.version) '
            'for d in importlib.metadata.distributions()))))')
    info = json.loads(subprocess.check_output([str(executable), '-I', '-c', code], text=True))
    roots = [str(Path(info['prefix']).absolute()), str(Path(info['base_prefix']).absolute())]
    for item in info['paths']:
        path = Path(item)
        if path.exists() and not any(path.resolve() == Path(r).resolve() or
                                     Path(r).resolve() in path.resolve().parents for r in roots):
            # Executable .pth/editable installations must not silently import a checkout.
            if 'site-packages' not in path.parts:
                raise ReleaseError(f'Unexpected external Python search path: {path}')
            roots.append(str(path.absolute()))
    return {'executable': str(executable.absolute()), 'roots': roots, 'identity': info}


def local_config(repo):
    """Inspect this Mac. The JSON is a reviewable build input, not activation."""
    home = Path.home()
    project = home / 'Desktop/Projects/PongLens'
    ttv = home / 'Desktop/Projects/TTVid/vendor'
    cache = home / 'Library/Caches/PongLens'
    interpreters = {
        'worker': project / 'worker/venv/bin/python',
        'pipeline': ttv / 'venv/bin/python',
        'rtmpose': cache / 'rtmpose-production/venv/bin/python',
        'table': cache / 'table-keypoints/venv/bin/python',
    }
    runtime = {name: _python_runtime(path) for name, path in interpreters.items()}
    for name in ('ffmpeg', 'ffprobe', 'ytdlp'):
        command = 'yt-dlp' if name == 'ytdlp' else name
        candidate = home / '.local/bin/yt-dlp' if name == 'ytdlp' else None
        executable = candidate if candidate and candidate.exists() else Path(shutil.which(command) or command)
        executable = executable.resolve(strict=True)
        runtime[name] = {'executable': str(executable), 'roots': [str(executable)]}
    # Homebrew's dependency graph includes libraries loaded by Python extensions
    # and ffmpeg. Preserve opt links: native libraries load through those links,
    # so checking only the old Cellar directory would miss a brew link retarget.
    if platform.system() != 'Darwin':
        raise ReleaseError('Automatic discovery supports the production Mac only; provide reviewed explicit runtime roots')
    brew = shutil.which('brew')
    if not brew:
        raise ReleaseError('Homebrew is required to discover native library dependencies')
    formulas = {'ffmpeg'}
    for entry in runtime.values():
        for path in entry['roots']:
            parts = Path(path).resolve().parts
            if 'Cellar' in parts:
                formulas.add(parts[parts.index('Cellar') + 1])
    environment = dict(os.environ, HOMEBREW_NO_AUTO_UPDATE='1')
    dependencies = set(formulas)
    for formula in sorted(formulas):
        dependencies.update(subprocess.check_output(
            [brew, 'deps', '--installed', formula], text=True, env=environment).split())
    roots = []
    for formula in sorted(dependencies):
        prefix = subprocess.check_output([brew, '--prefix', formula], text=True, env=environment).strip()
        dependency = Path(prefix).absolute()
        dependency.resolve(strict=True)  # Require a live target, keep link spelling.
        roots.append(str(dependency))
    roots.extend(_native_dependency_roots([
        *roots, *(p for entry in runtime.values() for p in entry['roots'])]))
    runtime['worker']['roots'].extend(p for p in roots if p not in runtime['worker']['roots'])
    runtime['worker']['identity']['os_build'] = subprocess.check_output(['sw_vers', '-buildVersion'], text=True).strip()
    version = subprocess.check_output(['git', '-C', str(repo), 'show', 'HEAD:worker/body_model/CURRENT'], text=True).strip()
    return {'body_model': version, 'assets': {
        'blurball': str(ttv / 'blurball'), 'wrapper': str(ttv / 'blurball_infer.py'),
        'table': str(home / 'ponglens-models/table-keypoints'),
        'pose': str(cache / 'rtmpose-production/end2end.onnx'),
        'detector': str(home / '.cache/rtmlib/hub/checkpoints/rtmdet_m_8xb32-100e_coco-obj365-person-235e8209.onnx'),
    }, 'runtime': runtime,
        'behavior_env': behavior_environment({key: os.environ.get(key, default)
                                               for key, default in BEHAVIOR_DEFAULTS.items()})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    discover = commands.add_parser('inspect-local', help='Write local dependency paths and runtime identities; does not build or run')
    discover.add_argument('--repo', type=Path, default=Path.cwd())
    discover.add_argument('--output', type=Path, required=True)
    builder = commands.add_parser('build')
    builder.add_argument('--repo', type=Path, default=Path.cwd())
    builder.add_argument('--commit', default='HEAD')
    builder.add_argument('--config', type=Path, required=True)
    builder.add_argument('--output', type=Path, required=True)
    checker = commands.add_parser('verify')
    checker.add_argument('release', type=Path)
    checker.add_argument('--expected-id')
    installer = commands.add_parser('stage')
    installer.add_argument('release', type=Path)
    installer.add_argument('--destination', type=Path, required=True)
    runner = commands.add_parser('run')
    runner.add_argument('release', type=Path)
    runner.add_argument('--state', type=Path, required=True)
    runner.add_argument('--lane', choices=('main', 'fast'), default='main')
    runner.add_argument('--check-only', action='store_true', help='Resolve and verify without starting a worker')
    args = parser.parse_args()
    try:
        if args.command == 'inspect-local':
            config = local_config(args.repo)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(config, indent=2) + '\n')
            print(args.output)
        elif args.command == 'build':
            print(build(args.repo, args.output, json.loads(args.config.read_text()), args.commit))
        elif args.command == 'verify':
            print(verify(args.release, args.expected_id)['release_id'])
        elif args.command == 'stage':
            print(stage(args.release, args.destination))
        elif args.command == 'run':
            command, env, cwd = prepare_run(args.release, args.state, args.lane)
            if args.check_only:
                print(json.dumps({'release': env['PONGLENS_MATCH_RELEASE'], 'command': command, 'cwd': cwd,
                                  'status': 'verified, not started'}, indent=2))
            else:
                os.chdir(cwd)
                os.execve(command[0], command, env)
    except (ReleaseError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Release error: {error}\n')


if __name__ == '__main__':
    main()
