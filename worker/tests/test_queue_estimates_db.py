"""Real PostgreSQL contract tests, exclusively in a newly created test DB.

Run with PONGLENS_TEST_DATABASE_URL pointing at loopback port 55322/postgres.
No existing database's schema or rows are mutated; the new database is kept
for inspection, with its generated name printed at the end of setup.
"""
import json
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse
import uuid

import psycopg2
from psycopg2 import sql

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'worker'))
OWNER='11111111-1111-4111-8111-111111111111'
OTHER='22222222-2222-4222-8222-222222222222'
JOB='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
MATCH='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'


class QueueEstimateDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        migration=ROOT/'supabase/migrations/20260913062000_processing_estimates.sql'
        if not migration.exists():
            raise AssertionError('The estimate migration has not been implemented')
        url=os.environ.get('PONGLENS_TEST_DATABASE_URL','postgresql://postgres:postgres@127.0.0.1:55322/postgres')
        parsed=urlparse(url)
        if parsed.hostname not in ('127.0.0.1','localhost','::1') or parsed.port!=55322 or parsed.path!='/postgres':
            raise RuntimeError('Requires designated local Supabase 55322/postgres; creates a new database only')
        admin=psycopg2.connect(url,connect_timeout=5); admin.autocommit=True
        cls.database='queue_estimates_test_'+uuid.uuid4().hex[:12]
        with admin.cursor() as cur:
            cur.execute(sql.SQL('create database {}').format(sql.Identifier(cls.database)))
        admin.close()
        cls.conn=psycopg2.connect(url.rsplit('/',1)[0]+'/'+cls.database,connect_timeout=5)
        cls.conn.autocommit=True
        with cls.conn.cursor() as cur:
            cur.execute('''create schema auth;
              create function auth.uid() returns uuid language sql stable as
                $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
              create function public.is_admin() returns boolean language sql stable as
                $$select coalesce(current_setting('request.jwt.claim.admin',true),'')='true'$$;
              grant usage on schema public,auth to anon,authenticated,service_role;
              create table public.jobs(id uuid primary key,user_id uuid not null,kind text not null,
                status text not null default 'queued', options jsonb default '{}',updated_at timestamptz default now(),
                created_at timestamptz default now(),user_message text,
                source_duration_s double precision,source_fps double precision,source_metadata_verified_at timestamptz);
              create table public.matches(id uuid primary key,user_id uuid not null,job_id uuid references public.jobs,
                status text default 'processing');
              create table public.app_config(key text primary key,value text);
              create table public.processing_ledger(job_id uuid,kind text);
              create table public.worker_pulse(worker_id text primary key,host text,lane text,beat_at timestamptz,
                job_id uuid,stage text);
              create schema pgmq;
              create table pgmq.q_jobs(msg_id bigint primary key,read_ct integer,vt timestamptz,enqueued_at timestamptz,message jsonb);
              create table pgmq.q_jobs_fast(like pgmq.q_jobs including all);
              create table pgmq.q_jobs_hand(like pgmq.q_jobs including all);
            ''')
            for name in ('20260912220000_upload_processing_feedback.sql','20260913060000_processing_availability.sql','20260913062000_processing_estimates.sql'):
                path=ROOT/'supabase/migrations'/name
                if not path.exists():
                    path=ROOT.parent/'processing-availability/supabase/migrations'/name
                cur.execute(path.read_text())
        print('Isolated database:',cls.database)

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.conn.autocommit=False
        with self.conn.cursor() as cur:
            cur.execute("insert into public.app_config values('points_pipeline','bodies')")
            cur.execute("insert into public.jobs(id,user_id,kind,options,source_duration_s,source_fps,source_metadata_verified_at) values(%s,%s,'deadspace_cut','{\"points\":true}',100,30,now())",(JOB,OWNER))
            cur.execute("insert into public.matches(id,user_id,job_id) values(%s,%s,%s)",(MATCH,OWNER,JOB))
            cur.execute("insert into public.worker_pulse values('mac:main','mac','main',now(),null,'idle')")
            cur.execute("insert into pgmq.q_jobs values(1,0,now(),now(),%s::jsonb)",(json.dumps({'job_id':JOB}),))
        self.conn.commit()

    def tearDown(self):
        self.conn.rollback(); self.conn.autocommit=True
        with self.conn.cursor() as cur:
            cur.execute('reset role')
            cur.execute("select set_config('request.jwt.claim.admin','',false),set_config('request.jwt.claim.sub','',false)")
            cur.execute('truncate public.processing_estimate_cache,public.matches,public.jobs,public.app_config,public.worker_pulse,public.match_processing_events,public.processing_ledger,pgmq.q_jobs,pgmq.q_jobs_fast,pgmq.q_jobs_hand cascade')

    def query(self,query,args=()):
        with self.conn.cursor() as cur:
            cur.execute(query,args)
            return cur.fetchone()[0] if cur.description else None

    def role(self,name,user=OWNER,admin=False):
        self.query('reset role')
        self.query("select set_config('request.jwt.claim.sub',%s,false)",(user,))
        self.query("select set_config('request.jwt.claim.admin',%s,false)",('true' if admin else '',))
        self.query(sql.SQL('set role {}').format(sql.Identifier(name)))

    def refresh(self):
        from queue_estimates import refresh
        refresh(self.conn)

    def test_snapshot_refresh_owner_privacy_and_preserves_twelve_fields(self):
        before=self.query('select updated_at from public.jobs where id=%s',(JOB,))
        self.refresh()
        self.assertEqual(self.query('select updated_at from public.jobs where id=%s',(JOB,)),before)
        self.role('authenticated')
        result=self.query('select public.my_match_processing_feedback(array[%s]::uuid[])',(MATCH,))
        self.assertEqual(len(result[0]),13)
        self.assertEqual(result[0]['estimate']['state'],'range')
        self.assertEqual(set(result[0]['estimate']),{'state','observed_at','expires_at','basis','reason','start_earliest_at','start_latest_at','ready_earliest_at','ready_latest_at'})
        self.role('authenticated',OTHER)
        self.assertEqual(self.query('select public.my_processing_estimates(array[%s]::uuid[])',(JOB,)),[])
        self.assertEqual(self.query('select public.my_match_processing_feedback(array[%s]::uuid[])',(MATCH,)),[])

    def test_anonymous_private_and_non_admin_calls_denied(self):
        for role,query in [('anon','select public.my_processing_estimates(array[]::uuid[])'),
            ('authenticated','select public.processing_estimate_snapshot()'),
            ('authenticated','select * from public.processing_estimate_cache'),
            ('authenticated','select public._my_match_processing_feedback_before_estimates(array[]::uuid[])'),
            ('authenticated','select public.admin_processing_estimates(array[]::uuid[])')]:
            self.role(role)
            with self.assertRaises(psycopg2.errors.InsufficientPrivilege): self.query(query)
            self.conn.rollback()

    def test_service_snapshot_and_admin_owner_bypass_are_explicit(self):
        self.role('service_role')
        snap=self.query('select public.processing_estimate_snapshot()')
        self.assertEqual(snap['lanes'][0]['messages'][0]['msg_id'],1)
        self.role('postgres'); self.refresh()
        self.role('authenticated',OTHER,True)
        self.assertEqual(len(self.query('select public.admin_processing_estimates(array[%s]::uuid[])',(JOB,))),1)

    def test_expiry_and_availability_checked_at_read_time(self):
        self.refresh()
        self.query("update public.processing_estimate_cache set expires_at=now()-interval '1 second'")
        self.role('authenticated')
        self.assertIsNone(self.query('select public.my_processing_estimates(array[%s]::uuid[])',(JOB,))[0]['estimate'])
        self.role('postgres'); self.conn.commit(); self.refresh()
        self.query("update public.worker_pulse set stage='drained'")
        self.role('authenticated')
        result=self.query('select public.my_processing_estimates(array[%s]::uuid[])',(JOB,))[0]['estimate']
        self.assertEqual(result['state'],'unknown')
        self.assertIsNone(result['ready_latest_at'])

    def test_inputs_limited_100_snapshot_overflow_and_source_profile(self):
        self.query("insert into public.jobs(id,user_id,kind,options) select md5(i::text)::uuid,%s,'deadspace_cut','{\"points\":true}' from generate_series(1,257)i",(OWNER,))
        self.query("insert into pgmq.q_jobs select i+1,0,now(),now(),jsonb_build_object('job_id',md5(i::text)::uuid) from generate_series(1,257)i")
        snap=self.query('select public.processing_estimate_snapshot()')
        self.assertTrue(snap['lanes'][0]['overflow'])
        self.assertEqual(len(snap['lanes'][0]['messages']),256)
        self.role('authenticated')
        result=self.query('select public.my_processing_estimates(array(select md5(i::text)::uuid from generate_series(1,257)i))')
        self.assertEqual(len(result),100)

    def test_latest_attempt_profile_and_completed_check_supply_metadata(self):
        self.query('update public.jobs set source_metadata_verified_at=null')
        check='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        self.query("insert into public.jobs(id,user_id,kind,status,options) values(%s,%s,'content_check','done',jsonb_build_object('match_id',%s))",(check,OWNER,MATCH))
        self.query("insert into public.match_processing_events(attempt_key,job_id,attempt,lane,event,recorded_at,details) values(%s,%s,1,'main','profile',now(),'{\"duration_s\":400,\"fps\":30,\"route\":\"content_check\"}')",(check+':1',check))
        self.query("update public.jobs set options=options||jsonb_build_object('match_id',%s) where id=%s",(MATCH,JOB))
        self.refresh()
        self.role('authenticated')
        self.assertEqual(self.query('select public.my_processing_estimates(array[%s]::uuid[])',(JOB,))[0]['estimate']['state'],'range')

    def test_latest_attempt_excludes_old_profile_and_old_release_receipt(self):
        for attempt,event,details in [(1,'profile',{'duration_s':9000,'fps':30,'route':'bodies:no-placement'}),
                                     (1,'released',{}),(2,'claimed',{})]:
            self.query("insert into public.match_processing_events(attempt_key,job_id,attempt,lane,event,recorded_at,details) values(%s,%s,%s,'main',%s,now(),%s::jsonb)",
                       (JOB+':'+str(attempt),JOB,attempt,event,json.dumps(details)))
        snap=self.query('select public.processing_estimate_snapshot()')
        row=snap['lanes'][0]['messages'][0]['job']
        self.assertIsNone(row['profile'])
        self.assertNotIn('released',row['events'])
        self.assertEqual(row['receipt_lane'],'main')

    def test_cache_sanitizes_extra_details_uses_server_time_and_hides_overdue(self):
        self.refresh()
        row=self.query('select estimate from public.processing_estimate_cache')
        row['filename']='private.mov'; row['user_id']=OTHER
        self.query('select public.store_processing_estimates(%s::jsonb,now())',
                   (json.dumps({JOB:{'lane':'main','estimate':row}}),))
        self.query("update public.processing_estimate_cache set estimate=estimate||jsonb_build_object('ready_latest_at',now()-interval '1 second')")
        self.role('authenticated')
        result=self.query('select public.my_processing_estimates(array[%s]::uuid[])',(JOB,))[0]['estimate']
        self.assertEqual(result['state'],'overdue')
        self.assertIsNone(result['ready_latest_at'])
        self.assertNotIn('filename',result)
        self.assertNotIn('user_id',result)

    def test_snapshot_and_cache_dates_are_utc_even_with_different_session_zone(self):
        self.query("set time zone 'Asia/Kolkata'")
        snap=self.query('select public.processing_estimate_snapshot()')
        self.assertTrue(snap['observed_at'].endswith('+00:00'))
        self.refresh()
        result=self.query('select estimate from public.processing_estimate_cache')
        self.assertTrue(result['observed_at'].endswith('+00:00'))
        self.query("set time zone 'UTC'")


if __name__=='__main__': unittest.main()
