"""Frozen machine rule extraction; no dataset access or fitting."""
import math
from research_contact_recovery import geometry


CONFIG=dict(version="1.1-frame-order",far_q_min=-1.,far_q_max=.25,near_q_min=.75,near_q_max=2.,
            max_lateral_width=1.,min_landing_delay_s=.08,max_landing_delay_s=1.5,
            min_confidence=.7,net_margin_m=.20,min_link_observations=3,
            max_gap_frames=3.1,endpoint_frames=1.5,max_error_width=.30,
            exit_margin=.15,max_exit_delay_s=2.,confirmation_s=.4,
            min_terminal_observations=12,max_backtrack_q=.06)

def connection(track,a,b,fps,width):
    points=[p for p in track if a['t']-.51/fps<=p['t']<=b['t']+.51/fps]
    evidence=dict(observations=len(points))
    if len(points)<CONFIG['min_link_observations']:return 'sparse_link',evidence
    if (abs(points[0]['t']-a['t'])>CONFIG['endpoint_frames']/fps or
        abs(points[-1]['t']-b['t'])>CONFIG['endpoint_frames']/fps):return 'endpoint_missing',evidence
    distances=[math.hypot(p['x']-c['x'],p['y']-c['y']) for p,c in [(points[0],a),(points[-1],b)]]
    evidence['endpoint_error_px']=distances
    if max(distances)>CONFIG['max_error_width']*width:return 'endpoint_position_conflict',evidence
    gaps=[y['t']-x['t'] for x,y in zip(points,points[1:])]
    evidence['max_gap_s']=max(gaps)
    if min(gaps)<=0 or max(gaps)>CONFIG['max_gap_frames']/fps:return 'track_gap',evidence
    errors=[]
    for x,y,z in zip(points,points[1:],points[2:]):
        ratio=(z['t']-y['t'])/(y['t']-x['t'])
        errors.append(math.hypot(z['x']-y['x']-(y['x']-x['x'])*ratio,
                                 z['y']-y['y']-(y['y']-x['y'])*ratio))
    evidence['max_innovation_px']=max(errors,default=0.)
    if evidence['max_innovation_px']>CONFIG['max_error_width']*width:return 'track_identity_uncertain',evidence
    return None,evidence

def analyze(f, corners):
    result=dict(contacts=[],links=[],winner=None,reason='last_contact_unknown',
                physical_end_s=None,cut_s=None,exit_evidence_s=None,confirmation_s=None)
    geo=geometry(corners)
    if geo is None:
        result['reason']='calibration_unavailable';return result
    coords,width=geo;fps=f['fps']
    track=[dict(t=p[0],x=p[1]*f['width'],y=p[2]*f['height']) for p in f['track']]
    for p in track:p.update(coords(p['x'],p['y']))
    contacts=sorted([c for c in f['candidates'] if c['kind']=='contact'],key=lambda c:c['t'])
    for c in contacts:
        position=coords(c['x'],c['y']) if c.get('x') is not None and c.get('y') is not None else {}
        q=position.get('q');side=c.get('side')
        plausible=(q is not None and position['lateral']<=CONFIG['max_lateral_width'] and
                   ((side=='near' and CONFIG['near_q_min']<=q<=CONFIG['near_q_max']) or
                    (side=='far' and CONFIG['far_q_min']<=q<=CONFIG['far_q_max'])))
        result['contacts'].append(dict(event=c,plausible=plausible,**position))
    for i,entry in enumerate(result['contacts']):
        c=entry['event'];link=dict(contact=c,status='unresolved',reason=None,landing=None,return_contact=None)
        result['links'].append(link)
        if not entry['plausible']:
            link['reason']='contact_not_at_target_end';continue
        later=[b for b in f['candidates'] if b['kind']=='bounce' and b['t']>=c['t']+CONFIG['min_landing_delay_s']]
        if not later:
            link['reason']='no_landing_candidate';continue
        b=min(later,key=lambda b:b['t']);link['candidate_landing']=b
        if b['t']-c['t']>CONFIG['max_landing_delay_s']:
            link['reason']='landing_too_late';continue
        if any(c['t']<other['t']<=b['t'] for other in contacts):
            link['reason']='intervening_contact';continue
        if b.get('u') is None or b.get('v') is None:
            link['reason']='landing_projection_unknown';continue
        if not 0<=b['u']<=1.525 or not 0<=b['v']<=2.74:
            link['reason']='landing_outside_table';continue
        side='near' if b['v']<=1.37 else 'far'
        if side==c['side'] or abs(b['v']-1.37)<=CONFIG['net_margin_m']:
            link['reason']='landing_half_unresolved';continue
        if (b.get('visual_confidence') or 0)<CONFIG['min_confidence']:
            link['reason']='weak_landing';continue
        reason,evidence=connection(track,c,b,fps,width)
        link['connection']=evidence
        if reason:
            link['reason']=reason;continue
        link.update(status='landing_linked',reason='terminal_not_established',landing=b)
        next_entry=next((x for x in result['contacts'][i+1:] if x['event']['t']>b['t']),None)
        if next_entry:
            ret=next_entry['event']
            if (next_entry['plausible'] and ret['side']!=c['side'] and
                ret['t']-b['t']<=CONFIG['max_landing_delay_s']):
                why,ev=connection(track,b,ret,fps,width)
                link['return_connection']=ev
                if why is None:link.update(return_contact=ret,reason='return_observed')
    if not result['links']:return result
    link=result['links'][-1];c=link['contact']
    if link['status']!='landing_linked':
        result['reason']=link['reason'];return result
    if (c.get('visual_confidence') or 0)<CONFIG['min_confidence']:
        result['reason']='contact_confidence_unknown_or_weak';return result
    b=link['landing'];direction=1 if c['side']=='far' else -1
    threshold=1+CONFIG['exit_margin'] if direction==1 else -CONFIG['exit_margin']
    exits=[p for p in track if round(p['t']*fps)>round(b['t']*fps) and p['t']<=c['t']+CONFIG['max_exit_delay_s'] and direction*(p['q']-threshold)>=0]
    if not exits:
        result['reason']='no_receiving_end_exit';return result
    end=exits[0];confirm=end['t']+CONFIG['confirmation_s']
    result.update(exit_evidence_s=end['t'],confirmation_s=confirm)
    if confirm>f['end']:
        result['reason']='confirmation_not_available';return result
    points=[p for p in track if end['t']<=p['t']<=confirm+.51/fps]
    if not points or abs(points[-1]['t']-confirm)>CONFIG['endpoint_frames']/fps:
        result['reason']='confirmation_track_missing';return result
    reason,evidence=connection(track,c,points[-1],fps,width)
    result['terminal_connection']=evidence
    if reason:
        result['reason']=reason;return result
    if evidence['observations']<CONFIG['min_terminal_observations']:
        result['reason']='terminal_track_sparse';return result
    if any(direction*(y['q']-x['q']) < -CONFIG['max_backtrack_q'] for x,y in zip(points,points[1:])):
        result['reason']='post_exit_return_motion';return result
    result.update(winner=c['side'],reason='linked_landing_and_outward_exit',
                  cause_hypothesis='unreturned_legal_shot')
    return result
