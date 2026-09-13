"""Run required sealed-package checks without real credentials or queues."""
import argparse,json,os,subprocess,time
from pathlib import Path
ROOT=Path(__file__).parent
ap=argparse.ArgumentParser();ap.add_argument('--release',required=True);ap.add_argument('--modes',nargs='+',required=True)
args=ap.parse_args()
PY='/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python'
SCRIPT='/Users/adil/Desktop/Projects/PongLens/.worktrees/guarded-openings-release/worker/tests/smoke_match_release.py'
env=dict(os.environ)
for key in ['DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_URL','R2_ACCOUNT_ID',
            'R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','PONGLENS_RESEND_KEY','OPENAI_API_KEY']:
    env[key]='offline-import-placeholder'
env['SUPABASE_URL']='https://offline.invalid'
env['DATABASE_URL']='postgresql://offline:offline@127.0.0.1:1/offline'
results=[]
for name in args.modes:
    mode='side-changes' if name=='side-changes-repeat' else name
    state=ROOT/'smoke'/('side-changes' if name=='side-changes-repeat' else name)
    start=time.perf_counter()
    result=subprocess.run([PY,'-B',SCRIPT,'--release',args.release,'--state',str(state),
                           '--video',str(ROOT/'smoke-video.mp4'),'--mode',mode],
                          env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=1200)
    (ROOT/('smoke-'+name+'.log')).write_text(result.stdout)
    record=dict(mode=name,exit_code=result.returncode,seconds=time.perf_counter()-start)
    results.append(record);print(json.dumps(record),flush=True)
(ROOT/('smoke-run-'+'-'.join(args.modes)+'.json')).write_text(json.dumps(results,indent=2))
assert all(r['exit_code']==0 for r in results),results
