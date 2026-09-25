"""Frozen machine rule extraction; no dataset access or fitting."""
from research_contact_recovery import geometry


CONFIG=dict(min_bounces=3,net_margin_m=.20,minimum_confidence=.7,
            minimum_delay_s=.05,maximum_delay_s=1.5,crossing_tolerance_frames=1.,
            far_min_q=-1.,far_max_q=.25,near_min_q=.75,near_max_q=2.,max_lateral=1.)

def decide(card, sequences, crossings, serves, candidates, corners, fps):
    r=dict(winner=None,reason='no_confirmed_net_event',physical_end_s=None,cut_s=None,evidence={})
    def reject(reason):
        r['reason']=reason
        return r
    lo,hi=card['t0'],card['t1'];selected=None
    sequences=sorted(sequences,key=lambda s:s['first'])
    for s in sequences:
        m=s['net_motion']
        if not m or not(m['absorbed'] or (m['reversed'] and abs(m['out_wps'])<abs(m['in_wps']))):continue
        if s['first']<max(lo+1,(card.get('serve_s') or lo)+.8):continue
        prefix=[b for b in s['bounces'] if lo<=b['t']<=hi]
        if len(prefix)<CONFIG['min_bounces']:continue
        selected=(s,prefix[:CONFIG['min_bounces']],m);break
    if selected is None:return r
    s,bs,m=selected;confirmed=bs[2]['t'];half=s['half']
    r['evidence']=dict(first=s['first'],confirmed=confirmed,half=half,
        bounces=bs,net_motion=m,whole_sequence_last=s['last'])
    if not lo<=m['t']-.18 or m['t']+.20>confirmed:return reject('net_motion_context_unavailable')
    if any(b['half']!=half for b in bs):return reject('settling_half_unresolved')
    if not any(abs(b['v']-1.37)>CONFIG['net_margin_m'] and ('near' if b['v']<1.37 else 'far')==half for b in bs):
        return reject('settling_half_unresolved')
    if any(m['t']+.12<t<s['first'] for t in crossings):return reject('crossing_after_net_motion')
    if any(lo<=p['first'] and p['last']<=s['first']-1 for p in sequences) or len([t for t in serves if lo<=t<=confirmed])>1:
        return reject('prior_sequence_or_multiple_serves')
    if any(confirmed<t<hi for t in serves):return reject('later_serve')
    geo=geometry(corners)
    if geo is None:return reject('calibration_unavailable')
    coords,_=geo
    contacts=sorted([c for c in candidates if c['kind']=='contact' and bs[1]['t']<=c['t']<=hi],key=lambda c:c['t'])
    for c in contacts:
        if c.get('side') not in ['near','far'] or (c.get('visual_confidence') or 0)<CONFIG['minimum_confidence']:continue
        if c.get('x') is None or c.get('y') is None:continue
        p=coords(c['x'],c['y']);near=c['side']=='near'
        if p['lateral']>CONFIG['max_lateral'] or not (CONFIG['near_min_q']<=p['q']<=CONFIG['near_max_q'] if near else CONFIG['far_min_q']<=p['q']<=CONFIG['far_max_q']):continue
        for b in candidates:
            if b['kind']!='bounce' or not c['t']+CONFIG['minimum_delay_s']<=b['t']<=min(hi,c['t']+CONFIG['maximum_delay_s']):continue
            if (b.get('visual_confidence') or 0)<CONFIG['minimum_confidence'] or b.get('u') is None or b.get('v') is None:continue
            if not(0<=b['u']<=1.525 and 0<=b['v']<=2.74) or abs(b['v']-1.37)<=CONFIG['net_margin_m']:continue
            if ('near' if b['v']<1.37 else 'far')==c['side']:continue
            if any(c['t']<z['t']<b['t'] for z in contacts):continue
            if any(c['t']<t<=min(hi,b['t']+CONFIG['crossing_tolerance_frames']/fps) for t in crossings):
                r['evidence']['later_shot']=dict(contact=c,landing=b)
                return reject('later_receiving_shot')
    r.update(winner='far' if half=='near' else 'near',reason='positive_net_event')
    return r
