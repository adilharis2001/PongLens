"""Fine-tune YOLO26 nano on the Mac Studio for one active-ball class."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser=argparse.ArgumentParser();parser.add_argument('data',type=Path);parser.add_argument('output',type=Path);parser.add_argument('--epochs',type=int,default=40);parser.add_argument('--imgsz',type=int,default=1280);parser.add_argument('--base-model',type=Path);parser.add_argument('--mosaic',type=float,default=1.0);parser.add_argument('--lr0',type=float);parser.add_argument('--name',default='train');args=parser.parse_args()
    import ultralytics
    from ultralytics import YOLO
    args.output.mkdir(parents=True,exist_ok=True)
    base_model=args.base_model or args.output.parent/'yolo26n.pt'
    protocol={'ultralytics_version':ultralytics.__version__,'base_model':str(base_model),'data':str(args.data),'data_sha256':hashlib.sha256(args.data.read_bytes()).hexdigest(),'epochs':args.epochs,'imgsz':args.imgsz,'batch':4,'device':'mps','seed':20260905,'table_conditioning':'focus_selected_table_v1','mosaic':args.mosaic,'lr0':args.lr0}
    (args.output/f'{args.name}-protocol.json').write_text(json.dumps(protocol,indent=2))
    model=YOLO(str(base_model))
    options={'data':str(args.data),'epochs':args.epochs,'imgsz':args.imgsz,'batch':4,'device':'mps','project':str(args.output),'name':args.name,'exist_ok':True,'patience':5,'seed':20260905,'deterministic':True,'workers':4,'cache':False,'plots':True,'verbose':True,'mosaic':args.mosaic,'close_mosaic':0}
    if args.lr0 is not None:options.update({'optimizer':'AdamW','lr0':args.lr0})
    model.train(**options)


if __name__=='__main__':main()
