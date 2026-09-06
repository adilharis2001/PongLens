"""Render actual local checkpoint predictions; never reads labels for inference."""
import argparse
import json
import time
from pathlib import Path
import cv2
import numpy as np
import torch
from worker.active_ball_model import ActiveBallNet
from worker.train_active_ball import inputs


def decode_prediction(heat,visible,width,height):
    probability=heat.flatten().softmax(dim=0).reshape(heat.shape)
    index=int(probability.argmax());y,x=divmod(index,heat.shape[1])
    presence=float(visible.sigmoid());is_visible=presence>=0.5
    return {'state':'visible' if is_visible else 'hidden','x':float(x/heat.shape[1]*width) if is_visible else None,'y':float(y/heat.shape[0]*height) if is_visible else None,'presence_score':presence,'peak_score':float(probability[y,x])}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('manifest',type=Path);parser.add_argument('checkpoint',type=Path);parser.add_argument('output',type=Path);parser.add_argument('--run-name',required=True);args=parser.parse_args()
    rows=json.loads(args.manifest.read_text());checkpoint=torch.load(args.checkpoint,map_location='cpu',weights_only=True)
    if checkpoint.get('heat_normalization')!='spatial_softmax':raise ValueError('unsupported checkpoint heatmap contract')
    device='mps' if torch.backends.mps.is_available() else 'cpu'
    model=ActiveBallNet().to(device);model.load_state_dict(checkpoint['state_dict']);model.eval()
    args.output.mkdir(parents=True,exist_ok=True);(args.output/'overlays').mkdir(exist_ok=True)
    predictions=[];times=[]
    with torch.no_grad():
        for row in rows:
            x=inputs(row)[None].to(device)
            if device=='mps':torch.mps.synchronize()
            start=time.perf_counter();heat,visible=model(x)
            prediction=decode_prediction(heat[0,0].cpu(),visible[0].cpu(),row['width'],row['height'])
            times.append(time.perf_counter()-start)
            predictions.append({'id':row['id'],'split':row['split'],'prediction':prediction,'model_run':args.run_name})
            frame=cv2.imread(row['frames'][1]);cv2.polylines(frame,[np.asarray(row['corners'],np.int32)],True,(255,200,20),2)
            if prediction['state']=='visible':cv2.circle(frame,(round(prediction['x']),round(prediction['y'])),14,(210,40,240),3)
            cv2.putText(frame,f"{args.run_name}: {prediction['state']} | provisional",(25,45),cv2.FONT_HERSHEY_SIMPLEX,1,(255,255,255),2)
            cv2.imwrite(str(args.output/'overlays'/f"{row['id']}.jpg"),frame)
    (args.output/'predictions.json').write_text(json.dumps(predictions,indent=2))
    summary={'samples':len(rows),'epoch':checkpoint['epoch'],'training_samples':len(checkpoint['training_ids']),'weak_bootstrap':checkpoint['weak_bootstrap'],'median_model_ms':float(np.median(times[1:])*1000),'visible_predictions':{s:sum(p['split']==s and p['prediction']['state']=='visible' for p in predictions) for s in ['train','validation','test']},'accuracy':None,'accuracy_note':'No human ball-position benchmark yet. Counts are outputs, not correctness.'}
    (args.output/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))


if __name__=='__main__':main()
