import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import Mock
import contextlib
import hashlib
import json
import os
import shutil
import tempfile

SOURCE = Path(__file__).parents[1] / 'rollback.py'

class RollbackGates(unittest.TestCase):
    def setUp(self):
        self.r = SimpleNamespace(RELEASE_ID='b'*64, OLD_ID='a'*64,
            RELEASE=Path('/releases')/('b'*64), STATE=Path('/state')/('b'*64),
            LANES={'main':('main','PongLensWorker',0),'fast':('fast','PongLensWorkerFast',0)})
        self.ns = dict(r=self.r, Path=Path, APPS=Path('/apps'),datetime=datetime,
                       hashlib=hashlib,json=json,os=os,shutil=shutil)
        if SOURCE.exists():
            tree=ast.parse(SOURCE.read_text())
            tree.body=[n for n in tree.body if isinstance(n,ast.FunctionDef)]
            exec(compile(tree,str(SOURCE),'exec'),self.ns)
        self.ps={10:(1,'start','/apps/PongLensWorker.app/Contents/MacOS/applet')}
        self.pulse={'mac:main':(12,None,'drained','release '+self.r.RELEASE_ID,True)}

    def validate(self):
        self.assertIn('eligible_processes',self.ns,'Rollback eligibility gate is missing')
        return self.ns['eligible_processes'](self.ps,self.pulse)

    def test_blocked_bootstrap_can_stop_without_fresh_pulse(self):
        self.ps[11]=(10,'start',f'/bin/sh -c python -c prepare_run {self.r.RELEASE} {self.r.STATE}')
        self.ps[12]=(11,'start',f'python -c prepare_run {self.r.RELEASE} {self.r.STATE}')
        self.pulse={}
        self.assertEqual(set(self.validate()),{10,11,12})

    def test_media_worker_needs_fresh_drained_pulse(self):
        self.ps[12]=(10,'start',f'python {self.r.RELEASE}/worker/worker.py --lane main')
        self.pulse={}
        with self.assertRaisesRegex(AssertionError,'fresh drained'):
            self.validate()

    def test_active_job_refuses(self):
        self.ps[12]=(10,'start',f'python {self.r.RELEASE}/worker/worker.py --lane main')
        self.pulse['mac:main']=(12,'job','ball','release '+self.r.RELEASE_ID,True)
        with self.assertRaisesRegex(AssertionError,'fresh drained'):
            self.validate()

    def test_worker_with_child_refuses(self):
        self.ps[12]=(10,'start',f'python {self.r.RELEASE}/worker/worker.py --lane main')
        self.ps[13]=(12,'start','python model-inference.py')
        with self.assertRaisesRegex(AssertionError,'child'):
            self.validate()

    def test_unknown_applet_child_refuses(self):
        self.ps[11]=(10,'start','some unrelated command')
        with self.assertRaisesRegex(AssertionError,'Unexpected'):
            self.validate()

    def test_detached_worker_refuses(self):
        self.ps[12]=(1,'start',f'python {self.r.RELEASE}/worker/worker.py --lane main')
        with self.assertRaisesRegex(AssertionError,'outside'):
            self.validate()

    def test_old_pulse_before_restart_prevents_resume(self):
        started=datetime.now(timezone.utc)
        self.ns['phase']=lambda name: {'started_at':started.isoformat()}
        self.ns['process_snapshot']=lambda: {}
        self.ns['a']=SimpleNamespace(dependencies=lambda conn: None)
        self.ns['old']=SimpleNamespace(resume=Mock())
        class Cursor:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def cursor(self): return self
            def execute(self,*args): pass
            def fetchall(inner):
                return [('mac:main',12,None,'drained','release '+self.r.OLD_ID,
                         started-timedelta(seconds=1),True)]
        self.r.connection=lambda *args: Cursor()
        with self.assertRaisesRegex(AssertionError,'predates startup'):
            self.ns['resume']()
        self.ns['old'].resume.assert_not_called()

    def setup_restore(self):
        temp=tempfile.TemporaryDirectory(dir=SOURCE.parent/'review-activation')
        self.addCleanup(temp.cleanup)
        root=Path(temp.name)
        self.r.BACKUP=root/'backup'
        self.r.PLISTS=root/'plists'
        self.r.STAGING=root/'staging'
        self.r.run=Mock()
        self.ns['APPS']=root/'apps'
        self.ns['saved']=self.r.BACKUP/'failed-candidate'
        self.ns['labels']=['main','fast','monitor']
        self.ns['backups']=lambda: None
        self.ns['stopped']=lambda: None
        self.ns['old']=SimpleNamespace(start=Mock())
        for path in (self.r.BACKUP,self.r.PLISTS,self.r.STAGING,self.ns['APPS']):
            path.mkdir()
        for app in ('PongLensWorker','PongLensWorkerFast'):
            for parent,text in ((self.r.BACKUP,'original signed'),(self.ns['APPS'],'candidate signed')):
                bundle=parent/(app+'.app')
                bundle.mkdir()
                (bundle/'signature').write_text(text)
        for name in self.ns['labels']:
            (self.r.BACKUP/(name+'.plist')).write_text('old '+name)
            (self.r.PLISTS/(name+'.plist')).write_text('new '+name)

    def test_restore_copies_both_whole_apps_and_three_plists(self):
        self.setup_restore()
        with contextlib.redirect_stdout(None): self.ns['restore']()
        for app in ('PongLensWorker','PongLensWorkerFast'):
            self.assertEqual((self.ns['APPS']/(app+'.app/signature')).read_text(),'original signed')
            self.assertEqual((self.ns['saved']/(app+'.app/signature')).read_text(),'candidate signed')
        for name in self.ns['labels']:
            self.assertEqual((self.r.PLISTS/(name+'.plist')).read_text(),'old '+name)
            self.assertEqual((self.ns['saved']/(name+'.plist')).read_text(),'new '+name)
        self.assertTrue((self.r.STAGING/'rollback-restore.json').is_file())

    def test_partial_restore_has_no_completion_and_cannot_start(self):
        self.setup_restore()
        self.r.run.side_effect=RuntimeError('signature verification failed')
        with self.assertRaises(RuntimeError): self.ns['restore']()
        self.assertFalse((self.r.STAGING/'rollback-restore.json').exists())
        with self.assertRaises(FileNotFoundError): self.ns['start']()
        self.ns['old'].start.assert_not_called()

    def test_changed_restored_bundle_refuses_verification(self):
        self.setup_restore()
        with contextlib.redirect_stdout(None): self.ns['restore']()
        (self.ns['APPS']/'PongLensWorkerFast.app/signature').write_text('wrong')
        with self.assertRaises(AssertionError): self.ns['restored']()

if __name__=='__main__': unittest.main(verbosity=2)
