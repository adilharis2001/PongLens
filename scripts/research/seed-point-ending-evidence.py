"""Freeze cached ball/bounce evidence alongside the existing labeling corpus.
No inference, score writes, or label writes. Default dry run; --apply inserts
missing evidence only and refuses to replace any existing detector snapshot.
"""
import argparse, hashlib, json, math, pathlib, subprocess
from collections import Counter

def read(path): return json.loads(path.read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def prepare(base,recall):
    p=base/'out-ball-private';seeds=read(p/'point-ending-seed.json')['rows'];result=[]
    for slug in dict.fromkeys(r['source']['slug'] for r in seeds):
        truthpath=p/f'out/{slug}.truth.json';metapath=p/f'evidence/{slug}/match.json'
        truth=read(truthpath);meta=read(metapath);w=meta['source']['width'];h=meta['source']['height']
        byid={r['id']:r for r in truth['rows']}
        if slug in ('prabhas','ishan'):
            folder=recall/('prabhas_rc' if slug=='prabhas' else 'ishan');trackpath=folder/'det.jsonl'
            raw=read(p/f'corpus/{slug}.json')['match']['raw_path']
            assert read(folder/'labels.json')['raw_path']==raw
            fps=read(folder/'ball.json')['fps'];track=[]
            for line in trackpath.open():
                r=json.loads(line)
                if r.get('x') is not None: track.append([r['f']/fps,r['x']/w,r['y']/h])
            lineage='Cached full-frame ball detections from an earlier research run. Bounce markers are from the saved match processing.'
        else:
            trackpath=p/f'evidence/{slug}/tracks.json';saved=read(trackpath)
            assert saved['clock']=='source' and saved['conf']=='measured' and saved['w']==w and saved['h']==h
            track=sorted({r[0]:r[:3] for c in saved['cards'] for r in c['track']}.values())
            lineage='Saved production ball detections. Gaps outside the original processing cards have no stored trail.'
        hashes={'truth':sha(truthpath),'metadata':sha(metapath),'track':sha(trackpath)}
        for seed in [r for r in seeds if r['source']['slug']==slug]:
            source=seed['source'];assert source['sourceHash']==hashes['truth'] and seed['processing_version_id']==truth['version']
            lo=source['start']-source['rawOffset'];hi=source['end']-source['rawOffset'];row=byid[seed['id']]
            bounces=[{'t':b['t'],'x':b['x']/w,'y':b['y']/h} for b in (row.get('placement') or {}).get('candidates',[]) if b.get('kind')=='bounce' and b.get('x') is not None and b.get('y') is not None and lo<=b['t']<=hi]
            payload={'width':w,'height':h,'rawOffset':source['rawOffset'],'track':[r for r in track if lo<=r[0]<=hi],'bounces':sorted(bounces,key=lambda b:b['t']),'lineage':lineage}
            assert all(all(isinstance(v,(int,float)) and math.isfinite(v) for v in r) for r in payload['track'])
            assert all(all(math.isfinite(v) for v in b.values()) for b in bounces)
            result.append({'point_id':seed['id'],'payload':payload,'input_hashes':hashes,'source':source,'slug':slug})
    assert len(result)==479
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('base',type=pathlib.Path);parser.add_argument('--recall',type=pathlib.Path,default=pathlib.Path('/Users/adil/Desktop/Projects/TTVid/recall-lab/work'));parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    rows=prepare(args.base,args.recall)
    if args.apply:
        import psycopg2
        from psycopg2.extras import Json
        url=subprocess.check_output(['security','find-generic-password','-a','openclaw','-s','ponglens-db-url','-w'],stderr=subprocess.DEVNULL).decode().strip()
        migration=pathlib.Path(__file__).resolve().parents[2]/'supabase/migrations/20260919010000_point_ending_evidence.sql'
        with psycopg2.connect(url) as conn:
            with conn.cursor() as q:
                q.execute('select id,label,revision from point_ending_research order by id');before=q.fetchall()
                q.execute("select to_regclass('public.point_ending_evidence')")
                if q.fetchone()[0] is None:
                    q.execute(migration.read_text())
                    q.execute('insert into supabase_migrations.schema_migrations(version,name,statements) values(%s,%s,%s)',('20260919010000','point_ending_evidence',[migration.read_text()]))
                for r in rows:
                    q.execute('select source from point_ending_research where id=%s',(r['point_id'],));assert q.fetchone()[0]==r['source']
                    q.execute('insert into point_ending_evidence(point_id,payload,input_hashes) values(%s,%s,%s) on conflict do nothing',(r['point_id'],Json(r['payload']),Json(r['input_hashes'])))
                    q.execute('select payload,input_hashes from point_ending_evidence where point_id=%s',(r['point_id'],));assert q.fetchone()==(r['payload'],r['input_hashes'])
                q.execute('select id,label,revision from point_ending_research order by id');assert q.fetchall()==before
    print(json.dumps({'points':len(rows),'with_track':sum(bool(r['payload']['track']) for r in rows),'with_bounces':sum(bool(r['payload']['bounces']) for r in rows),'observations':sum(len(r['payload']['track']) for r in rows),'bounces':sum(len(r['payload']['bounces']) for r in rows),'bytes':len(json.dumps(rows)),'applied':args.apply},indent=2))
if __name__=='__main__':main()
