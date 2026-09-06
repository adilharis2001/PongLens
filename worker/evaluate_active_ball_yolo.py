"""Choose confidence on validation, then score the untouched YOLO test split."""
import argparse
import cv2
import json
import statistics
import time
from pathlib import Path

import numpy as np

from worker.active_ball_teacher import score_predictions


def ranked_predictions(model,rows,imgsz):
    ranked={};timings=[]
    for index,row in enumerate(rows,1):
        start=time.perf_counter();result=model.predict(row['focused_frame'],imgsz=imgsz,conf=.001,device='mps',verbose=False)[0];timings.append(time.perf_counter()-start)
        ranked[row['id']]=[{'x':float(box.xywh[0,0]),'y':float(box.xywh[0,1]),'score':float(box.conf[0])} for box in result.boxes]
        if index%25==0:print(json.dumps({'inferred':index,'total':len(rows)}),flush=True)
    return ranked,timings


def predictions_at(rows,ranked,threshold):
    output={}
    for row in rows:
        choices=[candidate for candidate in ranked[row['id']] if candidate['score']>=threshold]
        if choices:
            best=max(choices,key=lambda candidate:candidate['score']);output[row['id']]={'state':'visible','x':best['x'],'y':best['y']}
        else:output[row['id']]={'state':'hidden','x':None,'y':None}
    return output


def add_groups(metrics,rows,predictions):
    key='source_name' if rows and 'source_name' in rows[0] else 'match_id'
    metrics['by_source']={value:score_predictions([row for row in rows if row[key]==value],predictions) for value in sorted({row[key] for row in rows})}
    return metrics


def write_overlays(rows,predictions,output):
    directory=output/'overlays';directory.mkdir(exist_ok=True)
    for row in rows:
        image=cv2.imread(row['focused_frame']);label=row['label'];prediction=predictions[row['id']]
        if label['state']=='visible':cv2.circle(image,(round(label['x']),round(label['y'])),18,(255,235,40),3)
        if prediction['state']=='visible':cv2.rectangle(image,(round(prediction['x'])-18,round(prediction['y'])-18),(round(prediction['x'])+18,round(prediction['y'])+18),(230,50,230),3)
        cv2.imwrite(str(directory/f"{row['id']}.jpg"),image,[cv2.IMWRITE_JPEG_QUALITY,90])


def main():
    parser=argparse.ArgumentParser();parser.add_argument('manifest',type=Path);parser.add_argument('checkpoint',type=Path);parser.add_argument('output',type=Path);parser.add_argument('--imgsz',type=int,default=1280);parser.add_argument('--threshold',type=float);parser.add_argument('--validation-only',action='store_true');args=parser.parse_args()
    from ultralytics import YOLO
    rows=[row for row in json.loads(args.manifest.read_text()) if row.get('label') and row['label']['state']!='unsure']
    validation=[row for row in rows if row['split']=='validation'];test=[row for row in rows if row['split']=='test']
    model=YOLO(str(args.checkpoint))
    if args.threshold is not None:
        ranked,times=ranked_predictions(model,rows,args.imgsz);predictions=predictions_at(rows,ranked,args.threshold);metrics=add_groups(score_predictions(rows,predictions),rows,predictions)
        summary={'architecture':'yolo26n','imgsz':args.imgsz,'threshold':args.threshold,'audit':metrics,'median_inference_ms':statistics.median(times)*1000}
        args.output.mkdir(parents=True,exist_ok=True);write_overlays(rows,predictions,args.output);(args.output/'summary.json').write_text(json.dumps(summary,indent=2));(args.output/'ranked.json').write_text(json.dumps(ranked,indent=2));(args.output/'predictions.json').write_text(json.dumps(predictions,indent=2));print(json.dumps(summary),flush=True);return
    validation_ranked,validation_times=ranked_predictions(model,validation,args.imgsz)
    choices=[];curve=[]
    for threshold in np.arange(.01,.96,.01):
        predictions=predictions_at(validation,validation_ranked,float(threshold));metrics=score_predictions(validation,predictions)
        correct=metrics['within_20px'];false=metrics['false_visible']+metrics['wrong_location'];missed=metrics['visible_reference']-correct
        f1=2*correct/max(1,2*correct+false+missed)
        choices.append((f1,correct,-false,float(threshold),metrics))
        curve.append({'threshold':float(threshold),'localization_f1':f1,'metrics':metrics})
    f1,*_,threshold,validation_metrics=max(choices)
    if args.validation_only:
        validation_predictions=predictions_at(validation,validation_ranked,threshold);validation_metrics=add_groups(validation_metrics,validation,validation_predictions)
        summary={'architecture':'yolo26n','imgsz':args.imgsz,'threshold':threshold,'validation_localization_f1':f1,'validation':validation_metrics,'median_validation_inference_ms':statistics.median(validation_times)*1000}
        args.output.mkdir(parents=True,exist_ok=True);(args.output/'summary.json').write_text(json.dumps(summary,indent=2));(args.output/'threshold-curve.json').write_text(json.dumps(curve,indent=2));(args.output/'validation-ranked.json').write_text(json.dumps(validation_ranked,indent=2));print(json.dumps(summary),flush=True);return
    test_ranked,test_times=ranked_predictions(model,test,args.imgsz);test_predictions=predictions_at(test,test_ranked,threshold);test_metrics=add_groups(score_predictions(test,test_predictions),test,test_predictions);validation_metrics=add_groups(validation_metrics,validation,predictions_at(validation,validation_ranked,threshold))
    summary={'architecture':'yolo26n','imgsz':args.imgsz,'threshold':threshold,'validation_localization_f1':f1,'validation':validation_metrics,'test':test_metrics,'median_validation_inference_ms':statistics.median(validation_times)*1000,'median_test_inference_ms':statistics.median(test_times)*1000}
    args.output.mkdir(parents=True,exist_ok=True);write_overlays(test,test_predictions,args.output);(args.output/'summary.json').write_text(json.dumps(summary,indent=2));(args.output/'threshold-curve.json').write_text(json.dumps(curve,indent=2));(args.output/'validation-ranked.json').write_text(json.dumps(validation_ranked,indent=2));(args.output/'test-ranked.json').write_text(json.dumps(test_ranked,indent=2));(args.output/'test-predictions.json').write_text(json.dumps(test_predictions,indent=2));print(json.dumps(summary),flush=True)


if __name__=='__main__':main()
