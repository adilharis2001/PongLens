"""Verify actual composed exports against the owner-approved handoff exports."""
import hashlib
import argparse
import json
import re
from pathlib import Path
import sys

worker=Path(__file__).resolve().parents[3]/'worker'
sys.path.insert(0,str(worker))
import point_winner_predictions as WP
import processing_outcome as PO

old=Path('/Users/adil/.codex/visualizations/2026/09/12/01a095f4-f9a4-70b3-9ba8-50ac2967d965/ponglens-combined-worker-review/evidence/exports')
ap=argparse.ArgumentParser()
ap.add_argument('--runs',default='/private/tmp/ponglens-reconciled-cleanup-20260914')
new=Path(ap.parse_args().runs).resolve()
approved={'50caea29':[[1011.07,1013.60],[1021.94,1028.25]],
          '19a1efc7':[[40.65,43.55],[665.62,674.46]]}
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text())
rows=[]
for source in sorted(old.iterdir()):
    if not source.is_dir():
        continue
    sid=source.name
    baseline=read(source/'match.json')
    result=read(new/sid/'match.json')
    dropped=approved.get(sid,[])
    expected=[s for s in baseline['cut_segments'] if s not in dropped]
    assert all(s in baseline['cut_segments'] for s in dropped),(sid,'missing approved interval')
    assert result['cut_segments']==expected,(sid,'retained export boundaries changed')
    assert result['processing']['combined_cuts']['status']=='used'
    assert result['processing']['whole_clip_cleanup']['status']=='used'
    body_note=next(n for n in result['notes'] if n.startswith('points bodies:'))
    count,stamped=map(int,re.search(r'points bodies: (\d+) cards, (\d+) with a serve',body_note).groups())
    assert count==len(result['points']),(sid,'stale body note count')
    assert stamped==sum(p.get('serve_s') is not None for p in result['points']),(sid,'stale serve count')
    originals={(p['t0'],p['t1']):p for p in baseline['points']}
    actual_keys={(p['t0'],p['t1']) for p in result['points']}
    removed=[p for key,p in originals.items() if key not in actual_keys]
    assert len(removed)==len(dropped),(sid,'unexpected removal count')
    assert all(any(a<=p['t0']<p['t1']<=b for a,b in dropped) for p in removed)
    for i,p in enumerate(result['points'],1):
        previous=originals[(p['t0'],p['t1'])]
        assert p['idx']==i and p['clip']==f'points/{i:02d}.mp4'
        unchanged=lambda q:{k:v for k,v in q.items() if k not in
                            ('idx','clip','cut_t0','rally_end_cut_s')}
        assert unchanged(p)==unchanged(previous),(sid,i,'retained point metadata changed')
        shift=sum(b-a for a,b in dropped if b<=p['clip_t0'])
        assert abs(previous['cut_t0']-p['cut_t0']-shift)<.031,(sid,i,'cut clock')
        if p['rally_end_cut_s'] is not None:
            assert abs(previous['rally_end_cut_s']-p['rally_end_cut_s']-shift)<.031
    validated=WP.load_predictions(new/sid,result['points'])
    assert len(validated)==len(result['points'])
    assert all(p['status']!='error' for p in validated),(sid,'private validator')
    before_private=read(source/'point_winner_predictions.json')['points']
    after_private=read(new/sid/'point_winner_predictions.json')['points']
    private_by_window={(p['evaluated_t0'],p['evaluated_t1']):p for p in before_private}
    for p in after_private:
        previous=private_by_window[(p['evaluated_t0'],p['evaluated_t1'])]
        assert {k:v for k,v in p.items() if k!='idx'}=={k:v for k,v in previous.items() if k!='idx'}
    # Exercise the actual publication decorator without mutating replay evidence.
    publication=new/sid/'publication-check.json'
    publication.write_text(json.dumps(result))
    for _ in range(2):
        run=PO.ProcessingRun('offline:'+sid,'offline','bodies',
                            {'combined_cuts':True,'whole_clip_cleanup':True})
        record=run.attach(publication)
        assert record['status']=='used'
        published=read(publication)
        assert published['points']==result['points']
        assert published['processing']['whole_clip_cleanup']==result['processing']['whole_clip_cleanup']
        assert published['processing']['combined_cuts']==result['processing']['combined_cuts']
    rows.append(dict(source=sid,before=len(baseline['points']),after=len(result['points']),
        removed_exports=dropped,private_rows=len(validated),
        cleanup_seconds=result['processing']['whole_clip_cleanup']['seconds'],
        baseline_sha256=sha(source/'match.json'),result_sha256=sha(new/sid/'match.json')))
report=dict(recordings=rows,all_passed=True,
    worker_sha256={name:sha(worker/name) for name in ('combined_cuts.py','whole_clip_cleanup.py',
        'points_v2.py','points_pipeline.py','processing_outcome.py','worker.py')},
    limits=['Cached ball/player inference; not a fresh upload or sealed-package check.',
            'No production changes, no table rejection, no global default activation.'])
(new/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
