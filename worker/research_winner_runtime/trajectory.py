"""Frozen robust flight reconstruction from normalized observed tracks."""
import math
import numpy as np

CONFIG=dict(min_samples=4,max_samples=24,max_duration=.8,gap_s=.35,
            scale_px_min=2.5,scale_table_fraction=.015,segment_penalty=12.,beam=3,
            outlier_cost=16.,irls_iterations=3)

def fit_segment(points,width):
 t=points[:,0];span=max(t[-1]-t[0],1e-6);x=(t-t[0])/span;A=np.c_[np.ones(len(t)),x,x*x];y=points[:,1:3]/width
 sigma=max(CONFIG['scale_px_min']/width,CONFIG['scale_table_fraction']);w=np.ones(len(t))
 for _ in range(CONFIG['irls_iterations']):
  coef=np.linalg.lstsq(A*np.sqrt(w[:,None]),y*np.sqrt(w[:,None]),rcond=None)[0]
  error=np.linalg.norm(y-A@coef,axis=1)/sigma;w=np.minimum(1.,1.5/np.maximum(error,1e-8))
 residual=np.linalg.norm(y-A@coef,axis=1)*width
 return dict(t0=float(t[0]),t1=float(t[-1]),span=float(span),coef=coef.tolist(),
             cost=float(np.minimum(error*error,CONFIG['outlier_cost']).sum()),
             rms_px=float(np.sqrt(np.mean(residual*residual))),
             robust_rms_px=float(np.sqrt(np.sum(w*residual*residual)/w.sum())),
             outliers=np.flatnonzero(error>4.).tolist(),samples=len(t),
             max_gap_s=float(np.diff(t).max()) if len(t)>1 else 0.)

def pos(s,t):
 u=(t-s['t0'])/s['span'];return np.array([1.,u,u*u])@np.array(s['coef'])

def vel(s,t):
 u=(t-s['t0'])/s['span'];return np.array([0.,1.,2*u])@np.array(s['coef'])/s['span']

def connect(a,b,width):
 # Positions must join; a velocity discontinuity remains available as a latent event.
 lo=a['t1'];hi=b['t0'];times=np.linspace(lo,hi,9)
 errors=[np.linalg.norm(pos(a,t)-pos(b,t)) for t in times];j=int(np.argmin(errors));t=float(times[j])
 sigma=max(CONFIG['scale_px_min']/width,CONFIG['scale_table_fraction'])
 gap=max(0.,hi-lo-1/30);uncertainty=sigma*(1+gap/.05)
 penalty=min(32.,(errors[j]/uncertainty)**2)
 va=vel(a,t);vb=vel(b,t);location=(pos(a,t)+pos(b,t))/2
 return penalty,dict(t=t,interval=[lo,hi],xy=(location*width).tolist(),join_px=float(errors[j]*width),
                     speed_change=float(np.linalg.norm(vb-va)),velocity_in=va.tolist(),velocity_out=vb.tolist(),
                     support=min(a['samples'],b['samples']),gap_s=hi-lo,
                     turn_cos=float(va@vb/max(np.linalg.norm(va)*np.linalg.norm(vb),1e-9)))

def solve_component(points,width):
 n=len(points)
 if n<CONFIG['min_samples']:return [],[]
 # Every retained state ends in a different candidate flight; links reference immutable states.
 states={0:[dict(cost=0.,seg=None,prev=None)]}
 for j in range(CONFIG['min_samples'],n+1):
  options=[]
  for i in range(max(0,j-CONFIG['max_samples']),j-CONFIG['min_samples']+1):
   if i not in states or points[j-1,0]-points[i,0]>CONFIG['max_duration']+1e-8:continue
   seg=fit_segment(points[i:j],width);seg.update(first=i,last=j-1)
   for prev in states[i]:
    join=connect(prev['seg'],seg,width)[0] if prev['seg'] else 0.
    options.append(dict(cost=prev['cost']+seg['cost']+CONFIG['segment_penalty']+join,seg=seg,prev=prev))
  if options:
   options.sort(key=lambda a:a['cost']);unique=[];seen=set()
   for a in options:
    if a['seg']['first'] in seen:continue
    seen.add(a['seg']['first']);unique.append(a)
    if len(unique)==CONFIG['beam']:break
   states[j]=unique
 if n not in states:return [],[]
 state=states[n][0];seq=[]
 while state['seg'] is not None:
  seq.append(state['seg']);state=state['prev']
 seq=seq[::-1];knots=[connect(a,b,width)[1] for a,b in zip(seq,seq[1:])]
 for k,(a,b) in zip(knots,zip(seq,seq[1:])):
  merged=fit_segment(points[a['first']:b['last']+1],width)
  k['split_gain']=merged['cost']-a['cost']-b['cost']
 return seq,knots

def reconstruct(row):
 # Explicit allowlist. No candidate event, window-end, serve, score or annotation input.
 f=row['features'];c=row['corners'];width=math.dist(c['A_near_1'],c['B_near_2'])
 pts=np.array([[p[0],p[1]*f['width'],p[2]*f['height']] for p in f['track']],float)
 result=dict(segments=[],knots=[],outlier_indices=[],unresolved_gaps=[],components=0,
             table_width_px=width,physical_end=None,winner=None)
 if not len(pts):return result
 assert np.isfinite(pts).all() and width>1
 # Saved rows are chronological and unique; refuse silent reordering/mapping changes.
 assert np.all(np.diff(pts[:,0])>0),'Nonunique/unordered source times'
 breaks=np.flatnonzero(np.diff(pts[:,0])>CONFIG['gap_s'])+1
 for a,b in zip(np.r_[0,breaks],np.r_[breaks,len(pts)]):
  seq,knots=solve_component(pts[a:b],width);component=result['components'];result['components']+=1
  for s in seq:
   s['first']+=int(a);s['last']+=int(a);s['component']=component
   result['outlier_indices'].extend(s['first']+i for i in s.pop('outliers'))
  for k in knots:k['component']=component
  result['segments'].extend(seq);result['knots'].extend(knots)
 for i in breaks:result['unresolved_gaps'].append([float(pts[i-1,0]),float(pts[i,0])])
 return result
