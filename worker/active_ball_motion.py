"""Local pixel-motion proposals. These are weak labels, never human truth."""
import cv2
import numpy as np


def motion_candidates(frames):
    previous,middle,following=frames
    gray=[cv2.cvtColor(f,cv2.COLOR_BGR2GRAY) for f in frames]
    change=np.minimum(cv2.absdiff(gray[1],gray[0]),cv2.absdiff(gray[1],gray[2]))
    white=(middle.min(axis=2)>135)&((middle.max(axis=2).astype(float)-middle.min(axis=2))<85)
    mask=((change>22)&white).astype(np.uint8)
    count,labels,stats,centers=cv2.connectedComponentsWithStats(mask,8)
    candidates=[]
    for i in range(1,count):
        x,y,w,h,area=stats[i]
        if not 4<=area<=900 or max(w,h)>90 or max(w,h)/max(1,min(w,h))>12:continue
        cx,cy=centers[i]
        candidates.append({'x':float(cx),'y':float(cy),'area':int(area),'motion':float(change[labels==i].mean())})
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
