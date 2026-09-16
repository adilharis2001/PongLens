"""Immutable-output offline replay of the handoff inputs with both options on."""
import argparse
import json
import os
from pathlib import Path
import runpy
import socket
import sys

ap=argparse.ArgumentParser()
ap.add_argument('source')
ap.add_argument('--out', required=True)
ap.add_argument('--without-cleanup', action='store_true')
a=ap.parse_args()
out=Path(a.out).resolve()
if out.exists():
    raise SystemExit('Refusing to overwrite replay evidence')
out.mkdir(parents=True)
worker=Path(__file__).resolve().parents[3]/'worker'
root=Path('/private/tmp/ponglens-julian-split-candidate-20260914')
if a.source in ('6d55dfb7','eabb4fc2'):
    base=root/'fresh'/a.source
    source=dict(video=str(base/('input.mov' if a.source=='6d55dfb7' else 'trimmed.mov')),
                detections=str(base/'blurball.jsonl'))
    players=base/'players.json'
    cal=base/'points_out/calibration.json'
else:
    source=json.loads((Path('/private/tmp/ponglens-net-ending-20260913')/
                       (a.source+'-sequences.json')).read_text())['source']
    base=Path(source['video']).parent
    players=Path('/private/tmp/brianlab/work/players.json') if a.source=='8cb54f9f' else base/'players.json'
    cal=Path('/private/tmp/brianlab/work/calibration.json') if a.source=='8cb54f9f' else base/'staged-assembly/calibration.json'
calibration=json.loads(cal.read_text())
calibration.setdefault('note','Cached production calibration for offline replay')
prepared=out/'input-calibration.json'
prepared.write_text(json.dumps(calibration))
def denied(*args,**kwargs):
    raise RuntimeError('offline replay forbids network')
socket.socket.connect=denied
socket.socket.connect_ex=denied
socket.create_connection=denied
os.environ['PONGLENS_BODY_MODEL']='v2'
sys.path.insert(0,str(worker))
sys.dont_write_bytecode=True
sys.argv=[str(worker/'points_pipeline.py'),'points','--video',source['video'],
          '--blurball',source['detections'],'--outdir',str(out),'--strictness','normal',
          '--cut-mode','plays','--no-clips','--players',str(players),'--pipeline','bodies',
          '--serve-anchor','--rally-end','--serve-surface-pad','.45','--serve-merge-s','2.5',
          '--calibration-json',str(prepared),'--evidence-dump',str(out/'evidence.json'),
          '--reviewed-net-splits','--combined-cuts']
if not a.without_cleanup:
    sys.argv.append('--whole-clip-cleanup')
runpy.run_path(str(worker/'points_pipeline.py'),run_name='__main__')
