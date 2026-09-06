"""Local pixel-motion proposals. These are weak labels, never human truth."""
import cv2
import numpy as np


def motion_candidates(frames):
    previous,middle,following=frames
    gray=[cv2.cvtColor(f,cv2.COLOR_BGR2GRAY) for f in frames]
    change=np.minimum(cv2.absdiff(gray[1],gray[0]),cv2.absdiff(gray[1],gray[2]))
    blue,green,red=cv2.split(middle)
    low=cv2.min(blue,cv2.min(green,red));high=cv2.max(blue,cv2.max(green,red))
    white=cv2.bitwise_and(cv2.inRange(low,136,255),cv2.inRange(cv2.subtract(high,low),0,84))
    mask=cv2.bitwise_and(cv2.inRange(change,23,255),white)
    count,labels,stats,centers=cv2.connectedComponentsWithStats(mask,8)
    sums=np.bincount(labels.ravel(),weights=change.ravel(),minlength=count)
    candidates=[]
    for i in range(1,count):
        x,y,w,h,area=stats[i]
        if not 4<=area<=900 or max(w,h)>90 or max(w,h)/max(1,min(w,h))>12:continue
        cx,cy=centers[i]
        candidates.append({'x':float(cx),'y':float(cy),'area':int(area),'motion':float(sums[i]/area)})
    return candidates


def ball_candidates(frames):
    """High-recall moving and stationary ball candidates in source pixels."""
    candidates = [{**candidate, 'source': 'motion'} for candidate in motion_candidates(frames)]
    middle = frames[1]
    blue, green, red = cv2.split(middle)
    low = cv2.min(blue, cv2.min(green, red)); high = cv2.max(blue, cv2.max(green, red))
    white = cv2.bitwise_and(cv2.inRange(low, 155, 255), cv2.inRange(cv2.subtract(high, low), 0, 62))
    hsv = cv2.cvtColor(middle, cv2.COLOR_BGR2HSV)
    orange = cv2.inRange(hsv, np.array([3, 90, 110], np.uint8), np.array([35, 255, 255], np.uint8))
    mask = cv2.bitwise_or(white, orange)
    count, labels, stats, centers = cv2.connectedComponentsWithStats(mask, 8)
    for i in range(1, count):
        x, y, w, h, area = stats[i]
        if not 5 <= area <= 900 or max(w, h) > 90 or max(w, h) / max(1, min(w, h)) > 6:
            continue
        cx, cy = centers[i]
        if any(np.hypot(candidate['x'] - cx, candidate['y'] - cy) < 8 for candidate in candidates):
            continue
        candidates.append({'x': float(cx), 'y': float(cy), 'area': int(area),
                           'motion': 0.0, 'source': 'appearance'})
    return candidates


def propose(frames,corners):
    candidates=motion_candidates(frames)
    polygon=np.asarray(corners,np.float32)
    scale=(np.linalg.norm(polygon[0]-polygon[1])+np.linalg.norm(polygon[2]-polygon[3]))/2
    center=polygon.mean(axis=0)
    ranked=[]
    for c in candidates:
        # Soft distance, not a playing-surface crop. Balls can be above/outside.
        distance=cv2.pointPolygonTest(polygon,(c['x'],c['y']),True)
        c={**c,'score':c['motion']/255-0.65*max(0,-distance)/max(1,scale)-0.1*np.linalg.norm(np.array([c['x'],c['y']])-center)/max(1,scale)}
        ranked.append(c)
    ranked.sort(key=lambda c:c['score'],reverse=True)
    if ranked and ranked[0]['score']>0.05:
        best=ranked[0]
        if len(ranked)>1 and best['score']-ranked[1]['score']<0.06:
            return {'state':'unsure','x':None,'y':None,'provenance':'local_motion_v0'},ranked
        return {'state':'visible','x':best['x'],'y':best['y'],'provenance':'local_motion_v0'},ranked
    return {'state':'hidden','x':None,'y':None,'provenance':'local_motion_v0'},ranked


def consistent_candidate(previous,middle,following,times,table_width):
    """Conservative straight-flight proposals; declines slow/ambiguous motion.

    Speeds use elapsed time and apparent table width, not a fixed pixel/frame
    limit. This deliberately does not label contacts or slow serves by itself.
    Each candidate already incorporates its two neighbouring RGB frames.
    """
    if table_width<=0 or not times[0]<times[1]<times[2]:raise ValueError('invalid geometry or timestamps')
    plausible=[]
    for b in middle:
        for a in previous:
            v1=np.array([b['x']-a['x'],b['y']-a['y']])/(times[1]-times[0])
            speed=np.linalg.norm(v1)/table_width
            if not 1.5<speed<25:continue
            for c in following:
                v2=np.array([c['x']-b['x'],c['y']-b['y']])/(times[2]-times[1])
                delta=np.linalg.norm(v2-v1)/max(1,np.linalg.norm(v1));ratio=np.linalg.norm(v2)/max(1,np.linalg.norm(v1))
                if delta<.35 and .65<ratio<1.35:plausible.append((delta,b))
    if not plausible or len({(round(b['x']),round(b['y'])) for _,b in plausible})!=1:return None
    return min(plausible,key=lambda pair:pair[0])[1]
