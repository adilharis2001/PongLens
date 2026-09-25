"""Frozen machine rule extraction; no dataset access or fitting."""
import math
from . import same_shot as original


CONFIG = dict(version='1', source_policy='same-shot-v1-1',
    max_departure_delay_frames=original.CONFIG['max_gap_frames'])

def departure(points, width, height, fps):
    if len(points)<3 or min(width,height,fps)<=0:return None
    a,b,c=points[-3:]
    if not a['t']<b['t']<c['t']:return None
    if any(not (0<=p['x']<=width and 0<=p['y']<=height) for p in (a,b,c)):return None
    edges=[]
    for name,key,bound,direction in [('left','x',0,-1),('right','x',width,1),
                                      ('top','y',0,-1),('bottom','y',height,1)]:
        speeds=[(q[key]-p[key])/(q['t']-p['t']) for p,q in [(a,b),(b,c)]]
        if any(direction*v<=0 for v in speeds):continue
        delays=[(bound-c[key])/v for v in speeds]
        if all(0<=t<=CONFIG['max_departure_delay_frames']/fps for t in delays):
            edges.append(dict(edge=name,projected_delay_s=delays,last_observation=dict(c)))
    return min(edges,key=lambda r:max(r['projected_delay_s'])) if edges else None

def additional(f, corners, baseline):
    result=dict(winner=None,reason='not_eligible',physical_end_s=None,cut_s=None,
                image_departure_evidence_s=None,confirmation_s=None)
    if (baseline.get('winner') is not None or baseline.get('branch')=='existing_net' or
        baseline.get('reason')!='track_identity_uncertain' or not baseline.get('terminal_connection')):return result
    link=baseline['links'][-1];contact=link['contact'];fps=f['fps']
    if link['status']!='landing_linked' or not link.get('landing'):return result
    if (contact.get('visual_confidence') or 0)<original.CONFIG['min_confidence']:return result
    exit_s,confirm=baseline['exit_evidence_s'],baseline['confirmation_s']
    if exit_s is None or confirm is None or confirm>f['end']:return result
    geometry=original.geometry(corners)
    if geometry is None:return result
    coords,table_width=geometry
    points=[dict(t=p[0],x=p[1]*f['width'],y=p[2]*f['height']) for p in f['track']
            if contact['t']-.51/fps<=p[0]<=confirm+.51/fps]
    first=None
    for i in range(2,len(points)):
        a,b,c=points[i-2:i+1]
        if not a['t']<b['t']<c['t']:
            result['reason']='invalid_track_order';return result
        ratio=(c['t']-b['t'])/(b['t']-a['t'])
        error=math.hypot(c['x']-b['x']-(b['x']-a['x'])*ratio,
                         c['y']-b['y']-(b['y']-a['y'])*ratio)
        if error>original.CONFIG['max_error_width']*table_width:
            first=i;result['first_break']=dict(before=b,after=c,innovation_px=error);break
    if first is None:
        result['reason']='no_identity_discontinuity';return result
    connected=points[:first];last=connected[-1]
    if last['t']<=exit_s:
        result['reason']='break_before_receiving_exit';return result
    reason,evidence=original.connection(connected,contact,last,fps,table_width)
    result['departure_connection']=evidence
    if reason:
        result['reason']=reason;return result
    if len(connected)<original.CONFIG['min_terminal_observations']:
        result['reason']='terminal_track_sparse';return result
    edge=departure(connected,f['width'],f['height'],fps)
    if edge is None:
        result['reason']='first_break_not_image_departure';return result
    direction=1 if contact['side']=='far' else -1
    qs=[coords(p['x'],p['y'])['q'] for p in connected if p['t']>=exit_s]
    if any(direction*(b-a)<-original.CONFIG['max_backtrack_q'] for a,b in zip(qs,qs[1:])):
        result['reason']='post_exit_return_motion';return result
    result.update(winner=contact['side'],reason='linked_landing_and_image_departure',
        cause_hypothesis='unreturned_legal_shot',image_departure_evidence_s=last['t'],
        confirmation_s=confirm,departure=edge)
    return result
