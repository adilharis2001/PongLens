"""Inference-only local candidate model evaluation. Labels are never consulted."""
import argparse
import json
from pathlib import Path
import time
import cv2
import numpy as np
import torch
from worker.active_ball_motion import motion_candidates
from worker.active_ball_patches import ActiveBallPatchNet, candidate_patch, candidate_geometry, choose_candidate


def main():
    parser=argparse.ArgumentParser();parser.add_argument('manifest',type=Path);parser.add_argument('checkpoint',type=Path);parser.add_argument('output',type=Path);parser.add_argument('--run-name',required=True);args=parser.parse_args()
    rows=json.loads(args.manifest.read_text());checkpoint=torch.load(args.checkpoint,map_location='cpu',weights_only=True)
    if checkpoint['architecture']!='active-ball-patch-v1':raise ValueError('wrong checkpoint architecture')
    device='mps' if torch.backends.mps.is_available() else 'cpu';model=ActiveBallPatchNet().to(device);model.load_state_dict(checkpoint['state_dict']);model.eval()
    args.output.mkdir(parents=True,exist_ok=True);(args.output/'overlays').mkdir(exist_ok=True);results=[];timings=[]
    with torch.no_grad():
        for row in rows:
            start=time.perf_counter();frames=[cv2.imread(path) for path in row['frames']]
            if any(f is None for f in frames):raise ValueError('could not decode frame')
            candidates=motion_candidates(frames);scores=[]
            dt=(row['frame_times_s'][2]-row['frame_times_s'][0])/2
            for offset in range(0,len(candidates),64):
                batch=candidates[offset:offset+64]
                patches=torch.stack([candidate_patch(frames,c['x'],c['y']) for c in batch]).to(device)
                geometry=torch.stack([candidate_geometry(c['x'],c['y'],row['corners'],dt) for c in batch]).to(device)
                scores.extend(model(patches,geometry).sigmoid().cpu().tolist())
            prediction=choose_candidate(candidates,scores,checkpoint['candidate_threshold'],checkpoint['ambiguity_margin']);timings.append(time.perf_counter()-start)
            results.append({'id':row['id'],'split':row['split'],'prediction':prediction,'model_run':args.run_name})
            image=frames[1];cv2.polylines(image,[np.asarray(row['corners'],np.int32)],True,(255,200,20),2)
            if prediction['state']=='visible':cv2.circle(image,(round(prediction['x']),round(prediction['y'])),14,(210,40,240),3)
            cv2.putText(image,f"{args.run_name}: {prediction['state']} | provisional",(25,45),cv2.FONT_HERSHEY_SIMPLEX,1,(255,255,255),2)
            cv2.imwrite(str(args.output/'overlays'/f"{row['id']}.jpg"),image)
    (args.output/'predictions.json').write_text(json.dumps(results,indent=2))
    summary={'samples':len(rows),'training_source_frames':len(checkpoint['training_ids']),'training_provenance':checkpoint['training_provenance'],'median_frame_ms_including_jpeg_decode':float(np.median(timings)*1000),'states':{s:sum(r['prediction']['state']==s for r in results) for s in ['visible','hidden','unsure']},'accuracy':None,'accuracy_note':'No independent human benchmark yet; these are prediction counts only.'}
    (args.output/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))


if __name__=='__main__':main()
