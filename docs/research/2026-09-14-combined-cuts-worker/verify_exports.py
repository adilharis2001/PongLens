import json,sys
from pathlib import Path
O=Path(__file__).parent
sys.path.insert(0,'/private/tmp/ponglens-combined-cuts-20260914')
import candidate as old
sys.path.insert(0,'/Users/adil/Desktop/Projects/PongLens/.worktrees/combined-cuts-worker/worker')
import point_winner_predictions as WP
rows=[]
for parent in sorted((O/'pipeline').iterdir()):
 ident=parent.name
 on=json.loads((parent/'on/match.json').read_text());off=json.loads((parent/'off/match.json').read_text());ref=json.loads((O/'context-replay'/f'{ident}.json').read_text());baseline=old.baseline(ident)
 assert len(off['points'])==len(baseline),(ident,'off count')
 assert [[c['t0'],c['t1']] for c in off['points']]==[[c['t0'],c['t1']] for c in baseline],(ident,'off timing')
 # Compare whole exported point metadata when the older baseline has it.
 metadata_parity=off['points']==baseline
 assert metadata_parity,(ident,'off point metadata')
 assert len(on['points'])==len(ref['cards']),(ident,'candidate count')
 delta=max(abs(a[k]-b[k]) for a,b in zip(on['points'],ref['cards']) for k in ('t0','t1'))
 assert delta<=.030001,(ident,delta)
 assert on['processing']['combined_cuts']['status']=='used'
 pred=json.loads((parent/'on/point_winner_predictions.json').read_text());pred=pred['points'] if isinstance(pred,dict) else pred
 assert len(pred)==len(on['points'])
 validated=WP.load_predictions(parent/'on',on['points'])
 assert all(p['status']!='error' for p in validated), (ident,'production sidecar validator')
 for card,p in zip(on['points'],pred):
  assert card['idx']==p['idx'] and card['t0']==p['evaluated_t0'] and card['t1']==p['evaluated_t1']
  assert card['clip_t0']<=card['t0']<card['t1']<=card['clip_t1']
  sv=card.get('serve_s')
  # Existing whole-card stamps may be loose; newly changed metadata must be in its own attempt.
  if not any(card['t0']==b['t0'] and card['t1']==b['t1'] for b in off['points']):
   assert sv is None or card['t0']-1.04<=sv<=card['t1']+.04,(ident,card['idx'],'serve')
  assert 'winner_side' not in card
  assert p['status']!='error'
  if card.get('rally_end_cut_s') is not None:
   assert abs(card['rally_end_cut_s']-(card['rally_end_s']-card['clip_t0']+card['cut_t0']))<.031
 rows.append(dict(source=ident,before=len(off['points']),after=len(on['points']),max_timing_difference_s=round(delta,3),off_mode_point_metadata_identical=metadata_parity,prediction_rows=len(pred),predicted=sum(p['status']=='predicted' for p in pred),removed_preparations=on['processing']['combined_cuts']['removed_preparations']))
report=dict(recordings=rows,all_passed=True,limits=['Cached detector replay; ball/player inference not rerun.','Yilin lacks usable cached source video and tracking; not verified.','One previously accepted missed service fault in Julian 3 remains bundled.','No production worker deployment in this step.'])
(O/'export-verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(rows,indent=2))
