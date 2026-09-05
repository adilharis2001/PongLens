import json
import os
from pathlib import Path
import tempfile
import unittest
from worker.lesson_release.package import seal, verify, worker_release_id, launch_agent, load_runtime_env

class LessonReleaseTests(unittest.TestCase):
    def fixture(self, root):
        for name in ['lesson_video.py','lesson-video-requirements.txt','cost_meter.py','lesson-font.ttf','lesson_deletion.py']:
            (root/name).write_text(name)
    def test_sealed_payload_refuses_tampering_and_undeclared_files(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);stage=root/'stage';stage.mkdir();self.fixture(stage)
            sealed=seal(stage,root/'dist')
            self.assertEqual(verify(sealed)['worker_release_id'],worker_release_id(sealed))
            (sealed/'extra.py').write_text('bad')
            with self.assertRaises(ValueError):verify(sealed)
            (sealed/'extra.py').unlink();(sealed/'cost_meter.py').write_text('changed')
            with self.assertRaises(ValueError):verify(sealed)
    def test_default_agent_is_separate_disabled_and_uses_exact_release(self):
        p=launch_agent(Path('/tmp/lesson/releases/abc/payload'),Path('/tmp/lesson/releases/abc/venv/bin/python'),Path('/tmp/lesson/runtime.json'),Path('/tmp/lesson/runtime'))
        self.assertTrue(p['Disabled']);self.assertFalse(p['RunAtLoad']);self.assertFalse(p['KeepAlive'])
        self.assertEqual(p['Label'],'com.adil.ponglens-lesson-video-worker')
        self.assertIn('/tmp/lesson/releases/abc/payload/runner.py',p['ProgramArguments'])
        self.assertNotIn('com.adil.ponglens-worker',json.dumps(p))
    def test_runtime_secrets_require_private_file_and_reject_code_environment(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'secrets.json';p.write_text('{"OPENAI_API_KEY":"not-a-real-secret"}');p.chmod(0o644)
            with self.assertRaises(ValueError):load_runtime_env(p)
            p.chmod(0o600);self.assertEqual(load_runtime_env(p)['OPENAI_API_KEY'],'not-a-real-secret')
            p.write_text('{"PYTHONPATH":"/untrusted"}')
            with self.assertRaises(ValueError):load_runtime_env(p)
            p.write_text('{}');s=Path(d)/'link';s.symlink_to(p)
            with self.assertRaises(ValueError):load_runtime_env(s)
if __name__=='__main__':unittest.main()
