"""Refresh a local manifest from the private review page without touching media."""
import argparse
import json
import subprocess
from pathlib import Path
import psycopg2
from worker.active_ball_data import validate_dataset


def main():
    parser=argparse.ArgumentParser();parser.add_argument('manifest',type=Path);args=parser.parse_args()
    rows=json.loads(args.manifest.read_text())
    url=subprocess.run(['security','find-generic-password','-a','openclaw','-s','ponglens-db-url','-w'],capture_output=True,text=True,check=True).stdout.strip()
    with psycopg2.connect(url) as connection:
        connection.set_session(readonly=True)
        with connection.cursor() as cursor:
            cursor.execute('select id,label,revision,reviewed_by,reviewed_at from public.active_ball_samples')
            saved={str(r[0]):r for r in cursor.fetchall()}
    for row in rows:
        entry=saved.get(row['id'])
        if entry is None:raise ValueError('sample is no longer available in research storage')
        _,label,revision,reviewer,reviewed_at=entry
        row['label']=None if label is None else {**label,'provenance':'human','reviewed_by':str(reviewer),'reviewed_at':str(reviewed_at),'revision':revision}
    validate_dataset(rows)
    temporary=args.manifest.with_suffix('.tmp.json');temporary.write_text(json.dumps(rows,indent=2));temporary.replace(args.manifest)
    print(json.dumps({split:sum(r['split']==split and r['label'] is not None and r['label']['state']!='unsure' for r in rows) for split in ('train','validation','test')}))


if __name__=='__main__':main()
