import argparse,sys,json,socket,runpy,os
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('source');ap.add_argument('--off',action='store_true');a=ap.parse_args()
W=Path('/Users/adil/Desktop/Projects/PongLens/.worktrees/combined-cuts-worker/worker')
K=Path('/private/tmp/ponglens-julian-split-candidate-20260914')
out=Path(__file__).parent/'pipeline'/a.source/('off' if a.off else 'on');out.mkdir(parents=True,exist_ok=True)
if a.source in ['6d55dfb7','eabb4fc2']:
 base=K/'fresh'/a.source;s=dict(video=str(base/('input.mov' if a.source=='6d55dfb7' else 'trimmed.mov')),detections=str(base/'blurball.jsonl'));players=base/'players.json';cal=base/'points_out/calibration.json'
else:
 s=json.loads((Path('/private/tmp/ponglens-net-ending-20260913')/(a.source+'-sequences.json')).read_text())['source'];base=Path(s['video']).parent
 players=Path('/private/tmp/brianlab/work/players.json') if a.source=='8cb54f9f' else base/'players.json'
 cal=Path('/private/tmp/brianlab/work/calibration.json') if a.source=='8cb54f9f' else base/'staged-assembly/calibration.json'
os.environ['PONGLENS_BODY_MODEL']='v2';sys.path.insert(0,str(W));sys.dont_write_bytecode=True
socket.socket.connect=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('offline replay'))
calibration=json.loads(cal.read_text());calibration.setdefault('note','Cached production calibration for offline replay');cal=out/'input-calibration.json';cal.write_text(json.dumps(calibration))
sys.argv=[str(W/'points_pipeline.py'),'points','--video',s['video'],'--blurball',s['detections'],'--outdir',str(out),'--strictness','normal','--cut-mode','plays','--no-clips','--players',str(players),'--pipeline','bodies','--serve-anchor','--rally-end','--serve-surface-pad','.45','--serve-merge-s','2.5','--calibration-json',str(cal),'--evidence-dump',str(out/'evidence.json'),'--reviewed-net-splits']
if not a.off:sys.argv.append('--combined-cuts')
runpy.run_path(str(W/'points_pipeline.py'),run_name='__main__')
