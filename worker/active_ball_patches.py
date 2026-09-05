"""Owned native-resolution candidate classifier with soft table context.

Classical pixel motion proposes candidates; this network learns which candidate
is the active ball. No production/BlurBall detector or weights are used.
"""
import cv2
import numpy as np
import torch
from torch import nn


def patch_training_rows(rows,allow_assistant=False):
    result=[]
    for row in rows:
        if row['split']!='train':continue
        label=row.get('label')
        if not label and allow_assistant:label=row.get('weak_label')
        if label and label['state']!='unsure' and label.get('provenance') in (('human','assistant_visual_v1') if allow_assistant else ('human',)):
            result.append({**row,'label':label})
    return result


def choose_candidate(candidates,scores,threshold=.7,margin=.1):
    if len(candidates)!=len(scores):raise ValueError('candidate/score count mismatch')
    ranked=sorted([{**c,'score':float(s)} for c,s in zip(candidates,scores)],key=lambda c:c['score'],reverse=True)
    if not ranked or ranked[0]['score']<threshold:state='hidden'
    elif len(ranked)>1 and ranked[0]['score']-ranked[1]['score']<margin:state='unsure'
    else:state='visible'
    return {'state':state,'x':ranked[0]['x'] if state=='visible' else None,'y':ranked[0]['y'] if state=='visible' else None,'score':ranked[0]['score'] if ranked else 0.,'candidates':ranked[:4]}


def candidate_patch(frames,x,y,size=96):
    x,y=round(x),round(y);half=size//2;images=[]
    for frame in frames:
        height,width=frame.shape[:2];left=x-half;top=y-half
        tile=np.zeros((size,size,3),np.uint8)
        x0,x1=max(0,left),min(width,left+size);y0,y1=max(0,top),min(height,top+size)
        if x1>x0 and y1>y0:tile[y0-top:y1-top,x0-left:x1-left]=frame[y0:y1,x0:x1]
        images.append(cv2.cvtColor(tile,cv2.COLOR_BGR2RGB).transpose(2,0,1))
    return torch.from_numpy(np.concatenate(images).astype(np.float32)/255)


def candidate_geometry(x,y,corners,dt):
    polygon=np.asarray(corners,np.float32)
    width=(np.linalg.norm(polygon[0]-polygon[1])+np.linalg.norm(polygon[2]-polygon[3]))/2
    if width<=0 or dt<=0:raise ValueError('invalid geometry/timing')
    center=polygon.mean(axis=0)
    return torch.tensor([(x-center[0])/width,(y-center[1])/width,cv2.pointPolygonTest(polygon,(float(x),float(y)),True)/width,dt*30],dtype=torch.float32).clamp(-10,10)


class ActiveBallPatchNet(nn.Module):
    def __init__(self):
        super().__init__()
        layers=[]
        for a,b in [(9,16),(16,32),(32,48)]:
            layers.extend([nn.Conv2d(a,b,3,padding=1,stride=2),nn.GroupNorm(4,b),nn.SiLU()])
        self.features=nn.Sequential(*layers)
        self.classifier=nn.Sequential(nn.Linear(100,48),nn.SiLU(),nn.Linear(48,1))

    def forward(self,patches,geometry):
        f=self.features(patches)
        pooled=torch.cat([f.mean(dim=(-2,-1)),f.amax(dim=(-2,-1)),geometry],dim=1)
        return self.classifier(pooled).squeeze(1)
