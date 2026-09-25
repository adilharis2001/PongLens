"""Portable offline machine-contact recovery; no live worker wiring.

Authoritative entry point: recover_contacts(features, corners).
Track coordinates are normalized source x/y and source seconds; candidates
and corners are source pixels. Track ordering and source FPS are unchanged.

Exact split-boundary recovery from stroke_boundary_v1, followed by the contact
projection of same_shot_v1_1.analyze. That analyzer retains ALL contacts, even
implausible ones: its later plausibility/link checks affect winner inference,
not the returned contact list. Unavailable geometry returns no contacts.

The deterministic `fit` helper extrapolates four trajectory observations; it
is not a trained model or label fit. Only Python's math module is required.
"""
import math

CONFIG=dict(version=1,leg_points=4,max_gap_frames=2,jump_fraction_width=.055,
            minimum_leg_px=24,minimum_leg_fraction_width=.015,
            max_extrapolation_edge_width=.3,near_q_min=.75,far_q_max=.25,max_lateral_edge_width=1.,dedupe_s=.12)

def fit(points, t):
    mean_t=sum(p[0] for p in points)/len(points)
    den=sum((p[0]-mean_t)**2 for p in points)
    if den<=0:return None
    out=[]
    for dim in [1,2]:
        mean=sum(p[dim] for p in points)/len(points)
        velocity=sum((p[0]-mean_t)*(p[dim]-mean) for p in points)/den
        out.append(mean+velocity*(t-mean_t))
    return out

def recover(f,corners):
    near=[p for k,p in corners.items() if 'near' in k];far=[p for k,p in corners.items() if 'far' in k]
    if len(near)!=2 or len(far)!=2:return []
    origin=[sum(p[i] for p in far)/2 for i in range(2)]
    axis=[sum(p[i] for p in near)/2-origin[i] for i in range(2)]
    den=sum(x*x for x in axis);width=math.dist(*near)
    if den<=1 or width<=1:return []
    def q(p):return ((p[1]-origin[0])*axis[0]+(p[2]-origin[1])*axis[1])/den
    points=[[round(p[0]*f['fps'])/f['fps'],p[1]*f['width'],p[2]*f['height']] for p in f['track']]
    chunks=[];chunk=[];limit=max(48,f['width']*CONFIG['jump_fraction_width'])
    for p in points:
        if chunk:
            gap=round((p[0]-chunk[-1][0])*f['fps'])
            if gap>2 or math.dist(p[1:],chunk[-1][1:])>limit*max(1,min(gap,2)):
                chunks.append(chunk);chunk=[]
        chunk.append(p)
    if chunk:chunks.append(chunk)
    result=[]
    for before,after in zip(chunks,chunks[1:]):
        k=CONFIG['leg_points']
        if len(before)<k or len(after)<k:continue
        left=before[-k:];right=after[:k];p=left[-1]
        gap=round((right[0][0]-p[0])*f['fps'])
        if gap<1 or gap>CONFIG['max_gap_frames']:continue
        legmin=max(CONFIG['minimum_leg_px'],f['width']*CONFIG['minimum_leg_fraction_width'])
        left_motion=q(left[-1])-q(left[0]);right_motion=q(right[-1])-q(right[0])
        if left_motion*right_motion>=0:continue
        if min(abs(left_motion),abs(right_motion))*math.sqrt(den)<legmin:continue
        side='near' if left_motion>0 else 'far'
        if side=='near' and q(p)<CONFIG['near_q_min']:continue
        if side=='far' and q(p)>CONFIG['far_q_max']:continue
        lateral=abs((p[1]-origin[0])*axis[1]-(p[2]-origin[1])*axis[0])/math.sqrt(den)/width
        if lateral>CONFIG['max_lateral_edge_width']:continue
        extrapolated=fit(right,p[0])
        if extrapolated is None:continue
        error=math.dist(extrapolated,p[1:])
        if error>CONFIG['max_extrapolation_edge_width']*width:continue
        if any(c['kind']=='contact' and abs(c['t']-p[0])<=CONFIG['dedupe_s'] for c in f['candidates']):continue
        result.append(dict(kind='contact',t=p[0],side=side,x=p[1],y=p[2],u=None,v=None,
                           visual_confidence=None,origin='split_boundary_hypothesis',
                           extrapolation_error_px=error,boundary_gap_frames=gap,
                           original_jump_px=math.dist(right[0][1:],p[1:]),
                           original_jump_limit_px=limit*max(1,min(gap,2))))
    return result

def geometry(corners):
    near=[p for k,p in corners.items() if 'near' in k]
    far=[p for k,p in corners.items() if 'far' in k]
    if len(near)!=2 or len(far)!=2:return None
    origin=[sum(p[i] for p in far)/2 for i in range(2)]
    axis=[sum(p[i] for p in near)/2-origin[i] for i in range(2)]
    den=sum(v*v for v in axis);width=math.dist(*near)
    if den<=1 or width<=1:return None
    def coords(x,y):
        return dict(q=((x-origin[0])*axis[0]+(y-origin[1])*axis[1])/den,
                    lateral=abs((x-origin[0])*axis[1]-(y-origin[1])*axis[0])/math.sqrt(den)/width)
    return coords,width

def recover_contacts(features, corners):
    """Return ordered original + recovered machine contacts, without mutation.

    Mirrors row_from_features: recover, stable merge/sort, then analyze's
    contacts[*].event projection. Assumes valid chronological machine features;
    this low-level extraction does not repair malformed or mixed-clock inputs.
    Metadata is neither consumed nor used to choose a contact.
    """
    recovered = recover(features, corners)
    augmented = sorted(features['candidates'] + recovered, key=lambda c: c['t'])
    if geometry(corners) is None:
        return []
    return sorted([c for c in augmented if c['kind'] == 'contact'],
                  key=lambda c: c['t'])
