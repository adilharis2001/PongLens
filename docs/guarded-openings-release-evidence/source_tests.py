import subprocess,os,pathlib,json
root=pathlib.Path('/Users/adil/Desktop/Projects/PongLens/.worktrees/guarded-openings-release')
py='/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python'
groups={
'algorithm':['guarded_openings','body_card_edges','rally_preservation','rally_continuation','cut_timeline','cut_timeline_consumers','match_release','body_fallback_reporting','worker_claim_boundary','play_cut_segments','reclip_sources','side_change','table_keypoint_fit','camera_view_check'],
'feedback':['points_pipeline','camera_view_worker','upload_feedback','upload_feedback_integration']}
env=dict(os.environ,DATABASE_URL='postgresql://test:test@127.0.0.1/test',SUPABASE_SERVICE_ROLE_KEY='test-service-role',SUPABASE_URL='https://example.invalid',PYTHONDONTWRITEBYTECODE='1')
result={}
for group,files in groups.items():
 args=['-q','-p','no:cacheprovider']+['worker/tests/test_'+x+'.py' for x in files]
 bootstrap='import worker,pytest;' if group=='algorithm' else 'import sys;sys.path.insert(0,"worker");import worker,pytest;'
 cmd=[py,'-B','-c',bootstrap+'raise SystemExit(pytest.main('+repr(args)+'))']
 log=root/'docs/guarded-openings-release-evidence'/('tests-'+group+'.log')
 with log.open('w') as f:r=subprocess.run(cmd,env=env,cwd=root,stdout=f,stderr=subprocess.STDOUT)
 result[group]=r.returncode
 print(group,r.returncode,log.read_text()[-1400:],flush=True)
(root/'docs/guarded-openings-release-evidence/tests-summary.json').write_text(json.dumps(result,indent=2))
assert not any(result.values()),result
