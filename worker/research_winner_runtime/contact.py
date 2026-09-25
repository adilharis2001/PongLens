"""Frozen contact and 54-feature sequence extraction; no dataset access."""
import math
import numpy as np
from .geometry import geometry
from . import flight as model

def finite(x):return x is not None and math.isfinite(float(x))

def opp(s):return 'far' if s=='near' else 'near'

def homography(corners):
 keys=['A_near_1','B_near_2','C_far_2','D_far_1'];dest=[(0,0),(1,0),(1,1),(0,1)];A=[];b=[]
 for key,(u,v) in zip(keys,dest):
  x,y=corners[key];A.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);b.extend([u,v])
 h=np.r_[np.linalg.solve(A,b),1].reshape(3,3)
 def project(x,y):
  z=h@np.array([x,y,1]);return z[:2]/z[2] if abs(z[2])>1e-8 else np.array([np.nan,np.nan])
 return project

def event_features(r,b):
 f=r['features'];project=homography(r['corners']);coords,width=geometry(r['corners']);fps=f['fps'];t=b['t'];x=b['x'];y=b['y'];u,v=project(x,y);pos=coords(x,y)
 inside=float(0<=u<=1 and 0<=v<=1);dist=math.hypot(max(-u,0,u-1),max(-v,0,v-1));side='near' if v<.5 else 'far'
 bs=[a for a in f['candidates'] if a['kind']=='bounce'];before=[a for a in bs if a['t']<t-1e-5];after=[a for a in bs if a['t']>t+1e-5]
 same=[a for a in before if ('near' if project(a['x'],a['y'])[1]<.5 else 'far')==side]
 same_after=[a for a in after if ('near' if project(a['x'],a['y'])[1]<.5 else 'far')==side]
 gap=lambda aa,prev: min(3,abs(t-(max(a['t'] for a in aa) if prev else min(a['t'] for a in aa)))) if aa else None
 track=np.array([p[:3] for p in f['track']],float);track[:,1]*=f['width'];track[:,2]*=f['height']
 velocities=[];ns=[];gaps=[]
 for low,high in [(t-.15,t),(t,t+.15)]:
  z=track[(track[:,0]>=low-.1/fps)&(track[:,0]<=high+.1/fps)];ns.append(len(z));gaps.append(float(np.diff(z[:,0]).max()*fps) if len(z)>1 else None)
  if len(z)>=2:
   tt=z[:,0]-t;vel=np.linalg.lstsq(np.c_[tt,np.ones(len(tt))],z[:,1:],rcond=None)[0][0]/width;velocities.append(vel)
  else:velocities.append(None)
 a,z=velocities;sin=float(np.linalg.norm(a)) if a is not None else None;sout=float(np.linalg.norm(z)) if z is not None else None
 dot=float(a@z/max(sin*sout,1e-8)) if a is not None and z is not None else None
 contacts=[abs(c['t']-t) for c in r['contacts'] if c.get('side')==side]
 xvals=[float(u),float(v),inside,dist,abs(v-.5),pos['lateral'],gap(before,True),gap(after,False),gap(same,True),gap(same_after,False),sin,sout,dot,
        float(a[1]) if a is not None else None,float(z[1]) if z is not None else None,ns[0],ns[1],gaps[0],gaps[1],min(contacts,default=3),abs(t-(r.get('serve_s') or f['start']))]
 return dict(t=t,x=x,y=y,side=side,u=float(u),v=float(v),inside=bool(inside),outside_distance=dist,features=xvals)

BOUNCE_NAMES=['u','v','inside','outside_distance','net_distance','lateral','previous_gap','next_gap','previous_same_side_gap','next_same_side_gap','speed_in','speed_out','turn_cos','vy_in','vy_out','observations_before','observations_after','max_gap_before','max_gap_after','nearest_same_side_machine_paddle','age_from_machine_serve']

def sequence_features(r,events,keep):
 f=r['features'];coords,width=geometry(r['corners']);project=homography(r['corners']);contacts=[]
 for c in r['contacts']:
  if c.get('side') not in ['near','far']:continue
  q=coords(c['x'],c['y'])
  if q['lateral']<=1 and ((-.99<=q['q']<=.25) if c['side']=='far' else (.75<=q['q']<=2)):contacts.append(c)
 usable=[e for e,k in zip(events,keep) if k];inside=[e for e in usable if e['inside']]
 reference_events=[e for e in events if e['inside']]
 reference=contacts[-1]['side'] if contacts else reference_events[-1]['side'] if reference_events else None
 if reference is None:return None,None
 sidevalue=lambda s:1. if s==reference else -1.
 latest=contacts[-1] if contacts else None;last=usable[-1] if usable else None;v=[]
 v.extend([float(bool(latest)),len(contacts),len(usable),len(inside),len(events)-len(usable)])
 for e in usable[-3:][::-1]+[None]*max(0,3-len(usable)):
  v.extend([sidevalue(e['side']),e['outside_distance'],abs(e['v']-.5),f['end']-e['t'],e['t']-latest['t'] if latest else None] if e else [None]*5)
 for c in contacts[-2:][::-1]+[None]*max(0,2-len(contacts)):
  v.extend([sidevalue(c['side']),c.get('visual_confidence'),f['end']-c['t'],c['t']-last['t'] if last else None] if c else [None]*4)
 if latest:
  later=[e for e in usable if e['t']>latest['t']+.05]
  v.extend([sum(e['inside'] and e['side']!=reference for e in later),sum(e['inside'] and e['side']==reference for e in later),sum(not e['inside'] for e in later)])
 else:v.extend([None]*3)
 # Reuse frozen connected-flight extraction; contact candidates and saved windows unchanged.
 ff=dict(f);kept_times={round(e['t'],4) for e in usable};ff['candidates']=[b for b in f['candidates'] if b['kind']!='bounce' or round(b['t'],4) in kept_times]
 flight=model.extract(ff,r['corners'],contacts,r['serve_s'])
 v.extend(flight['features'] if flight['features'] is not None else [None]*len(model.NAMES))
 # Rejected observations remain represented: an off-table event can support ending evidence.
 removed=[e for e,k in zip(events,keep) if not k]
 for side in [reference,opp(reference)]:
  a=[e for e in removed if e['side']==side];v.extend([len(a),f['end']-a[-1]['t'] if a else None])
 assert len(v)==54,len(v)
 return reference,v
