"""Local pilot trainer. python -m worker.train_active_ball MANIFEST OUTPUT.

Only reviewed training labels enter optimization. Validation selects the
checkpoint; test labels are never opened by training. Predictions remain proposals.
"""
import argparse
import json
import random
from pathlib import Path
import cv2
import numpy as np
import torch
from torch.nn import functional as F
from worker.active_ball_data import validate_dataset
from worker.active_ball_model import ActiveBallNet, ball_target


def inputs(row,width=640,height=384):
    frames=[]
    for path in row['frames']:
        image=cv2.imread(path)
        if image is None:raise ValueError(f'cannot decode {path}')
        if image.shape[:2] != (row['height'],row['width']):raise ValueError('source dimensions changed')
        frames.append(cv2.cvtColor(cv2.resize(image,(width,height)),cv2.COLOR_BGR2RGB).transpose(2,0,1)/255.)
    polygon=np.asarray(row['corners'],dtype=np.float32)*[width/row['width'],height/row['height']]
    mask=np.zeros((height,width),np.float32);cv2.fillPoly(mask,[polygon.astype(np.int32)],1)
    times=row['frame_times_s']
    if len(times)!=3 or not times[0]<times[1]<times[2]:raise ValueError('invalid frame timestamps')
    elapsed=np.full_like(mask,(times[2]-times[0])/2*30)
    return torch.from_numpy(np.concatenate([*frames,mask[None],elapsed[None]]).astype(np.float32))


def loss_for(heat,visible,target,states):
    # Localize conditionally on visibility. Averaging sigmoid error over all
    # background pixels let the first run minimize loss without finding a ball.
    # A normalized spatial distribution gives every visible ball equal weight.
    flat=target.flatten(1)
    distribution=flat/flat.sum(dim=1,keepdim=True).clamp_min(1e-8)
    per_frame=-(distribution*F.log_softmax(heat.flatten(1),dim=1)).sum(dim=1)
    localization=(per_frame*states).sum()/states.sum().clamp_min(1)
    presence=F.binary_cross_entropy_with_logits(visible,states)
    return localization+0.1*presence


def select_training(rows,weak=False):
    selected=[]
    for r in rows:
        if r['split']!='train':continue
        label=r.get('label')
        if not label and weak:label=r.get('weak_label')
        if label and label['state']!='unsure' and label.get('provenance') in (('human','local_motion_v0','local_motion_v1','assistant_visual_v1') if weak else ('human',)):
            selected.append({**r,'label':label})
    return selected


def main():
    parser=argparse.ArgumentParser();parser.add_argument('manifest',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--epochs',type=int,default=40);parser.add_argument('--batch-size',type=int,default=4)
    parser.add_argument('--weak-bootstrap',action='store_true',help='Train fixed epochs on explicitly provisional local-motion labels; no validation accuracy claims.')
    args=parser.parse_args()
    random.seed(20260905);np.random.seed(20260905);torch.manual_seed(20260905)
    rows=validate_dataset(json.loads(args.manifest.read_text()))
    accepted=lambda r: r.get('label') and r['label'].get('provenance')=='human' and r['label']['state']!='unsure'
    train=select_training(rows,weak=args.weak_bootstrap)
    val=[] if args.weak_bootstrap else [r for r in rows if r['split']=='validation' and accepted(r)]
    if not train or (not val and not args.weak_bootstrap):raise SystemExit('Need reviewed training and validation ball labels; refusing to treat proposals as truth.')
    validate_dataset(train+val)
    args.output.mkdir(parents=True,exist_ok=True)
    device=torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    model=ActiveBallNet().to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=0.001)
    cache={r['id']:(inputs(r),ball_target(r['label'],r['width'],r['height'],320,192)[None],torch.tensor(float(r['label']['state']=='visible'))) for r in train+val}
    history=[];best=float('inf')
    for epoch in range(args.epochs):
        model.train();random.shuffle(train);total=0
        for start in range(0,len(train),args.batch_size):
            batch=[cache[r['id']] for r in train[start:start+args.batch_size]]
            x,y,state=[torch.stack(list(v)).to(device) for v in zip(*batch)]
            optimizer.zero_grad();heat,visible=model(x);loss=loss_for(heat,visible,y,state)
            if not torch.isfinite(loss):raise RuntimeError('non-finite training loss')
            loss.backward();optimizer.step();total+=float(loss.detach().cpu())*len(batch)
        model.eval();score=0
        with torch.no_grad():
            for r in val:
                x,y,state=cache[r['id']];heat,visible=model(x[None].to(device))
                score+=float(loss_for(heat,visible,y[None].to(device),state[None].to(device)).cpu())
        score=score/len(val) if val else None
        entry={'epoch':epoch+1,'train_loss':total/len(train),'validation_loss':score,'weak_bootstrap':args.weak_bootstrap};history.append(entry);print(json.dumps(entry),flush=True)
        if args.weak_bootstrap or score<best:
            if score is not None:best=score
            checkpoint={'state_dict':{k:v.detach().cpu() for k,v in model.state_dict().items()},'architecture':'active-ball-v1','heat_normalization':'spatial_softmax','input_size':[640,384],'epoch':epoch+1,'seed':20260905,'training_ids':[r['id'] for r in train],'validation_ids':[r['id'] for r in val],'weak_bootstrap':args.weak_bootstrap,'training_provenance':sorted({r['label']['provenance'] for r in train})}
            tmp=args.output/'model.tmp.pt';torch.save(checkpoint,tmp);tmp.replace(args.output/'model.pt')
        (args.output/'history.json').write_text(json.dumps(history,indent=2))


if __name__=='__main__':main()
