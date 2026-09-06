#!/usr/bin/env python3
"""Materialize focused target frames and YOLO labels from the frozen teacher set."""
import argparse
import json
import sys
from pathlib import Path

import cv2

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from worker.active_ball_data import validate_dataset
from worker.active_ball_yolo import focus_selected_table,yolo_label


def main():
    parser=argparse.ArgumentParser();parser.add_argument('manifest',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args()
    rows=json.loads(args.manifest.read_text());validate_dataset(rows,allow_shared_venues=True)
    rows=[row for row in rows if row.get('label') and row['label']['state']!='unsure']
    for split in ('train','validation','test'):
        (args.output/'images'/split).mkdir(parents=True,exist_ok=True);(args.output/'labels'/split).mkdir(parents=True,exist_ok=True)
    dataset_rows=[]
    for index,row in enumerate(rows,1):
        image=cv2.imread(row['frames'][1])
        if image is None or image.shape[:2]!=(row['height'],row['width']):raise ValueError(f"bad image {row['id']}")
        focused=focus_selected_table(image,row['corners']);image_path=args.output/'images'/row['split']/f"{row['id']}.jpg"
        cv2.imwrite(str(image_path),focused,[cv2.IMWRITE_JPEG_QUALITY,95])
        (args.output/'labels'/row['split']/f"{row['id']}.txt").write_text(yolo_label(row['label'],row['width'],row['height'])+'\n' if row['label']['state']=='visible' else '')
        dataset_rows.append({**row,'focused_frame':str(image_path)})
        if index%100==0:print(json.dumps({'prepared':index,'total':len(rows)}),flush=True)
    (args.output/'manifest.json').write_text(json.dumps(dataset_rows,indent=2))
    yaml=f"path: {args.output}\ntrain: images/train\nval: images/validation\ntest: images/test\nnames:\n  0: active_ball\n"
    (args.output/'dataset.yaml').write_text(yaml)
    print(json.dumps({'rows':len(rows),'visible':sum(r['label']['state']=='visible' for r in rows),'yaml':str(args.output/'dataset.yaml')}),flush=True)


if __name__=='__main__':main()
