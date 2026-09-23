#!/usr/bin/env python3
"""Import immutable review suggestions; default transaction always rolls back.

No human labels, revisions or history are written. --apply explicitly commits.
Credential access occurs only when main opens the requested database transaction.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import uuid

RUN_ID='contact-review-20260922-v1'
MIGRATION_VERSION='20260922233000'
MIGRATION_NAME='point_ending_suggestions'
REASONS={'long','wide','net','missed_return','double_bounce','serve_fault','edge','continuing','unsure'}
KINDS={'table','serve','rally','paddle','floor','net_clip','net_bounce','non_rally','other_table','ball_handling','ceiling','other_non_bounce','non_playing'}
RALLY={'table','serve','rally'}
DEFAULT_MIGRATION=Path(__file__).resolve().parents[2]/'supabase/migrations/20260922233000_point_ending_suggestions.sql'


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)


def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def source_digest(source,evidence): return digest(dict(source=source,evidence=evidence))


def nonempty(value):
    if value is None: return False
    if isinstance(value,(str,list,dict)): return len(value)>0
    return True


def touched(row):
    """Even an answer subsequently cleared by a person protects the whole point."""
    if row.get('revision',0)!=0 or row.get('reviewed_at') is not None: return True
    if nonempty(row.get('original_annotations')): return True
    if (row.get('source') or {}).get('imported') is True: return True
    label=row.get('label')
    if not isinstance(label,dict): return True
    for key,value in label.items():
        if key=='bounceReview' and isinstance(value,dict):
            if any(nonempty(v) for k,v in value.items() if k!='version'): return True
        elif nonempty(value): return True
    return False


def validate_payload(p,count):
    def fail(): raise ValueError('Invalid machine suggestion payload')
    if not isinstance(p,dict) or set(p)!={'version','runId','reason','lastRallyContact','lastBounce','events'}: fail()
    if type(p['version']) is not int or p['version']!=1 or p['runId']!=RUN_ID or not 0<=count<=200: fail()
    for field in ['reason','lastRallyContact','lastBounce']:
        g=p[field]
        if not isinstance(g,dict) or set(g)!={'value','confidence','detail'}: fail()
    if p['reason']['value'] is not None and p['reason']['value'] not in REASONS: fail()
    if p['lastRallyContact']['value'] not in [None,'near','far']: fail()
    events=p['events']
    if not isinstance(events,list) or len(events)!=count: fail()
    ids=[f'detected:{i}' for i in range(count)]
    for index,e in enumerate(events):
        if not isinstance(e,dict) or set(e)!={'id','kind','side','confidence','detail'}: fail()
        if e['id']!=ids[index] or e['kind'] not in KINDS|{None} or e['side'] not in [None,'near','far']: fail()
        if e['kind'] is None and e['side'] is not None: fail()
    last=p['lastBounce']['value']
    if last is not None and (last not in ids or events[ids.index(last)]['kind'] not in RALLY): fail()
    for g in [p['reason'],p['lastRallyContact'],p['lastBounce']]+events:
        value=g.get('value',g.get('kind'))
        if g['confidence'] not in ['tentative','uncertain'] or not isinstance(g['detail'],str) or len(g['detail'])>240: fail()
        if value is None and g['confidence']!='uncertain': fail()
    canonical(p)


def validate_bundle(snapshot,predictions):
    if not isinstance(snapshot,dict) or not isinstance(snapshot.get('rows'),list) or not isinstance(snapshot.get('evidence'),dict):
        raise ValueError('Invalid frozen snapshot')
    if not isinstance(predictions,list): raise ValueError('Invalid predictions array')
    rows={}
    for row in snapshot['rows']:
        point_id=row['id']
        if not isinstance(point_id,str) or str(uuid.UUID(point_id))!=point_id or point_id in rows:
            raise ValueError('Invalid or duplicate snapshot point')
        if not isinstance(row.get('source'),dict) or type(row.get('revision')) is not int or row['revision']<0:
            raise ValueError('Invalid frozen source or revision')
        rows[point_id]=row
    seen=set()
    for prediction in predictions:
        if not isinstance(prediction,dict) or set(prediction)!={'point_id','payload'}: raise ValueError('Invalid prediction record')
        point_id=prediction['point_id']
        if point_id not in rows or point_id in seen: raise ValueError('Unknown or duplicate prediction point')
        evidence=snapshot['evidence'].get(point_id)
        if not isinstance(evidence,dict) or not isinstance(evidence.get('bounces'),list): raise ValueError('Missing frozen evidence')
        validate_payload(prediction['payload'],len(evidence['bounces']));seen.add(point_id)
    if seen!=set(rows): raise ValueError('Predictions must cover the entire frozen snapshot')
    return rows


def validate_live(live,evidence,frozen,frozen_evidence):
    if live['id']!=frozen['id'] or live['source']!=frozen['source']: raise ValueError('Live source differs from frozen source')
    if evidence!=frozen_evidence: raise ValueError('Live evidence differs from frozen evidence')


def validate_existing(existing,payload,source_sha256,source_revision):
    if existing['payload']!=payload or existing['source_sha256']!=source_sha256 or existing['source_revision']!=source_revision:
        raise ValueError('Existing immutable prediction conflicts with this import')


def validate_migration_registration(registration,ddl):
    if registration is None or registration[0]!=MIGRATION_NAME or registration[1]!=[ddl]:
        raise ValueError('Migration registration missing or differs from reviewed DDL')


def plan_import(frozen,predictions,live,evidence,existing):
    """Validate the entire eligible batch before returning any rows to insert."""
    inserts=[];expected={}
    counts=dict(eligible=0,skipped_touched=0,inserted=0,already_present=0)
    for prediction in predictions:
        point_id=prediction['point_id'];row=live[point_id]
        if touched(row) or touched(frozen[point_id]):
            counts['skipped_touched']+=1;continue
        counts['eligible']+=1
        record=dict(payload=prediction['payload'],source_sha256=source_digest(row['source'],evidence[point_id]),source_revision=row['revision'])
        expected[point_id]=record
        if point_id in existing:
            validate_existing(existing[point_id],record['payload'],record['source_sha256'],record['source_revision'])
            counts['already_present']+=1
        else:
            inserts.append((point_id,record))
    return inserts,expected,counts


def suggestion_rows(q):
    q.execute('select point_id::text,payload,source_sha256,source_revision from public.point_ending_suggestions where run_id=%s order by point_id for update',(RUN_ID,))
    return {r[0]:dict(payload=r[1],source_sha256=r[2],source_revision=r[3]) for r in q.fetchall()}


def point_rows(q):
    q.execute('select to_jsonb(r) from public.point_ending_research r order by id for update')
    return [r[0] for r in q.fetchall()]


def history_rows(q):
    q.execute('select to_jsonb(h) from public.point_ending_label_history h order by point_id,revision')
    return [r[0] for r in q.fetchall()]


def import_transaction(conn,snapshot,predictions,migration):
    """Caller alone owns commit/rollback; this function never commits."""
    from psycopg2.extras import Json,execute_values
    frozen=validate_bundle(snapshot,predictions)
    ddl=migration.read_text()
    counts=dict(points=len(predictions),eligible=0,skipped_touched=0,inserted=0,already_present=0,migration_created=0)
    with conn.cursor() as q:
        q.execute("set local lock_timeout='15s'")
        q.execute("set local statement_timeout='60s'")
        # Serialize importers and prevent inserts/deletes, too. The subsequent
        # FOR UPDATE obtains fresh rows after any existing annotation finishes.
        q.execute('lock table public.point_ending_research in share row exclusive mode')
        q.execute('lock table public.point_ending_evidence, public.point_ending_label_history in share mode')
        before=point_rows(q);before_history=history_rows(q)
        before_digest=digest(before);before_history_digest=digest(before_history)
        live={r['id']:r for r in before}
        q.execute('select point_id::text,payload from public.point_ending_evidence order by point_id for share')
        evidence=dict(q.fetchall())
        for point_id,row in frozen.items():
            if point_id not in live or point_id not in evidence: raise ValueError('Frozen point missing from live corpus')
            validate_live(live[point_id],evidence[point_id],row,snapshot['evidence'][point_id])
        q.execute("select to_regclass('public.point_ending_suggestions')")
        table_exists=q.fetchone()[0] is not None
        q.execute('select name,statements from supabase_migrations.schema_migrations where version=%s for update',(MIGRATION_VERSION,))
        registration=q.fetchone()
        if not table_exists:
            if registration is not None: raise ValueError('Migration registered but suggestion table missing')
            q.execute(ddl)
            q.execute('insert into supabase_migrations.schema_migrations(version,name,statements) values(%s,%s,%s)',
                      (MIGRATION_VERSION,MIGRATION_NAME,[ddl]))
            counts['migration_created']=1
        else:
            validate_migration_registration(registration,ddl)
        q.execute('lock table public.point_ending_suggestions in share row exclusive mode')
        inserts,expected,batch_counts=plan_import(frozen,predictions,live,evidence,suggestion_rows(q))
        counts.update(batch_counts)
        if inserts:
            execute_values(q,'insert into public.point_ending_suggestions(point_id,run_id,payload,source_revision,source_sha256) values %s',
                           [(point_id,RUN_ID,Json(r['payload']),r['source_revision'],r['source_sha256']) for point_id,r in inserts],page_size=500)
        persisted=suggestion_rows(q)
        for point_id,record in expected.items():
            if point_id not in persisted: raise ValueError('Inserted prediction missing')
            validate_existing(persisted[point_id],record['payload'],record['source_sha256'],record['source_revision'])
        counts['inserted']=len(inserts)
        # Compare every column of every research/history row under the same
        # locks, not only the eligible subset or a history row count.
        if digest(point_rows(q))!=before_digest or digest(history_rows(q))!=before_history_digest:
            raise ValueError('Research labels, revisions or history changed during import')
        q.execute('select point_id::text,payload from public.point_ending_evidence order by point_id for share')
        if dict(q.fetchall())!=evidence: raise ValueError('Evidence changed during import')
    return counts


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',type=Path,required=True)
    parser.add_argument('--predictions',type=Path,required=True)
    parser.add_argument('--migration',type=Path,default=DEFAULT_MIGRATION)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args();conn=None
    try:
        snapshot=json.loads(args.snapshot.read_text());predictions=json.loads(args.predictions.read_text())
        validate_bundle(snapshot,predictions)
        # Read credentials only after local validation, never echo subprocess
        # stderr, connection arguments or exception text containing a DSN.
        credential=subprocess.run(['security','find-generic-password','-a','openclaw','-s','ponglens-db-url','-w'],
                                  capture_output=True,check=True,text=True).stdout.strip()
        if not credential: raise ValueError('Database credential unavailable')
        import psycopg2
        conn=psycopg2.connect(credential,connect_timeout=15)
        conn.autocommit=False
        counts=import_transaction(conn,snapshot,predictions,args.migration)
        if args.apply: conn.commit()
        else: conn.rollback()
        counts.update(committed=int(args.apply),rolled_back=int(not args.apply))
        print(json.dumps(counts,sort_keys=True))
    except Exception:
        if conn is not None:
            try: conn.rollback()
            except Exception: pass
        print('Import failed; transaction not intentionally committed. Details suppressed to protect private connection data.',file=sys.stderr)
        return 1
    finally:
        if conn is not None: conn.close()
    return 0

if __name__=='__main__':sys.exit(main())
