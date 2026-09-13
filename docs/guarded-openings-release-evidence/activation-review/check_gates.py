import ast
import contextlib
from datetime import datetime, timezone, timedelta
import json
import hashlib
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import os
import signal
import subprocess
import time

ROOT = Path(__file__).parent
SOURCE = Path('/private/tmp/ponglens-guarded-release/activate.py')

class Connection:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def cursor(self): return self
    def execute(self, *args): pass
    def fetchone(self): return (datetime.now(timezone.utc) - timedelta(days=1),)

class Gates(unittest.TestCase):
    def setUp(self):
        self.base = ROOT / self._testMethodName
        self.base.mkdir(exist_ok=True)
        self.r = SimpleNamespace(STATE=self.base/'new', STAGING=self.base/'staging',
            BACKUP=self.base/'backup', OLD_ID='a'*64, RELEASE_ID='b'*64,
            LANES={'main': ('main-label', 'PongLensWorker', 0),
                   'fast': ('fast-label', 'PongLensWorkerFast', 0)},
            MONITOR='monitor', connection=lambda *args: Connection(),
            loaded=lambda label: False, run=Mock(), install=Mock(), start=Mock(), resume=Mock())
        for p in (self.r.STATE,self.r.STAGING,self.r.BACKUP,self.base/'old'):
            p.mkdir(exist_ok=True)
        for p in self.r.STATE.iterdir(): p.unlink()
        for p in (self.base/'old').iterdir(): p.unlink()
        for p in self.r.STAGING.iterdir(): p.unlink()
        tree = ast.parse(SOURCE.read_text())
        tree.body = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
        self.ns = dict(r=self.r, OLD_STATE=self.base/'old', Path=Path, json=json, hashlib=hashlib,
            datetime=datetime, timezone=timezone, os=os, signal=signal,
            subprocess=subprocess, time=time)
        exec(compile(tree,str(SOURCE),'exec'),self.ns)
        self.ns['dependencies'] = lambda conn: None
        self.ns['rows'] = lambda conn: {
            'mac:'+lane: (111, None, 'drained', 'release '+self.r.OLD_ID, True)
            for lane in self.r.LANES}
        for lane, (label, app, _) in self.r.LANES.items():
            bundle = self.r.BACKUP/(app+'.app')
            for rel in ('Contents/Resources/Scripts/main.scpt','Contents/MacOS/applet'):
                path = bundle/rel
                path.parent.mkdir(parents=True,exist_ok=True)
                path.write_text('old bundle')
            (self.r.STAGING/(lane+'.scpt')).write_text('new launcher')
            for root in (self.r.BACKUP,self.r.STAGING):
                (root/(label+'.plist')).write_text('plist')
        for root in (self.r.BACKUP,self.r.STAGING):
            (root/'monitor.plist').write_text('monitor')
        (self.r.STAGING/'prepare-complete.json').write_text(json.dumps({
            'release_id':self.r.RELEASE_ID,'old_release_id':self.r.OLD_ID,
            'files':self.ns['preparation_files']()}))

    def pauses(self):
        for lane in self.r.LANES:
            (self.r.STATE/('drain-'+lane)).touch()
            (self.ns['OLD_STATE']/('drain-'+lane)).touch()

    def test_incomplete_prepare_prevents_drain(self):
        # Exact residual boundary when recipe.prepare fails before monitor backup.
        (self.r.STAGING/'prepare-complete.json').unlink()
        (self.r.BACKUP/'monitor.plist').unlink()
        (self.r.BACKUP/'PongLensWorker.app').mkdir(exist_ok=True)
        for lane in self.r.LANES:
            (self.r.STATE/('drain-'+lane)).touch()
        with self.assertRaises(AssertionError): self.ns['drain']()
        self.assertFalse(any((self.ns['OLD_STATE']/('drain-'+lane)).exists()
                             for lane in self.r.LANES))
        self.assertFalse((self.r.BACKUP/'monitor.plist').exists())

    def test_changed_backup_prevents_stop(self):
        self.pauses()
        (self.r.BACKUP/'monitor.plist').write_text('changed')
        with self.assertRaisesRegex(AssertionError,'artifacts changed'):
            self.ns['stop']()
        self.r.run.assert_not_called()

    def test_missing_fast_backup_prevents_install(self):
        (self.r.BACKUP/'PongLensWorkerFast.app/Contents/MacOS/applet').unlink()
        with self.assertRaises(AssertionError): self.ns['install']()
        self.r.install.assert_not_called()

    def test_active_job_prevents_stop(self):
        self.pauses()
        self.ns['rows'] = lambda conn: {'mac:main': (111, 'active-job', 'ball',
            'release '+self.r.OLD_ID, True)}
        with patch.object(subprocess,'check_output',return_value=''), patch.object(os,'kill') as kill:
            with self.assertRaises(AssertionError): self.ns['stop']()
        kill.assert_not_called()
        self.r.run.assert_not_called()

    def stop_snapshot(self):
        self.ns['rows'] = lambda conn: {'mac:'+lane: (pid,None,'drained','release '+self.r.OLD_ID,True)
            for lane,pid in [('main',111),('fast',211)]}
        result=[]
        for lane,pid,app in [('main',111,'PongLensWorker'),('fast',211,'PongLensWorkerFast')]:
            for process,parent,cmd in [(pid,pid-1,f'python /releases/{self.r.OLD_ID}/worker/worker.py --lane {lane}'),
                    (pid-1,pid-2,'/bin/sh -c bootstrap'),
                    (pid-2,1,f'/Users/adil/Applications/{app}.app/Contents/MacOS/applet')]:
                result.append(f'{process} {parent} Sat Sep 12 12:00:00 2026 {cmd}')
        return '\n'.join(result)

    def test_reused_pid_prevents_signal(self):
        self.pauses()
        initial=self.stop_snapshot()
        changed=initial.replace('111 110 Sat Sep 12 12:00:00','111 1 Sat Sep 12 12:01:00')
        with patch.object(subprocess,'check_output',side_effect=[initial,changed]), patch.object(os,'kill') as kill:
            with self.assertRaisesRegex(AssertionError,'PID identity changed'): self.ns['stop']()
        kill.assert_not_called()
        self.assertFalse((self.r.STAGING/'stop-complete.json').exists())

    def test_stop_records_completion_only_after_processes_exit(self):
        self.pauses()
        initial=self.stop_snapshot()
        with patch.object(subprocess,'check_output',side_effect=[initial]+['']*6), \
                patch.object(os,'kill',side_effect=ProcessLookupError):
            with contextlib.redirect_stdout(None): self.ns['stop']()
        self.assertEqual(len(json.loads((self.r.STAGING/'stop-complete.json').read_text())['pids']),6)

    def test_missing_stop_marker_prevents_install(self):
        with self.assertRaises(AssertionError): self.ns['install']()
        self.r.install.assert_not_called()

    def test_missing_install_marker_prevents_start(self):
        with self.assertRaises(AssertionError): self.ns['start']()
        self.r.start.assert_not_called()

    def test_recorded_pid_still_alive_prevents_install(self):
        (self.r.STAGING/'stop-complete.json').write_text(json.dumps({
            'release_id': self.r.RELEASE_ID,'old_release_id':self.r.OLD_ID,'pids':[111]}))
        with patch.object(os,'kill',return_value=None):
            with self.assertRaises(AssertionError): self.ns['install']()
        self.r.install.assert_not_called()

    def test_monitor_before_start_prevents_resume(self):
        (self.r.STAGING/'started-at.txt').write_text(datetime.now(timezone.utc).isoformat())
        with self.assertRaises(AssertionError): self.ns['resume']()
        self.r.resume.assert_not_called()

if __name__ == '__main__': unittest.main(verbosity=2)
