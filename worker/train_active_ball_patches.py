"""Train the native-resolution candidate model locally from reviewed examples."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import cv2
import numpy as np
import torch
from torch.nn import functional as F
from worker.active_ball_data import validate_dataset
from worker.active_ball_motion import motion_candidates
from worker.active_ball_patches import ActiveBallPatchNet, candidate_patch, candidate_geometry, patch_training_rows


def main():
    parser=argparse.ArgumentParser();parser.add_argument('manifest',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--allow-assistant-labels',action='store_true');parser.add_argument('--epochs',type=int,default=50);args=parser.parse_args()
    seed=20260905;random.seed(seed);np.random.seed(seed);torch.manual_seed(seed)
    source=json.loads(args.manifest.read_text());validate_dataset(source);rows=patch_training_rows(source,args.allow_assistant_labels);validate_dataset(rows)
    patches=[];geometries=[];targets=[];records=[]
    def add(frames,row,x,y,positive):
        dt=(row['frame_times_s'][2]-row['frame_times_s'][0])/2
        patches.append(candidate_patch(frames,x,y));geometries.append(candidate_geometry(x,y,row['corners'],dt));targets.append(float(positive));records.append({'source_id':row['id'],'x':x,'y':y,'positive':positive})
    for row in rows:
        frames=[cv2.imread(p) for p in row['frames']]
        if any(frame is None for frame in frames):raise ValueError('could not decode input frames')
        label=row['label']
        if label['state']=='visible':
            # Small centroid uncertainty, not fictitious new independent footage.
            for _ in range(24):add(frames,row,label['x']+random.randint(-6,6),label['y']+random.randint(-6,6),True)
        for c in motion_candidates(frames):
            if label['state']=='visible' and np.hypot(c['x']-label['x'],c['y']-label['y'])<64:continue
            add(frames,row,c['x'],c['y'],False)
    if not targets or min(targets)==max(targets):raise ValueError('need both checked ball examples and hard negatives')
    args.output.mkdir(parents=True,exist_ok=True)
    x=torch.stack(patches);g=torch.stack(geometries);y=torch.tensor(targets)
    device='mps' if torch.backends.mps.is_available() else 'cpu';model=ActiveBallPatchNet().to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=0.001,weight_decay=0.01)
    positive=np.flatnonzero(np.array(targets)==1);negative=np.flatnonzero(np.array(targets)==0)
    print(json.dumps({'device':device,'source_frames':len(rows),'positive_patches':len(positive),'negative_patches':len(negative),'assistant_labels':args.allow_assistant_labels}),flush=True)
    history=[]
    for epoch in range(args.epochs):
        model.train();losses=[]
        # Balanced patch batches, retaining the true unique-source count above.
        for _ in range(max(8,len(targets)//32)):
            indices=np.concatenate([np.random.choice(positive,16),np.random.choice(negative,16)]);np.random.shuffle(indices)
            batch=x[indices].to(device);geom=g[indices].to(device);truth=y[indices].to(device)
            # Local reflection changes appearance only; table-relative center stays fixed.
            if random.random()<.5:batch=batch.flip(-1)
            optimizer.zero_grad();logits=model(batch,geom);loss=F.binary_cross_entropy_with_logits(logits,truth)
            if not torch.isfinite(loss):raise ValueError('non-finite training loss')
            loss.backward();optimizer.step();losses.append(float(loss.detach().cpu()))
        entry={'epoch':epoch+1,'training_loss':float(np.mean(losses)),'validation_accuracy':None};history.append(entry);print(json.dumps(entry),flush=True)
        checkpoint={'architecture':'active-ball-patch-v1','state_dict':{k:v.detach().cpu() for k,v in model.state_dict().items()},'epoch':epoch+1,'seed':seed,'device_used':device,'training_ids':[r['id'] for r in rows],'training_provenance':sorted({r['label']['provenance'] for r in rows}),'manifest_sha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),'candidate_source':'local_pixel_motion','candidate_threshold':0.7,'ambiguity_margin':0.1}
        temporary=args.output/'model.tmp.pt';torch.save(checkpoint,temporary);temporary.replace(args.output/'model.pt')
        (args.output/'history.json').write_text(json.dumps(history,indent=2))
    (args.output/'training-patches.json').write_text(json.dumps(records,indent=2))


if __name__=='__main__':main()
