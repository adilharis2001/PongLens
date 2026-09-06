import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from worker.lesson_release.package import LINUX_FFMPEG_ARTIFACT_SHA256, LINUX_FFMPEG_BINARY_SHA256, LINUX_FFPROBE_BINARY_SHA256, LINUX_FFMPEG_VERSION, linux_media_install_commands, seal, verify, verify_linux_media_tools, worker_release_id, launch_agent, load_runtime_env

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
    def test_linux_media_tools_require_the_pinned_artifact_and_lesson_filters(self):
        commands=[]
        def output(command,**kwargs):
            commands.append(command)
            if '-filters' in command: return ' ... zscale ...\n'
            if '-encoders' in command: return ' V.... libx264\n A.... aac\n'
            if command[0].endswith('/ffmpeg'): return 'ffmpeg version '+LINUX_FFMPEG_VERSION+'\n'
            return 'ffprobe version '+LINUX_FFMPEG_VERSION+'\n'
        with patch('worker.lesson_release.package.sha',side_effect=[LINUX_FFMPEG_BINARY_SHA256,LINUX_FFPROBE_BINARY_SHA256]),patch('worker.lesson_release.package.subprocess.check_output',side_effect=output):
            verify_linux_media_tools()
        self.assertTrue(any(command[0].endswith('/ffprobe') and command[1]=='-version' for command in commands))
    def test_modal_media_install_checks_immutable_artifact_before_extracting(self):
        commands='\n'.join(linux_media_install_commands())
        self.assertIn(LINUX_FFMPEG_ARTIFACT_SHA256,commands)
        self.assertIn('sha256sum -c -',commands)
        self.assertIn('releases/assets/',commands)
    def test_modal_uses_default_ephemeral_disk_quota(self):
        source=(Path(__file__).parents[1]/'lesson_release'/'modal_app.py').read_text()
        self.assertNotIn('ephemeral_disk=',source)
if __name__=='__main__':unittest.main()
