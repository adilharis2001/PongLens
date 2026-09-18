"""Freeze the 479-point corpus and import owner annotations, never machine labels.
Dry-run by default. --apply applies this task's migration and inserts only missing
research rows in one transaction. Existing sources/labels are never overwritten.
"""
import argparse, hashlib, json, pathlib, subprocess
from collections import Counter

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return json.loads(path.read_text())
def prepare(base):
    private=base/'out-ball-private'
    inventory=read(private/'coverage-priorities-v1/inventory.json')
    identities={r['point_id']:r for group in inventory['groups'].values() for r in group}
    assert len(identities)==inventory['total']==479
    clocks=read(private/'out/media-clock-map.json')
    names={'lester':'Lester','prabhas':'Prabhas','ishan':'Ishan','chris_aug22':'Chris · August 22','julian_aug23':'Julian · August 23','yuyulin':'Yu Yu Lin'}
    archive=[];annotations={}
    for folder in ['out-ball-review','selective-exit-review','same-shot-review','final-contact-review','far-contact-review']:
        f=base/folder/'labels.json'; data=read(f)
        archive.append({'name':folder,'sha256':sha(f),'payload':data})
        labels=list(data['labels'].values()) if 'labels' in data else [data['label']]
        for label in labels: annotations.setdefault(label['point_id'],[]).append({'batch':folder,'sha256':sha(f),'label':label})
    result=[]
    causes={'long','wide','net','missed_return','double_bounce','serve_fault','edge','continuing','unsure'}
    for slug,name in names.items():
        path=private/f'out/{slug}.truth.json';truth=read(path);match=read(private/f'corpus/{slug}.json')['match'];meta=read(private/f'evidence/{slug}/match.json')
        for row in truth['rows']:
            if row['id'] not in identities: continue
            ident=identities[row['id']];assert ident['slug']==slug and ident['display_number']==row['display_number']
            old=annotations.get(row['id'],[])
            for a in old: assert a['label']['version']==truth['version'] and a['label']['match_id']==match['id']
            explicit=[a for a in old if a['label'].get('cause')]
            label={'reason':None,'custom':'','note':'\n\n'.join(a['label']['notes'].strip() for a in old if a['label'].get('notes','').strip())}
            if explicit:
                l=explicit[-1]['label'];cause=l['cause'];assert cause in causes|{'other'}
                label['reason']='custom' if cause=='other' else cause
                if cause=='other': label['custom']='Other reason'
            # A literal owner note states the cause, with provenance retained.
            if row['id']=='2e6cd5b5-f732-4e95-9efd-5e349198a0fa' and old:
                assert 'hit the net' in label['note'];label['reason']='net'
            offset=clocks[slug]['raw_offset_s'];tap=row['score_tap_source']
            start=max(0,row['t0']-1.0);end=min(meta['source']['duration'],max(row['t1']+1.0,(tap or row['t1'])+1.0))
            assert start<end and (tap is None or start<=tap<=end)
            source={'matchName':name,'slug':slug,'number':row['display_number'],'game':row['game'],'scoreBefore':row['score_before'],'winner':'Adil' if row['confirmed_winner']=='user' else name.split(' · ')[0], 'server':('Adil' if row['resolved_server']=='user' else name.split(' · ')[0]) if row['resolved_server'] else None, 'start':start+offset,'end':end+offset,'tap':tap+offset if tap is not None else None,'fps':meta['source']['fps'],'rawOffset':offset,'sourceHash':sha(path),'imported':label['reason'] is not None}
            result.append({'id':row['id'],'match_id':match['id'],'processing_version_id':truth['version'],'sequence':len(result)+1,'source':source,'media_path':match['raw_path'],'original_annotations':old,'label':label})
    assert len(result)==479 and {r['id'] for r in result}==set(identities)
    assert sum(len(a['payload'].get('labels',{})) or 1 for a in archive)==40
    return result,archive

def main():
    parser=argparse.ArgumentParser();parser.add_argument('base',type=pathlib.Path);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    rows,archive=prepare(args.base)
    output={'points':len(rows),'matches':dict(Counter(r['source']['slug'] for r in rows)),'imported_causes':dict(Counter(r['label']['reason'] for r in rows if r['label']['reason'])),'archived_batches':len(archive),'owner_annotations':40}
    (args.base/'out-ball-private/point-ending-seed.json').write_text(json.dumps({'rows':rows,'archive':archive},indent=2))
    if args.apply:
        import psycopg2
        from psycopg2.extras import Json
        url=subprocess.check_output(['security','find-generic-password','-a','openclaw','-s','ponglens-db-url','-w'],stderr=subprocess.DEVNULL).decode().strip()
        migration=pathlib.Path(__file__).resolve().parents[2]/'supabase/migrations/20260918220000_point_ending_labels.sql'
        with psycopg2.connect(url) as conn:
            with conn.cursor() as q:
                q.execute("select to_regclass('public.point_ending_research')")
                if q.fetchone()[0] is None:
                    q.execute(migration.read_text())
                    q.execute('insert into supabase_migrations.schema_migrations(version,name,statements) values(%s,%s,%s)',('20260918220000','point_ending_labels',[migration.read_text()]))
                for a in archive:
                    q.execute('insert into point_ending_imports(sha256,name,payload) values(%s,%s,%s) on conflict do nothing',(a['sha256'],a['name'],Json(a['payload'])))
                for r in rows:
                    q.execute('select raw_path,active_processing_version_id from matches where id=%s',(r['match_id'],));live=q.fetchone()
                    assert live==(r['media_path'],r['processing_version_id']), 'Source changed; do not silently rebind research'
                    q.execute('insert into point_ending_research(id,match_id,processing_version_id,sequence,source,media_path,original_annotations,label) values(%s,%s,%s,%s,%s,%s,%s,%s) on conflict do nothing',(r['id'],r['match_id'],r['processing_version_id'],r['sequence'],Json(r['source']),r['media_path'],Json(r['original_annotations']),Json(r['label'])))
                    q.execute('select source,media_path,original_annotations from point_ending_research where id=%s',(r['id'],));assert q.fetchone()==(r['source'],r['media_path'],r['original_annotations'])
                q.execute("select count(*) from point_ending_research where batch='out-ball-479-v1'");assert q.fetchone()[0]==479
        output['applied']=True
    print(json.dumps(output,indent=2))
if __name__=='__main__': main()
