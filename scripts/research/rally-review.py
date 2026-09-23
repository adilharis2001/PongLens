"""Package frozen experimental predictions. No human answers enter prediction mapping.

Use --private-root to read saved experiments and --snapshot for the latest corpus.
The separate import script inserts the resulting payloads, never labels.
"""
import argparse,json,uuid,hashlib
from pathlib import Path
RUN_ID='rally-review-20260923-v1'
def digest(x):return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()
def last_event(h):
 return next(((t,k) for t,k in reversed(h['events']) if 'bounce_' in k and not k.startswith('dead_')),None)
def last_bounce(point_id,history,evidence,source):
 histories=history['histories'];event=last_event(histories[0]) if histories else None
 if event is None:return None
 t,k=event;raw=t+evidence['rawOffset'];tol=2/source['fps']
 if not source['start']<=raw<=source['end']:return None
 total=sum(h['weight'] for h in histories)
 support=sum(h['weight'] for h in histories if (b:=last_event(h)) is not None and abs(b[0]-t)<=tol)
 closest=min(enumerate(evidence['bounces']),key=lambda x:abs(x[1]['t']-t),default=None)
 matched=closest is not None and abs(closest[1]['t']-t)<=tol
 if matched:
  idx,b=closest;ident=f'detected:{idx}';raw=b['t']+evidence['rawOffset']
 else:ident='added:'+str(uuid.uuid5(uuid.UUID(point_id),f'{RUN_ID}:{t:.9f}'))
 if not source['start']<=raw<=source['end']:return None
 return dict(id=ident,rawTime=raw,side=k.rsplit('_',1)[-1],origin='detected' if matched else 'trajectory',agreement=support/total if total else 0)
def generate(root,snapshot):
 read=lambda f:json.loads((root/f).read_text())
 histories={r['point_id']:r for r in read('rally-sequence-v1/histories.json')}
 predictions={r['point_id']:r for r in read('rally-hybrid-v1/predictions.json') if r['variant']=='hybrid'}
 # Only the earlier frozen prediction is used; evaluation truth columns are excluded.
 baseline={r['point_id']:r['combined'] for r in read('net-event-association-v1/evaluation.json')['rows']}
 assert set(histories)=={r['id'] for r in snapshot['rows']}
 out=[]
 for row in snapshot['rows']:
  pid=row['id'];e=snapshot['evidence'][pid];h=histories[pid];p=predictions.get(pid)
  payload=dict(version=1,runId=RUN_ID,lastBounce=last_bounce(pid,h,e,row['source']),winner=dict(side=p['winner'] if p else None,score=p['confidence'] if p else None,threshold=p['threshold'] if p else None),baselineWinner=baseline[pid])
  out.append(dict(point_id=pid,payload=payload,source_revision=row['revision'],source_sha256=digest(dict(source=row['source'],evidence=e))))
 return out
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--private-root',type=Path,required=True);a.add_argument('--snapshot',type=Path,required=True);a.add_argument('--output',type=Path,required=True);args=a.parse_args()
 out=generate(args.private_root,json.loads(args.snapshot.read_text()))
 with args.output.open('x') as f:json.dump(out,f,allow_nan=False)
 print(json.dumps(dict(points=len(out),last_bounce=sum(x['payload']['lastBounce'] is not None for x in out),detected=sum((x['payload']['lastBounce'] or {}).get('origin')=='detected' for x in out),winner_calls=sum(x['payload']['winner']['side'] is not None for x in out),combined_calls=sum((x['payload']['baselineWinner'] or x['payload']['winner']['side']) is not None for x in out))))
