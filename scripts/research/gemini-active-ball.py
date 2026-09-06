"""Frozen blind Gemini experiment. Runner reads inputs.json, never benchmark labels.
No credentials or media bytes are logged. Retains raw responses for reproducibility.
"""
import argparse,base64,hashlib,json,math,subprocess,time,urllib.request,urllib.error
from pathlib import Path

PROMPT = '''Locate the active table-tennis ball belonging to ONE selected table in the TARGET still image. You receive a short context video and three original-resolution consecutive still images: BEFORE, TARGET, AFTER. The video is context only; report coordinates in TARGET, not in another frame. The selected table's four corners are supplied in original-image pixel coordinates, ordered near-left, near-right, far-right, far-left. The ball may be above or outside this polygon. Other tables' balls, balls in baskets, balls being held, floor balls, clothing, shoes, watches, reflections and logos are NOT the active ball. Use the motion and relevant players to establish identity, rather than choosing any white object.
Return state visible if you can locate the active moving ball, hidden if the rally is in play but the ball is occluded or outside the image, absent if there is no active rally ball (including held balls/between points), unsure if evidence cannot resolve identity or visibility. For visible, return the centre of the ball or its motion blur in TARGET as x,y normalized 0..1000, x increasing right and y down. Otherwise x,y must be null. Do not invent a coordinate when hidden. Give a short explanation based only on the supplied images. Your answer will be evaluated against independently collected labels that are not available to you.'''
SCHEMA={'type':'object','properties':{'state':{'type':'string','enum':['visible','hidden','absent','unsure']},'x':{'type':['number','null']},'y':{'type':['number','null']},'reason':{'type':'string'}},'required':['state','x','y','reason']}
CONFIG={'temperature':0,'maxOutputTokens':2048,'mediaResolution':'MEDIA_RESOLUTION_HIGH','thinkingConfig':{'thinkingLevel':'LOW'},'responseMimeType':'application/json','responseJsonSchema':SCHEMA}
CONTEXT_MODE = 'original_pixels'

def image_context(row):
    if CONTEXT_MODE == 'normalized':
        corners = [[x/row['width']*1000,y/row['height']*1000] for x,y in row['corners']]
        return '\nSelected table corners (x,y normalized 0..1000): '+json.dumps(corners)
    return f'\nImage width={row["width"]}, height={row["height"]}. Selected table corners (pixels): '+json.dumps(row['corners'])

def parse_prediction(d,width,height):
    if d.get('state') not in ['visible','hidden','absent','unsure']:raise ValueError('invalid state')
    x,y=d.get('x'),d.get('y')
    if d['state']=='visible':
        if not all(isinstance(v,(float,int)) and not isinstance(v,bool) and math.isfinite(v) and 0<=v<=1000 for v in [x,y]):raise ValueError('invalid coordinates')
        x,y=min(width-1,x*width/1000),min(height-1,y*height/1000)
    elif x is not None or y is not None:raise ValueError('nonvisible coordinates')
    return {'state':d['state'],'x':x,'y':y,'reason':str(d.get('reason',''))}

def main():
    a=argparse.ArgumentParser();a.add_argument('run',type=Path);a.add_argument('--limit',type=int,default=178);a.add_argument('--max-usd',type=float,default=5);a.add_argument('--shard',type=int,default=0);a.add_argument('--shards',type=int,default=1);a.add_argument('--interval',type=float,default=13);args=a.parse_args()
    rows=json.loads((args.run/'inputs.json').read_text()); model='gemini-3.8-flash'
    frozen={'model':model,'prompt':PROMPT,'config':CONFIG,'input_sha256':hashlib.sha256((args.run/'inputs.json').read_bytes()).hexdigest(),'estimated_price_per_million':{'input':.75,'output_including_thinking':3.75},'evaluation_tolerances_source_px':[10,20,40]}
    if CONTEXT_MODE != 'original_pixels': frozen['coordinate_context'] = CONTEXT_MODE
    protocol=args.run/'protocol.json'
    if protocol.exists():assert json.loads(protocol.read_text())==frozen,'Protocol changed; start a separate run'
    else:protocol.write_text(json.dumps(frozen,indent=2))
    (args.run/'responses').mkdir(exist_ok=True)
    key=subprocess.run(['security','find-generic-password','-a','openclaw','-s','ponglens-gemini-api-key','-w'],capture_output=True,text=True,check=True).stdout.strip()
    spent=0
    for old in (args.run/'responses').glob('*.json'):spent+=json.loads(old.read_text()).get('estimated_usd',0)
    for position,row in enumerate(rows[:args.limit]):
        if position % args.shards != args.shard:continue
        path=args.run/'responses'/f'{row["id"]}.json'
        if path.exists():continue
        spent=sum(json.loads(f.read_text()).get('estimated_usd',0) for f in (args.run/'responses').glob('*.json'))
        if spent+.05*args.shards>args.max_usd:raise RuntimeError('Cost guard reached')
        def part(path,mime):return {'inlineData':{'mimeType':mime,'data':base64.b64encode(Path(path).read_bytes()).decode()}}
        parts=[{'text':'Context video only. The TARGET still below is the frame to label.'},part(args.run.parent/'context'/f'{row["id"]}.mp4','video/mp4')]
        for i,name in enumerate(['BEFORE','TARGET','AFTER']):
            parts.extend([{'text':f'{name}: source time {row["frame_times_s"][i]:.6f}s'},part(row['frames'][i],'image/jpeg')])
        parts.append({'text':PROMPT+image_context(row)})
        payload=json.dumps({'contents':[{'role':'user','parts':parts}],'generationConfig':CONFIG}).encode()
        request=urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',data=payload,headers={'x-goog-api-key':key,'Content-Type':'application/json'})
        start=time.monotonic()
        for attempt in range(4):
            time.sleep(max(0,args.interval))  # Default pacing supports the observed free tier.
            try:
                with urllib.request.urlopen(request,timeout=90) as response:raw=json.load(response)
                break
            except urllib.error.HTTPError as e:
                detail=json.loads(e.read()).get('error',{})
                (args.run/f'api-error-{args.shard}.json').write_text(json.dumps({'id':row['id'],'attempt':attempt+1,'status':e.code,'error':detail},indent=2))
                print(json.dumps({'http_status':e.code,'attempt':attempt+1}),flush=True)
                violations=[v for d in detail.get('details',[]) for v in d.get('violations',[])]
                if any('PerDay' in v.get('quotaId','') for v in violations):raise SystemExit(3)
                if e.code in [429,500,502,503,504] and attempt<3:
                    retry_info=next((v for v in detail.get('details',[]) if v.get('@type','').endswith('RetryInfo')),{})
                    delay=float(retry_info.get('retryDelay','0s').rstrip('s'))
                    time.sleep(min(60,max(delay,[3,10,25][attempt])));continue
                raise SystemExit(2)
        texts=[p.get('text','') for c in raw.get('candidates',[]) for p in c.get('content',{}).get('parts',[]) if not p.get('thought')]
        usage=raw.get('usageMetadata',{});cost=(usage.get('promptTokenCount',0)*.75+(usage.get('candidatesTokenCount',0)+usage.get('thoughtsTokenCount',0))*3.75)/1e6
        result={'id':row['id'],'raw':raw,'elapsed_s':time.monotonic()-start,'estimated_usd':cost}
        try:result['prediction']=parse_prediction(json.loads(''.join(texts)),row['width'],row['height'])
        except (ValueError,TypeError):result['prediction']=None;result['parse_error']=True
        temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(result,indent=2));temporary.replace(path);spent+=cost
        print(json.dumps({'completed':len(list((args.run/'responses').glob('*.json'))),'valid':result['prediction'] is not None,'estimated_usd':round(spent,4)}),flush=True)
        if result['prediction'] is None:return

if __name__=='__main__':main()
