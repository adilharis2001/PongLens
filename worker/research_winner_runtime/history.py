"""Frozen competing exchange histories; pose unavailable in this contract."""
import math
import collections
import numpy as np
from .trajectory import pos, vel

CONFIG=dict(beam=120,per_state=3,temperature=2.,dedup_frames=1.5,dedup_width=.12,
            missing_landing_cost=1.5,missing_hit_cost=2.5,start_cost=1.8,terminal_cost=.7)

opp=lambda s:'far' if s=='near' else 'near'

def homography(c):
 A=[];b=[]
 for k,(u,v) in zip(['A_near_1','B_near_2','C_far_2','D_far_1'],[(0,0),(1,0),(1,1),(0,1)]):
  x,y=c[k];A.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);b.extend([u,v])
 h=np.r_[np.linalg.solve(A,b),1].reshape(3,3)
 def project(xy):
  p=h@np.r_[xy,1.];return p[:2]/p[2] if abs(p[2])>1e-8 else np.array([99.,99.])
 return project

def build_nodes(r,path,pose=None):
 f=r['features'];w=path['table_width_px'];fps=f['fps'];c=r['corners'];project=homography(c)
 near=(np.array(c['A_near_1'])+c['B_near_2'])/2;far=(np.array(c['C_far_2'])+c['D_far_1'])/2;axis=near-far;length=float(np.linalg.norm(axis));axis/=length
 seeds=[dict(t=k['t'],xy=k['xy'],sources=['path'],knot=k) for k in path['knots']]
 for e in f['candidates']+r['contacts']:
  if e['kind'] not in ['bounce','contact']:continue
  xy=np.array([e['x'],e['y']]);close=[z for z in seeds if abs(z['t']-e['t'])*fps<=CONFIG['dedup_frames'] and np.linalg.norm(np.array(z['xy'])-xy)/w<=CONFIG['dedup_width']]
  if close:
   z=min(close,key=lambda a:abs(a['t']-e['t']));z['sources']=sorted(set(z['sources']+[e['kind']]))
  else:seeds.append(dict(t=e['t'],xy=xy.tolist(),sources=[e['kind']]))
 # Visible outgoing travel, not a missing tail. Both out-shot and legal-winner histories survive.
 # Confidence is optional per observation; history consumes only time and position.
 track=np.array([p[:3] for p in f['track']],float);xy=track[:,1:3]*[f['width'],f['height']]
 for i in range(3,len(track)):
  ts=track[i-3:i+1,0]
  if np.diff(ts).max()>.12:continue
  qs=(xy[i-3:i+1]-far)@axis/length;uv=np.array([project(p) for p in xy[i-3:i+1]])
  outside=(qs[-1]<-.15 or qs[-1]>1.15 or abs(uv[-1,0]-.5)>.85)
  earlier=(qs[0]<-.15 or qs[0]>1.15 or abs(uv[0,0]-.5)>.85)
  outward=abs(qs[-1]-.5)>abs(qs[0]-.5)+.10 or abs(uv[-1,0]-.5)>abs(uv[0,0]-.5)+.2
  if outside and not earlier and outward and np.linalg.norm(xy[i]-xy[i-3])/w>.15:
   nearby=[z for z in seeds if abs(z['t']-track[i,0])*fps<=.5 and np.linalg.norm(np.array(z['xy'])-xy[i])/w<.12]
   if nearby:
    z=min(nearby,key=lambda a:abs(a['t']-track[i,0]));z['sources']=sorted(set(z['sources']+['visible_exit']));z['exit_side']='near' if qs[-1]>.5 else 'far'
   else:seeds.append(dict(t=float(track[i,0]),xy=xy[i].tolist(),sources=['visible_exit'],exit_side='near' if qs[-1]>.5 else 'far'))
 seeds.sort(key=lambda a:a['t']);nodes=[]
 for z in seeds:
  t=z['t'];p=np.array(z['xy']);uv=project(p);q=float((p-far)@axis/length);lateral=abs(float(axis[0]*(p-far)[1]-axis[1]*(p-far)[0]))/w
  outside=float(math.hypot(max(-uv[0],0,uv[0]-1),max(-uv[1],0,uv[1]-1)))
  k=z.get('knot');vi=vo=None;reliable=0.
  if k:
   vi=np.array(k['velocity_in']);vo=np.array(k['velocity_out']);reliable=math.exp(-min(12.,k['join_px']/max(3.,w*.04)))
  else:
   # Fit each side from raw observed points; no event proposal is treated as independent motion evidence.
   vv=[]
   for low,high in [(t-.16,t-1e-6),(t+1e-6,t+.16)]:
    ii=(track[:,0]>=low)&(track[:,0]<=high)
    if ii.sum()>=3:
     tt=track[ii,0]-t;vv.append(np.linalg.lstsq(np.c_[np.ones(len(tt)),tt],xy[ii]/w,rcond=None)[0][1])
    else:vv.append(None)
   vi,vo=vv;reliable=.6 if vi is not None and vo is not None else 0.
  strength=rev=vertical=decay=0.
  if vi is not None and vo is not None:
   ni=float(np.linalg.norm(vi));no=float(np.linalg.norm(vo));den=max(ni*no,1e-6)
   strength=float(np.tanh(np.linalg.norm(vo-vi)/2))*reliable
   rev=float(-(vi@axis)*(vo@axis)/den)*reliable
   vertical=float(max(0.,vi[1])*max(0.,-vo[1])/den)*reliable
   decay=float(max(0.,1-no/max(ni,1e-6)))*reliable
  n=dict(t=float(t),xy=p.tolist(),sources=z['sources'],q=q,u=float(uv[0]),v=float(uv[1]),lateral=lateral,
         reliability=reliable,strength=strength,reversal=rev,vertical=vertical,decay=decay,
         bounce={},hit={},net=-12.,exit=-12.,exit_side=z.get('exit_side'),pose=None)
  for side in ['near','far']:
   # Conditional plane compatibility; airborne coordinates are not claimed to be on-plane.
   side_dist=max(0.,(.5-uv[1]) if side=='far' else (uv[1]-.5))
   n['bounce'][side]=2*strength+2*vertical-2*max(0.,rev)+(.45 if 'bounce' in z['sources'] else 0)-8*min(outside,3)-6*side_dist-1.0
   center=1. if side=='near' else 0.;end_dist=abs(q-center)
   n['hit'][side]=2*strength+2.5*max(0.,rev)-1.5*max(0.,-rev)-1.8*end_dist-1.5*max(0.,lateral-.5)-1.0
  if pose:
   n['pose']=pose(t,p)
   for side in ['near','far']:
    info=n['pose'][side];d=info.get('reliable_wrist_distance')
    if d is not None:
     # Weak symmetric factor: near a wrist helps; a reliable distant wrist contradicts.
     n['hit'][side]+=float(np.clip(1.-2*d,-2.,1.))
  netdistance=abs(q-.5)
  n['net']=2*strength+1.5*max(0.,rev)+2*decay-10*netdistance-2*max(0.,lateral-.55)-1.5
  if 'visible_exit' in z['sources']:n['exit']=2.0
  # Contact alternatives explain one correlated observation, not multiple detector votes.
  n['background']=max(0.,max(n['bounce'].values()),max(n['hit'].values()))
  nodes.append(n)
 for i,n in enumerate(nodes):
  if not i:n['crossing']=0.;continue
  prev=nodes[i-1];cross=(prev['q']-.5)*(n['q']-.5)<0
  n['crossing']=float(cross and n['t']-prev['t']<1.2 and abs(n['q']-prev['q'])>.25)
 return nodes

def initial():return dict(score=0.,phase='prep',hitter=None,bounces=0,last_live=None,last_hit=None,winner=None,cause=None,interval=None,latent=0,hits=0,events=[])

def advance(h,n,event,**changes):
 z=dict(h);z.update(changes);z['events']=h['events']+[(n['t'],event)];return z

def decode(nodes):
 beam=[initial()]
 for n in nodes:
  pool=[]
  for h in beam:
   sc=h['score'];phase=h['phase'];hit=h['hitter'];bg=n['background']
   if phase in ['prep','dead']:
    # Cross-table activity is less compatible with handling, especially after an alleged end.
    z=advance(h,n,phase+'_activity',score=sc+bg-(2.4 if phase=='dead' else 1.2)*n['crossing']);pool.append(z)
    if phase=='dead':continue
    for side in ['near','far']:
     hs=n['hit'][side]
     if hs>-.5:
      for startphase in ['rally','serve0']:
       pool.append(advance(h,n,'hit_'+side,score=sc+hs-CONFIG['start_cost'],phase=startphase,hitter=side,bounces=0,last_live=n['t'],last_hit=n['t'],hits=1))
     bs=n['bounce'][side]
     if bs>0:
      pool.append(advance(h,n,'unknown_hit_then_bounce_'+side,score=sc+bs-2.8,phase='rally',hitter=opp(side),bounces=1,last_live=n['t'],last_hit=None,hits=0,latent=1))
    continue
   pool.append(advance(h,n,'unassigned',score=sc))
   for side in ['near','far']:
    hs=n['hit'][side];bs=n['bounce'][side]
    if hs>-.5:
     if side!=hit:
      missing=int(h['bounces']==0);cost=CONFIG['missing_landing_cost']*missing
      pool.append(advance(h,n,('inferred_landing_then_' if missing else '')+'hit_'+side,score=sc+hs+1.1-cost,phase='rally',hitter=side,bounces=0,last_live=n['t'],last_hit=n['t'],hits=h['hits']+1,latent=h['latent']+missing))
     else:
      # A hidden opposing stroke is possible; do not force hit alternation on detections.
      pool.append(advance(h,n,'inferred_opposing_hit_then_hit_'+side,score=sc+hs-CONFIG['missing_hit_cost'],phase='rally',hitter=side,bounces=0,last_live=n['t'],last_hit=n['t'],hits=h['hits']+1,latent=h['latent']+1))
    if bs<=-.5:continue
    if phase=='serve0' and side==hit:
     pool.append(advance(h,n,'serve_first_bounce_'+side,score=sc+bs+.8,phase='serve1',last_live=n['t']))
    elif side!=hit:
     if h['bounces']==0:
      penalty=.8 if phase=='serve0' else 0.
      pool.append(advance(h,n,('inferred_serve_first_then_' if phase=='serve0' else '')+'bounce_'+side,score=sc+bs+.8-penalty,phase='rally',bounces=1,last_live=n['t'],latent=h['latent']+int(phase=='serve0')))
     else:
      pool.append(advance(h,n,'second_bounce_'+side,score=sc+bs+.6-CONFIG['terminal_cost'],phase='dead',winner=hit,cause='double_bounce',interval=[h['last_live'],n['t']]))
      # Could instead be a new flight with two undetected strokes.
      pool.append(advance(h,n,'inferred_exchange_then_bounce_'+side,score=sc+bs-2*CONFIG['missing_hit_cost'],phase='rally',bounces=1,last_live=n['t'],latent=h['latent']+2))
    else:
     # A same-side bounce during a rally can follow an unseen opposing hit.
     pool.append(advance(h,n,'inferred_opposing_hit_then_bounce_'+side,score=sc+bs-CONFIG['missing_hit_cost'],phase='rally',hitter=opp(hit),bounces=1,last_live=n['t'],last_hit=None,latent=h['latent']+1))
   if n['net']>0 and h['bounces']==0 and n['t']>h['last_live']:
    pool.append(advance(h,n,'net_fault',score=sc+n['net']-CONFIG['terminal_cost'],phase='dead',winner=opp(hit),cause='net_fault',interval=[h['last_live'],n['t']]))
   if n['exit']>0 and n['t']>h['last_live']:
    # Preserve missing-landing and continued-live alternatives. Exit != certified out.
    winner=hit if h['bounces'] else opp(hit)
    pool.append(advance(h,n,'visible_exit',score=sc+n['exit']-CONFIG['terminal_cost'],phase='dead',winner=winner,cause='unreturned' if h['bounces'] else 'missed_table',interval=[h['last_live'],n['t']]))
    if not h['bounces']:
     pool.append(advance(h,n,'inferred_landing_then_exit',score=sc+n['exit']-CONFIG['terminal_cost']-CONFIG['missing_landing_cost'],phase='dead',winner=hit,cause='unreturned_inferred_landing',interval=[h['last_live'],n['t']],latent=h['latent']+1))
  pool.sort(key=lambda h:h['score'],reverse=True);counts=collections.Counter();beam=[]
  for h in pool:
   key=(h['phase'],h['hitter'],h['bounces'],h['winner'],h['cause'])
   if counts[key]>=CONFIG['per_state']:continue
   counts[key]+=1;beam.append(h)
   if len(beam)>=CONFIG['beam']:break
  # Prep and unresolved/live survive even if an approximate beam ranks dead highly.
  for family in ['prep','live']:
   found=next((h for h in pool if (h['phase']=='prep' if family=='prep' else h['phase'] not in ['prep','dead'])),None)
   if found is not None and not any(h is found for h in beam):beam.append(found)
 if not beam:beam=[initial()]
 beam.sort(key=lambda h:h['score'],reverse=True);counts=collections.Counter();final=[]
 for h in beam:
  key=h['winner'] or 'unknown'
  if counts[key]<24:final.append(h);counts[key]+=1
 scores=np.array([h['score'] for h in final]);weights=np.exp((scores-scores.max())/CONFIG['temperature']);weights/=weights.sum()
 for h,p in zip(final,weights):h['weight']=float(p)
 return final

NAMES=['winner_mass_difference','best_score_difference','hitter_mass_difference','live_hitter_difference',
 'visible_exit_mass_difference','net_mass_difference','double_bounce_mass_difference','latent_winner_difference',
 'winner_mass_x_resolved','hitter_mass_x_resolved','hits_winner_difference','interval_width_winner_difference']

def summarize(histories):
 mass={s:sum(h['weight'] for h in histories if h['winner']==s) for s in ['near','far']};resolved=sum(mass.values());sgn=lambda s:1 if s=='near' else -1 if s=='far' else 0
 diff=mass['near']-mass['far'];best={s:max((h['score'] for h in histories if h['winner']==s),default=None) for s in ['near','far']}
 bestdiff=float(np.clip((best['near']-best['far'])/10,-2,2)) if None not in best.values() else (1. if best['near'] is not None else -1. if best['far'] is not None else 0.)
 hitter=sum(h['weight']*sgn(h['hitter']) for h in histories)
 values=[diff,bestdiff,hitter,sum(h['weight']*sgn(h['hitter']) for h in histories if h['phase'] not in ['prep','dead'])]
 for cause in ['exit','net','double_bounce']:
  values.append(sum(h['weight']*sgn(h['winner']) for h in histories if (h['cause'] in ['missed_table','unreturned','unreturned_inferred_landing'] if cause=='exit' else h['cause']=='net_fault' if cause=='net' else h['cause']=='double_bounce')))
 values += [sum(h['weight']*sgn(h['winner'])*h['latent'] for h in histories),diff*resolved,hitter*resolved,
            sum(h['weight']*sgn(h['winner'])*min(h['hits'],10)/10 for h in histories),
            sum(h['weight']*sgn(h['winner'])*min(h['interval'][1]-h['interval'][0],3)/3 for h in histories if h['interval'])]
 return dict(features=values,mass=mass,unresolved=1-resolved,eligible=bool(best['near'] is not None or best['far'] is not None),histories=histories)
