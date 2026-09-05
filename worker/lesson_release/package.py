#!/usr/bin/env python3
"""Seal and stage a separate lesson worker. Nothing starts without `enable`."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile

LABEL = 'com.adil.ponglens-lesson-video-worker'
DEFAULT_ROOT = Path.home() / 'Library/Application Support/PongLensLessonVideoWorker'
WORKER_FILES = ('lesson_video.py', 'lesson-video-requirements.txt', 'cost_meter.py', 'lesson-font.ttf')
ENV_KEYS = {'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY','DEEPGRAM_API_KEY',
            'R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','LESSON_VIDEO_WORKER_ID'}

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for data in iter(lambda:f.read(1024*1024),b''): h.update(data)
    return h.hexdigest()

def canonical(data):
    return json.dumps(data,sort_keys=True,separators=(',',':')).encode()

def worker_release_id(payload):
    h=hashlib.sha256()
    for name in WORKER_FILES:
        h.update(name.encode()); h.update((Path(payload)/name).read_bytes())
    return 'lesson-video-'+h.hexdigest()[:16]

def inventory(root):
    result={}
    for p in sorted(Path(root).rglob('*')):
        if p.is_symlink(): raise ValueError('Symlinks are not allowed in a sealed payload')
        if p.is_file() and p!=Path(root)/'manifest.json': result[p.relative_to(root).as_posix()]=sha(p)
    return result

def seal(stage,output):
    stage,output=Path(stage).resolve(),Path(output).resolve()
    manifest={'schema':1,'worker_release_id':worker_release_id(stage),'files':inventory(stage)}
    bundle_id=hashlib.sha256(canonical(manifest)).hexdigest()
    target=output/bundle_id/'payload'
    if target.exists():
        verify(target)
        return target
    target.parent.mkdir(parents=True)
    shutil.copytree(stage,target)
    (target/'manifest.json').write_bytes(canonical(manifest))
    verify(target)
    return target

def verify(payload):
    payload=Path(payload)
    if payload.is_symlink() or payload.resolve()!=payload.absolute(): raise ValueError('Use a canonical sealed payload path')
    manifest=json.loads((payload/'manifest.json').read_text())
    if hashlib.sha256(canonical(manifest)).hexdigest()!=payload.parent.name:
        raise ValueError('Release directory does not match manifest digest')
    if manifest.get('schema')!=1 or inventory(payload)!=manifest['files']:
        raise ValueError('Sealed payload has modified, missing or extra files')
    if worker_release_id(payload)!=manifest['worker_release_id']:
        raise ValueError('Worker release ID does not match sealed source')
    return manifest

def load_runtime_env(path):
    if not path: return {}
    path=Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_uid!=os.getuid() or path.stat().st_mode&0o777!=0o600:
        raise ValueError('Runtime secrets must be an owned regular file with mode 0600')
    values=json.loads(path.read_text())
    if not isinstance(values,dict) or set(values)-ENV_KEYS or any(not isinstance(v,str) for v in values.values()):
        raise ValueError('Runtime secrets contain an unsupported key or value')
    return values

def launch_agent(payload,python,config,runtime):
    return {'Label':LABEL,'ProgramArguments':[str(python),'-I','-B',str(payload/'runner.py'),'--config',str(config)],
            'WorkingDirectory':str(runtime),'RunAtLoad':False,'KeepAlive':False,'Disabled':True,
            'ThrottleInterval':30,'StandardOutPath':str(runtime/'stdout.log'),
            'StandardErrorPath':str(runtime/'stderr.log')}

def immutable(payload):
    for p in payload.rglob('*'): p.chmod(0o555 if p.is_dir() else 0o444)
    payload.chmod(0o555)

def build(source,output):
    source=Path(source).resolve(); tools=Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix='lesson-seal-') as d:
        stage=Path(d)
        for name in (*WORKER_FILES,'lesson-font-LICENSE.txt'):
            p=source/name
            if not p.is_file() or p.is_symlink(): raise ValueError('Missing regular release input: '+name)
            shutil.copyfile(p,stage/name)
        for name in ('package.py','runner.py','modal_app.py','requirements.lock'):
            shutil.copyfile(tools/name,stage/name)
        declared={x.strip().lower() for x in (stage/'lesson-video-requirements.txt').read_text().splitlines() if x.strip() and not x.startswith('#')}
        locked={x.strip().lower() for x in (stage/'requirements.lock').read_text().splitlines() if x.strip() and not x.startswith('#')}
        if not declared<=locked or any('==' not in x for x in locked): raise ValueError('Refresh the exact dependency lock for the current requirements')
        # The existing worker hashes this filename: include transitive versions.
        shutil.copyfile(stage/'requirements.lock',stage/'lesson-video-requirements.txt')
        result=seal(stage,Path(output).resolve())
        immutable(result)
        return result

def dependency_inventory(venv):
    result={}
    for root in Path(venv).glob('lib/python*/site-packages'):
        for p in root.rglob('*'):
            if '__pycache__' in p.parts or p.suffix=='.pyc': continue
            if p.is_symlink(): raise ValueError('Unexpected symlink in runtime dependencies')
            if p.is_file():result[p.relative_to(venv).as_posix()]=sha(p)
    if not result:raise ValueError('Runtime dependencies missing')
    return result

def verify_runtime(config):
    config=Path(config)
    if config.is_symlink() or config.stat().st_mode&0o022: raise ValueError('Runtime config must not be writable by other users')
    c=json.loads(config.read_text())
    payload=Path(c['payload']);m=verify(payload)
    if m['worker_release_id']!=c['worker_release_id']:raise ValueError('Runtime points at another worker release')
    for tool in ('python','ffmpeg','ffprobe'):
        p=Path(c[tool])
        if not p.is_absolute() or p.resolve()!=p or not os.access(p,os.X_OK) or sha(p)!=c[tool+'_sha256']:
            raise ValueError('Runtime executable changed: '+tool)
    venv=Path(c['venv'])
    if dependency_inventory(venv)!=c['dependencies']:raise ValueError('Installed dependencies changed')
    if c.get('secrets_file'):
        secret=Path(c['secrets_file']).resolve()
        if secret.is_relative_to(payload.parent):raise ValueError('Secrets must remain outside the release')
        load_runtime_env(Path(c['secrets_file']))
    return c

def install(payload,root,python,ffmpeg,ffprobe,secrets_file=None):
    payload=Path(payload).resolve();m=verify(payload);root=Path(root).resolve()
    if root.name=='PongLensWorker':raise ValueError('Refusing the match worker installation root')
    destination=root/'releases'/payload.parent.name
    if destination.exists():raise ValueError('Release already installed; verify the existing installation')
    destination.mkdir(parents=True)
    installed=destination/'payload';shutil.copytree(payload,installed);verify(installed)
    venv=destination/'venv'
    subprocess.run([str(python),'-m','venv',str(venv)],check=True)
    subprocess.run([str(venv/'bin/python'),'-m','pip','install','--disable-pip-version-check','--no-deps','-r',str(installed/'requirements.lock')],check=True)
    subprocess.run([str(venv/'bin/python'),'-m','pip','check'],check=True)
    runtime=root/'runtime';runtime.mkdir(exist_ok=True);(runtime/'work').mkdir(exist_ok=True)
    config={'payload':str(installed),'venv':str(venv),'runtime':str(runtime),'worker_release_id':m['worker_release_id'],
            'dependencies':dependency_inventory(venv),'secrets_file':str(Path(secrets_file).absolute()) if secrets_file else None}
    for name,value in [('python',venv/'bin/python'),('ffmpeg',ffmpeg),('ffprobe',ffprobe)]:
        p=Path(value).resolve();config[name]=str(p);config[name+'_sha256']=sha(p)
    config_path=root/(payload.parent.name+'.runtime.json')
    config_path.write_text(json.dumps(config,sort_keys=True));config_path.chmod(0o600)
    verify_runtime(config_path);immutable(installed)
    plist=root/(payload.parent.name+'.disabled.plist')
    plist.write_bytes(plistlib.dumps(launch_agent(installed,venv/'bin/python',config_path,runtime)))
    plist.chmod(0o600)
    return config_path,plist

def enable(config,confirmation):
    config=Path(config).resolve();c=verify_runtime(config)
    if confirmation!=c['worker_release_id']:raise ValueError('Exact worker release ID confirmation required')
    domain='gui/'+str(os.getuid());target=domain+'/'+LABEL
    exists=subprocess.run(['launchctl','print',target],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if exists.returncode==0:raise ValueError('Lesson service is already registered; stop it explicitly before switching releases')
    p=launch_agent(Path(c['payload']),Path(c['venv'])/'bin/python',config,Path(c['runtime']))
    p.update(Disabled=False,RunAtLoad=True,KeepAlive=True)
    path=Path.home()/'Library/LaunchAgents'/(LABEL+'.plist');path.parent.mkdir(exist_ok=True)
    path.write_bytes(plistlib.dumps(p));path.chmod(0o600)
    subprocess.run(['launchctl','enable',target],check=True)
    subprocess.run(['launchctl','bootstrap',domain,str(path)],check=True)

def main():
    p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='command',required=True)
    b=s.add_parser('build');b.add_argument('--source',type=Path,required=True);b.add_argument('--output',type=Path,required=True)
    v=s.add_parser('verify');v.add_argument('payload',type=Path)
    i=s.add_parser('install');i.add_argument('payload',type=Path);i.add_argument('--root',type=Path,default=DEFAULT_ROOT)
    i.add_argument('--python',type=Path,required=True);i.add_argument('--ffmpeg',type=Path,required=True);i.add_argument('--ffprobe',type=Path,required=True);i.add_argument('--secrets-file',type=Path)
    r=s.add_parser('verify-runtime');r.add_argument('config',type=Path)
    e=s.add_parser('enable');e.add_argument('config',type=Path);e.add_argument('--confirm-release-id',required=True)
    a=p.parse_args()
    if a.command=='build':print(build(a.source,a.output))
    elif a.command=='verify':print(json.dumps(verify(a.payload),sort_keys=True))
    elif a.command=='install':
        config,plist=install(a.payload,a.root,a.python,a.ffmpeg,a.ffprobe,a.secrets_file)
        print(json.dumps({'runtime_config':str(config),'disabled_plist':str(plist),'started':False}))
    elif a.command=='verify-runtime':print(json.dumps({'worker_release_id':verify_runtime(a.config)['worker_release_id'],'verified':True}))
    elif a.command=='enable':enable(a.config,a.confirm_release_id)
if __name__=='__main__':main()
