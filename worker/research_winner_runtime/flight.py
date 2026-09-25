"""Frozen outgoing-flight extraction; fitting intentionally excluded."""
import math
from .geometry import geometry

CONFIG=dict(horizon_s=1.5,endpoint_frames=1.5,max_gap_frames=3.1,max_step_table_width=.30,
 min_observations=6,min_progress=.10,min_contact_q=-1.,max_contact_q=2.,contact_far_max=.25,contact_near_min=.75,
 max_lateral=1.,bounce_delay_s=.05,serve_phase_s=.75,penalty=.1,maxiter=1000,
 validation_agreement=.90,validation_min_calls=10)

NAMES=['contact_confidence','contact_lateral','contact_age_fraction','log_observations','duration',
 'progress','receiver_overshoot','outward_fraction','max_gap_frames','max_step_table_width',
 'mean_ball_confidence','min_ball_confidence','log_receiving_bounces','log_unknown_bounces',
 'max_receiving_bounce_confidence','tail_to_window_end','max_flight_lateral','stopped_at_gap','stopped_at_jump']

def numeric(v):return float(v) if isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) else None

def extract(f,corners,contacts,serve_s=None):
 r=dict(eligible=False,reason='no_contact',receiver=None,features=None,evidence={},phase='unknown')
 if not contacts:return r
 c=max(contacts,key=lambda x:x['t']);r['contact']=dict(c)
 if c.get('side') not in ['near','far']:r['reason']='unknown_side';return r
 r['receiver']='far' if c['side']=='near' else 'near'
 if numeric(serve_s) is not None:
  r['phase']='machine_serve_phase' if abs(c['t']-serve_s)<=CONFIG['serve_phase_s'] else 'machine_later_shot' if c['t']>serve_s+CONFIG['serve_phase_s'] else 'unknown'
 g=geometry(corners)
 if g is None or numeric(c.get('x')) is None or numeric(c.get('y')) is None:r['reason']='geometry_unknown';return r
 coords,width=g;pos=coords(c['x'],c['y']);q=pos['q'];near=c['side']=='near'
 if pos['lateral']>CONFIG['max_lateral'] or not(CONFIG['contact_near_min']<=q<=CONFIG['max_contact_q'] if near else CONFIG['min_contact_q']<=q<=CONFIG['contact_far_max']):
  r['reason']='contact_not_at_target_end';return r
 fps=f['fps'];pool=[p for p in f['track'] if c['t']-.5/fps<=p[0]<=min(f['end'],c['t']+CONFIG['horizon_s'])]
 if not pool or abs(pool[0][0]-c['t'])>CONFIG['endpoint_frames']/fps:r['reason']='contact_track_missing';return r
 if math.hypot(pool[0][1]*f['width']-c['x'],pool[0][2]*f['height']-c['y'])/width>CONFIG['max_step_table_width']:
  r['reason']='contact_track_position_conflict';return r
 points=[pool[0]];stop='horizon_or_window';gaps=[];steps=[]
 for p in pool[1:]:
  a=points[-1];gap=(p[0]-a[0])*fps;step=math.hypot((p[1]-a[1])*f['width'],(p[2]-a[2])*f['height'])/width
  if gap<=0 or gap>CONFIG['max_gap_frames']:stop='gap';break
  if step>CONFIG['max_step_table_width']:stop='jump';break
  points.append(p);gaps.append(gap);steps.append(step)
 r['evidence']=dict(observations=len(points),prefix_stop=stop,first_s=points[0][0],last_s=points[-1][0])
 if len(points)<CONFIG['min_observations']:r['reason']='short_connected_flight';return r
 positions=[coords(p[1]*f['width'],p[2]*f['height']) for p in points];h=[1-p['q'] if near else p['q'] for p in positions]
 progress=h[-1]-h[0];overshoot=max(h)-1
 r['evidence'].update(progress=progress,receiver_overshoot=overshoot)
 if progress<CONFIG['min_progress']:r['reason']='no_positive_outgoing_flight';return r
 bs=[b for b in f['candidates'] if b['kind']=='bounce' and c['t']+CONFIG['bounce_delay_s']<=b['t']<=points[-1][0]]
 recv=[b for b in bs if numeric(b.get('u')) is not None and numeric(b.get('v')) is not None and 0<=b['u']<=1.525 and 0<=b['v']<=2.74 and ('near' if b['v']<=1.37 else 'far')==r['receiver']]
 unknown=[b for b in bs if numeric(b.get('u')) is None or numeric(b.get('v')) is None]
 conf=[numeric(p[3]) for p in points if len(p)>3 and numeric(p[3]) is not None]
 bconf=[numeric(b.get('visual_confidence')) for b in recv if numeric(b.get('visual_confidence')) is not None]
 r['evidence'].update(receiving_bounces=len(recv),unknown_bounces=len(unknown),max_gap_frames=max(gaps),max_step_table_width=max(steps))
 values=[numeric(c.get('visual_confidence')),pos['lateral'],(f['end']-c['t'])/(f['end']-f['start']),math.log1p(len(points)),points[-1][0]-points[0][0],
 progress,overshoot,sum(b>a for a,b in zip(h,h[1:]))/(len(h)-1),max(gaps),max(steps),
 sum(conf)/len(conf) if conf else None,min(conf) if conf else None,math.log1p(len(recv)),math.log1p(len(unknown)),max(bconf) if bconf else None,
 f['end']-points[-1][0],max(p['lateral'] for p in positions),float(stop=='gap'),float(stop=='jump')]
 assert len(values)==len(NAMES) and all(v is None or math.isfinite(v) for v in values)
 r.update(eligible=True,reason='outgoing_flight_available',features=values);return r
