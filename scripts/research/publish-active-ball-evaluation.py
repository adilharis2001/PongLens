"""Publish immutable predictions alongside frozen references, never change labels."""
import argparse,hashlib,json,subprocess
from pathlib import Path
import psycopg2
from psycopg2.extras import Json
p=argparse.ArgumentParser();p.add_argument('run',type=Path);p.add_argument('--run-id',default='gemini-3.8-flash-20260905-v1');args=p.parse_args()
rows={r['id']:r for r in json.loads((args.run/'benchmark.json').read_text())}
results=[json.loads(f.read_text()) for f in (args.run/'responses').glob('*.json')]
protocol=json.loads((args.run/'protocol.json').read_text())
assert protocol['model']=='gemini-3.8-flash'
assert protocol['input_sha256']==hashlib.sha256((args.run/'inputs.json').read_bytes()).hexdigest()
protocol_sha=hashlib.sha256((args.run/'protocol.json').read_bytes()).hexdigest()
benchmark_sha=hashlib.sha256((args.run/'benchmark.json').read_bytes()).hexdigest()
run_id=args.run_id
url=subprocess.run(['security','find-generic-password','-a','openclaw','-s','ponglens-db-url','-w'],capture_output=True,text=True,check=True).stdout.strip()
with psycopg2.connect(url) as connection:
 with connection.cursor() as cursor:
  cursor.execute('select id,label,revision from active_ball_samples order by id');before=cursor.fetchall()
  cursor.execute('insert into active_ball_evaluation_runs (run_id,model,protocol_sha256,benchmark_sha256) values (%s,%s,%s,%s) on conflict do nothing',(run_id,protocol['model'],protocol_sha,benchmark_sha))
  cursor.execute('select protocol_sha256,benchmark_sha256 from active_ball_evaluation_runs where run_id=%s',(run_id,))
  assert cursor.fetchone()==(protocol_sha,benchmark_sha),'Run fingerprint mismatch; use a separate run id'
  for r in results:
   ref=rows[r['id']]['label'];label={k:ref[k] for k in ['state','x','y']}
   cursor.execute('insert into active_ball_evaluations (run_id,sample_id,model,prediction,reference_label,reference_revision) values (%s,%s,%s,%s,%s,%s) on conflict do nothing',(run_id,r['id'],protocol['model'],Json(r.get('prediction')),Json(label),ref['revision']))
   cursor.execute('select prediction,reference_label,reference_revision,model from active_ball_evaluations where run_id=%s and sample_id=%s',(run_id,r['id']))
   assert cursor.fetchone()==(r.get('prediction'),label,ref['revision'],protocol['model']),'Immutable result mismatch'
  cursor.execute('select id,label,revision from active_ball_samples order by id');assert cursor.fetchall()==before
print(json.dumps({'published':len(results),'reference_total':len(rows),'human_labels_unchanged':True}))
