"""Append the frozen 479-point rally run. Default is a rollback-only rehearsal."""
import argparse,json,importlib.util,subprocess,sys,math,re
from pathlib import Path
spec=importlib.util.spec_from_file_location('bundle',Path(__file__).with_name('rally-review.py'));bundle=importlib.util.module_from_spec(spec);spec.loader.exec_module(bundle)
RUN_ID=bundle.RUN_ID;digest=bundle.digest

def validate(records,snapshot):
 rows={r['id']:r for r in snapshot['rows']}
 if len(rows)!=479 or len(records)!=479 or {r['point_id'] for r in records}!=set(rows):raise ValueError('Corpus mismatch')
 for r in records:
  row=rows[r['point_id']];e=snapshot['evidence'][r['point_id']];p=r['payload'];w=p['winner'];b=p['lastBounce']
  assert set(p)=={'version','runId','lastBounce','winner','baselineWinner'} and p['version']==1 and p['runId']==RUN_ID
  assert r['source_revision']==row['revision'] and r['source_sha256']==digest(dict(source=row['source'],evidence=e))
  assert p['baselineWinner'] in [None,'near','far'] and w['side'] in [None,'near','far']
  for key in ['score','threshold']:assert w[key] is None or (type(w[key]) in [int,float] and math.isfinite(w[key]) and .5<=w[key]<=1)
  assert w['side'] is None or (w['score'] is not None and w['threshold'] is not None and w['score']>=w['threshold'])
  if b is not None:
   assert b['side'] in ['near','far'] and 0<=b['agreement']<=1 and row['source']['start']<=b['rawTime']<=row['source']['end']
   if b['origin']=='detected':
    assert re.fullmatch(r'detected:(0|[1-9][0-9]*)',b['id'])
    assert abs(e['bounces'][int(b['id'].split(':')[1])]['t']+e['rawOffset']-b['rawTime'])<1e-8
   else:assert b['origin']=='trajectory' and re.fullmatch(r'added:[0-9a-f-]{36}',b['id'])

def transaction(c,records,snapshot):
 from psycopg2.extras import Json,execute_values
 validate(records,snapshot)
 with c.cursor() as q:
  q.execute("set local lock_timeout='10s'; set local statement_timeout='60s'")
  q.execute('lock table public.point_ending_research,public.point_ending_suggestions in share row exclusive mode')
  q.execute('lock table public.point_ending_evidence,public.point_ending_label_history in share mode')
  def state():
   q.execute('select to_jsonb(r) from public.point_ending_research r order by id');rows=[r[0] for r in q.fetchall()]
   q.execute('select to_jsonb(h) from public.point_ending_label_history h order by point_id,revision');history=[r[0] for r in q.fetchall()]
   return rows,digest(dict(rows=rows,history=history))
  live,before=state();live={r['id']:r for r in live}
  q.execute('select point_id::text,payload from public.point_ending_evidence');evidence=dict(q.fetchall())
  q.execute('select point_id::text,run_id,payload,source_revision,source_sha256 from public.point_ending_suggestions order by point_id,run_id');all_old=q.fetchall();existing={r[0]:r for r in all_old if r[1]==RUN_ID};inserts=[]
  for r in records:
   pid=r['point_id'];assert digest(dict(source=live[pid]['source'],evidence=evidence[pid]))==r['source_sha256'],'Source/evidence changed'
   tup=(pid,RUN_ID,r['payload'],r['source_revision'],r['source_sha256'])
   if pid in existing:assert existing[pid]==tup,'Immutable run differs'
   else:inserts.append(tup)
  if inserts:execute_values(q,'insert into public.point_ending_suggestions(point_id,run_id,payload,source_revision,source_sha256) values %s',[(p,run,Json(v),rev,h) for p,run,v,rev,h in inserts],page_size=500)
  assert state()[1]==before,'Human labels/history changed'
  q.execute('select point_id::text,run_id,payload,source_revision,source_sha256 from public.point_ending_suggestions order by point_id,run_id');after=q.fetchall();bykey={(r[0],r[1]):r for r in after}
  assert all(bykey[(r[0],r[1])]==r for r in all_old),'Earlier suggestions changed'
  assert all(bykey[(r['point_id'],RUN_ID)]==(r['point_id'],RUN_ID,r['payload'],r['source_revision'],r['source_sha256']) for r in records)
  return dict(points=len(records),inserted=len(inserts),already_present=len(existing),human_history_sha256=before,human_rows_and_history_unchanged=True,prior_suggestions_unchanged=True)

def main():
 a=argparse.ArgumentParser();a.add_argument('--snapshot',type=Path,required=True);a.add_argument('--predictions',type=Path,required=True);a.add_argument('--apply',action='store_true');args=a.parse_args();c=None
 try:
  snap=json.loads(args.snapshot.read_text());records=json.loads(args.predictions.read_text());validate(records,snap)
  credential=subprocess.run(['security','find-generic-password','-a','openclaw','-s','ponglens-db-url','-w'],capture_output=True,check=True,text=True).stdout.strip()
  import psycopg2
  c=psycopg2.connect(credential,connect_timeout=15);result=transaction(c,records,snap)
  if args.apply:c.commit()
  else:c.rollback()
  print(json.dumps(dict(**result,committed=args.apply)))
 except Exception as e:
  if c:c.rollback()
  print('Import failed; rolled back. Error type: '+type(e).__name__,file=sys.stderr);return 1
 finally:
  if c:c.close()
 return 0
if __name__=='__main__':sys.exit(main())
