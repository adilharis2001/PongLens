"""Publish the frozen local-model human audit without changing human labels."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import psycopg2
from psycopg2.extras import Json


parser=argparse.ArgumentParser();parser.add_argument('audit',type=Path);parser.add_argument('checkpoint',type=Path);parser.add_argument('benchmark',type=Path);parser.add_argument('--run-id',default='ponglens-yolo26n-20260905-v3');args=parser.parse_args()
rows={row['id']:row for row in json.loads(args.benchmark.read_text())};predictions=json.loads((args.audit/'predictions.json').read_text());summary=json.loads((args.audit/'summary.json').read_text())
assert summary['threshold']==.2 and len(predictions)==len(rows)==178
digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
benchmark_sha=digest(args.benchmark);model='PongLens YOLO26n v1'
root=Path(__file__).resolve().parents[2]
training_protocol=args.checkpoint.parents[2]/'finetune-protocol.json'
training=json.loads(training_protocol.read_text());scale_root=args.checkpoint.parents[4]
protocol={
 'model':model,'architecture':summary['architecture'],'imgsz':summary['imgsz'],'threshold':summary['threshold'],
 'checkpoint_sha256':digest(args.checkpoint),'benchmark_sha256':benchmark_sha,
 'summary_sha256':digest(args.audit/'summary.json'),'predictions_sha256':digest(args.audit/'predictions.json'),
 'preprocessing_sha256':digest(root/'worker/active_ball_yolo.py'),
 'evaluator_sha256':digest(root/'worker/evaluate_active_ball_yolo.py'),
 'training_protocol':training,
 'base_checkpoint_sha256':digest(Path(training['base_model'])),
 'source_manifest_sha256':digest(scale_root/'manifest.json'),
 'teacher_manifest_sha256':digest(scale_root/'gemini-run2/teacher-manifest.json'),
}
protocol_text=json.dumps(protocol,sort_keys=True,separators=(',',':'));protocol_sha=hashlib.sha256(protocol_text.encode()).hexdigest()
(args.audit/'published-protocol.json').write_text(json.dumps({**protocol,'protocol_sha256':protocol_sha},indent=2))
url=subprocess.run(['security','find-generic-password','-a','openclaw','-s','ponglens-db-url','-w'],capture_output=True,text=True,check=True).stdout.strip()
with psycopg2.connect(url) as connection:
 with connection.cursor() as cursor:
  cursor.execute('select id,label,revision from active_ball_samples order by id');before=cursor.fetchall()
  current={sample_id:(label,revision) for sample_id,label,revision in before}
  for sample_id,row in rows.items():
   reference=row['label'];expected={key:reference[key] for key in ('state','x','y')}
   assert current.get(sample_id)==(expected,reference['revision']),f'benchmark label changed: {sample_id}'
  cursor.execute('insert into active_ball_evaluation_runs (run_id,model,protocol_sha256,benchmark_sha256) values (%s,%s,%s,%s) on conflict do nothing',(args.run_id,model,protocol_sha,benchmark_sha))
  cursor.execute('select protocol_sha256,benchmark_sha256 from active_ball_evaluation_runs where run_id=%s',(args.run_id,));assert cursor.fetchone()==(protocol_sha,benchmark_sha)
  for sample_id,prediction in predictions.items():
   reference=rows[sample_id]['label'];label={key:reference[key] for key in ('state','x','y')}
   cursor.execute('insert into active_ball_evaluations (run_id,sample_id,model,prediction,reference_label,reference_revision) values (%s,%s,%s,%s,%s,%s) on conflict do nothing',(args.run_id,sample_id,model,Json(prediction),Json(label),reference['revision']))
   cursor.execute('select prediction,reference_label,reference_revision,model from active_ball_evaluations where run_id=%s and sample_id=%s',(args.run_id,sample_id));assert cursor.fetchone()==(prediction,label,reference['revision'],model)
  cursor.execute('select id,label,revision from active_ball_samples order by id');assert cursor.fetchall()==before
print(json.dumps({'published':len(predictions),'human_labels_unchanged':True,'run_id':args.run_id}))
