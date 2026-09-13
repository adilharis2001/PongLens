import sys,subprocess,json,pathlib
sys.dont_write_bytecode=True
release=pathlib.Path(sys.argv[1]);mode=sys.argv[2];R=pathlib.Path(__file__).parent
sys.path.insert(0,str(release/'worker'));from match_release import prepare_run,verify
_,env,cwd=prepare_run(release,R/('state-'+mode))
for key in ['DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','PONGLENS_RESEND_KEY','OPENAI_API_KEY']:
 env[key]='offline-import-placeholder'
env['SUPABASE_URL']='https://offline.invalid';env['DATABASE_URL']='postgresql://offline:offline@127.0.0.1:1/offline'
py=env['PONGLENS_PIPELINE_PY']
if mode=='replay':
 commands=[[py,'-B',R/'replay_edges.py',release/'worker',R/'sealed-edges.json'],[py,'-B',R/'replay_full.py',release/'worker',R/'sealed-full'],[py,'-B',R/'replay_rallies.py','--worker',release/'worker','--out',R/'sealed-rallies']]
elif mode=='export':commands=[[py,'-B',R/'full_export.py']]
else:raise ValueError(mode)
for cmd in commands:subprocess.run(list(map(str,cmd)),env=env,cwd=cwd,check=True)
m=verify(release)
(R/(mode+'-verified.json')).write_text(json.dumps(dict(release_id=m['release_id'],passed=True),indent=2))
