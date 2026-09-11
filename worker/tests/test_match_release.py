import json
import os
from pathlib import Path
import subprocess
import sys
import shutil
import tempfile
import unittest

from worker.match_release import build, verify, prepare_run, stage, ReleaseError


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.put(self.repo / 'worker/worker.py', 'print("sealed")\n')
        self.put(self.repo / 'worker/points_pipeline.py', '# points\n')
        self.put(self.repo / 'worker/rtm_accel.py', '# CoreML helper\n')
        self.put(self.repo / 'worker/body_model/v2/model.npz', 'model')
        self.put(self.repo / 'worker/body_model/v2/edge.npz', 'edge')
        self.put(self.repo / 'worker/body_model/v2/features.sha', 'features')
        shutil.copytree(Path(__file__).parents[1] / 'match_release', self.repo / 'worker/match_release',
                        ignore=shutil.ignore_patterns('__pycache__'))
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'baseline')
        assets = {}
        for name in ('blurball', 'table', 'pose', 'detector', 'coreml'):
            path = self.root / name
            self.put(path, name)
            assets[name] = str(path)
        self.put(self.root / 'wrapper', 'REPO = "/Users/adil/Desktop/Projects/TTVid/vendor/blurball"\n')
        assets['wrapper'] = str(self.root / 'wrapper')
        # An actual executable, small enough to hash repeatedly in these tests.
        self.runtime = self.root / 'runtime'
        self.put(self.runtime, '#!/bin/sh\nexec /usr/bin/true "$@"\n')
        self.runtime.chmod(0o755)
        self.config = {'assets': assets, 'body_model': 'v2', 'runtime': {
            name: {'executable': str(self.runtime), 'roots': [str(self.runtime)]}
            for name in ('worker', 'pipeline', 'rtmpose', 'table', 'ffmpeg', 'ffprobe', 'ytdlp')}}

    def put(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args]).decode().strip()

    def built(self):
        return build(self.repo, self.root / 'releases', self.config)

    def test_committed_source_is_frozen_and_build_is_repeatable(self):
        first = self.built()
        self.put(self.repo / 'worker/worker.py', 'raise Exception("checkout changed")')
        self.assertEqual(self.built(), first)
        self.assertEqual((first / 'worker/worker.py').read_text(), 'print("sealed")\n')
        self.assertEqual(verify(first)['source_commit'], self.git('rev-parse', 'HEAD'))

    def test_payload_changed_missing_extra_and_symlink_rejected(self):
        for mutation in ('changed', 'missing', 'extra', 'symlink'):
            with self.subTest(mutation=mutation):
                release = self.built()
                target = release / 'worker/worker.py'
                original = target.read_bytes()
                if mutation == 'changed': target.write_text('tampered')
                elif mutation == 'missing': target.unlink()
                elif mutation == 'extra': self.put(release / 'surprise.py', 'extra')
                else:
                    target.unlink()
                    target.symlink_to(self.repo / 'worker/worker.py')
                with self.assertRaises(ReleaseError): verify(release)
                if mutation == 'extra': (release / 'surprise.py').unlink()
                else:
                    if target.is_symlink(): target.unlink()
                    target.write_bytes(original)

    def test_runtime_mutation_and_missing_model_fail_before_launch(self):
        release = self.built()
        self.runtime.write_text('changed')
        with self.assertRaises(ReleaseError): prepare_run(release, self.root / 'state')
        self.config['assets']['pose'] = str(self.root / 'missing')
        with self.assertRaises(ReleaseError): self.built()

    def test_child_paths_resolve_once_and_caches_are_outside(self):
        release = self.built()
        pointer = self.root / 'current'
        pointer.symlink_to(release, target_is_directory=True)
        command, env, cwd = prepare_run(pointer, self.root / 'state')
        pointer.unlink()
        pointer.symlink_to(self.repo, target_is_directory=True)
        self.assertEqual(command[1], str(release / 'worker/worker.py'))
        self.assertEqual(env['PONGLENS_MATCH_RELEASE'], str(release))
        self.assertEqual(env['PONGLENS_BODY_MODEL'], 'v2')
        self.assertEqual(env['PYTHONPATH'], str(release / 'worker'))
        self.assertFalse(Path(cwd).is_relative_to(release))
        self.assertFalse(Path(env['PONGLENS_COREML_CACHE']).is_relative_to(release))

    def test_stage_does_not_activate_or_overwrite(self):
        release = self.built()
        destination = stage(release, self.root / 'installed')
        self.assertEqual(verify(destination)['release_id'], release.name)
        self.assertFalse((destination.parent / 'current').exists())
        (destination / 'worker/worker.py').write_text('broken')
        with self.assertRaises(ReleaseError): stage(release, destination.parent)

    def test_manifest_tamper_and_external_symlink_escape_rejected(self):
        release = self.built()
        manifest = release / 'manifest.json'
        data = json.loads(manifest.read_text())
        data['body_model']['version'] = 'v1'
        manifest.write_text(json.dumps(data))
        with self.assertRaises(ReleaseError): verify(release)
        (self.root / 'pose').unlink()
        (self.root / 'pose').symlink_to(self.runtime)
        with self.assertRaises(ReleaseError): self.built()

    def test_real_child_uses_release_after_checkout_changes(self):
        self.put(self.repo / 'worker/worker.py',
                 'import os,subprocess\n'
                 'subprocess.run([os.environ["PONGLENS_PIPELINE_PY"], '
                 'os.path.join(os.environ["PONGLENS_MATCH_RELEASE"],"worker/points_pipeline.py")],check=True)\n')
        self.put(self.repo / 'worker/points_pipeline.py', 'print("committed child")\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'child')
        for name in ('worker', 'pipeline'):
            self.config['runtime'][name] = {'executable': sys.executable, 'roots': [sys.executable]}
        release = self.built()
        self.put(self.repo / 'worker/points_pipeline.py', 'raise Exception("mutable checkout")\n')
        command, env, cwd = prepare_run(release, self.root / 'state')
        result = subprocess.run(command, env=env, cwd=cwd, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'committed child')
        # Changing an anchor AFTER prepare_run still prevents child code execution.
        self.runtime.write_text('changed after startup')
        result = subprocess.run(command, env=env, cwd=cwd, text=True, capture_output=True)
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertNotIn('committed child', result.stdout)

    def test_runtime_extra_file_is_rejected_with_warm_verification_cache(self):
        runtime_dir = self.root / 'libraries'
        self.put(runtime_dir / 'dependency.py', 'original')
        self.config['runtime']['worker']['roots'].append(str(runtime_dir))
        release = self.built()
        verify(release)
        self.put(runtime_dir / 'new.pth', 'import attacker')
        with self.assertRaises(ReleaseError): verify(release)


if __name__ == '__main__':
    unittest.main()
