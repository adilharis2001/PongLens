"""Contract tests in a new disposable loopback database, never production."""
import json
from pathlib import Path
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
import psycopg2
from psycopg2 import sql

ROOT = Path(__file__).resolve().parents[2]
OWNER = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
MATCH = '33333333-3333-4333-8333-333333333333'
KEY = '44444444-4444-4444-8444-444444444444'
JOB = '55555555-5555-4555-8555-555555555555'

class RequestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = 'upload_request_test_' + uuid.uuid4().hex[:10]
        base = 'postgresql://postgres:postgres@127.0.0.1:55322/'
        admin = psycopg2.connect(base + 'postgres'); admin.autocommit = True
        with admin.cursor() as cur: cur.execute(sql.SQL('create database {}').format(sql.Identifier(cls.db)))
        admin.close()
        cls.conn = psycopg2.connect(base + cls.db); cls.conn.autocommit = True
        with cls.conn.cursor() as cur:
            cur.execute('''create schema auth;
              create function auth.uid() returns uuid language sql stable as
                $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
              create table auth.users(id uuid primary key);
              create table public.matches(id uuid primary key,user_id uuid);
              create table public.jobs(id uuid primary key,user_id uuid,kind text,status text);
              create table public.processing_estimate_cache(job_id uuid,lane text,estimate jsonb,expires_at timestamptz);
              create function public.processing_lane_status(text) returns text language sql as $$select 'available'::text$$;
              create table public.test_claims(id serial primary key, match_id uuid);
              create function public.claim_processing(uuid,double precision,double precision,boolean,boolean,text,uuid,uuid default null)
                returns jsonb language plpgsql as $$begin
                if $5 then raise exception 'insufficient_minutes'; end if;
                insert into public.test_claims(match_id) values($1);
                perform pg_sleep(0.05);
                return jsonb_build_object('job_id','55555555-5555-4555-8555-555555555555','charged_minutes',18);
                end$$;
              grant usage on schema public,auth to authenticated,anon;
            ''')
            migration = ROOT/'supabase/migrations/20260913120000_upload_processing_requests.sql'
            if migration.exists(): cur.execute(migration.read_text())
        print('Test database:', cls.db)
    @classmethod
    def tearDownClass(cls): cls.conn.close()
    def setUp(self):
        self.conn.autocommit = False
        with self.conn.cursor() as cur:
            cur.execute('insert into auth.users values(%s),(%s)', (OWNER,OTHER))
            cur.execute('insert into public.matches values(%s,%s)', (MATCH,OWNER))
            cur.execute("select set_config('request.jwt.claim.sub',%s,true)", (OWNER,))
    def tearDown(self):
        self.conn.rollback(); self.conn.autocommit = True
        with self.conn.cursor() as cur:
            cur.execute('truncate public.test_claims,public.matches,auth.users,public.jobs,public.processing_estimate_cache cascade')
    def claim(self, key=KEY, placement=False):
        with self.conn.cursor() as cur:
            cur.execute("select public.claim_upload_processing(%s,%s,0,1065,true,%s,'normal',null)", (key,MATCH,placement))
            return cur.fetchone()[0]
    def test_lost_reply_and_later_retry_claim_once(self):
        first=self.claim(); self.conn.commit()
        with psycopg2.connect('postgresql://postgres:postgres@127.0.0.1:55322/'+self.db) as other:
            with other.cursor() as cur:
                cur.execute("select set_config('request.jwt.claim.sub',%s,true)",(OWNER,))
                cur.execute("select public.claim_upload_processing(%s,%s,0,1065,true,false,'normal',null)",(KEY,MATCH))
                second=cur.fetchone()[0]
        self.assertEqual(first,second)
        with self.conn.cursor() as cur:
            cur.execute('select count(*) from public.test_claims')
            self.assertEqual(cur.fetchone()[0],1)
    def test_concurrent_duplicate_requests_claim_once(self):
        self.conn.commit()
        def call(_):
            with psycopg2.connect('postgresql://postgres:postgres@127.0.0.1:55322/'+self.db) as other:
                with other.cursor() as cur:
                    cur.execute("select set_config('request.jwt.claim.sub',%s,true)",(OWNER,))
                    cur.execute("select public.claim_upload_processing(%s,%s,0,1065,true,false,'normal',null)",(KEY,MATCH))
                    return cur.fetchone()[0]
        with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(call,range(2)))
        self.assertEqual(results[0],results[1])
        with self.conn.cursor() as cur:
            cur.execute('select count(*) from public.test_claims')
            self.assertEqual(cur.fetchone()[0],1)
    def test_refusal_does_not_consume_request_key(self):
        with self.conn.cursor() as cur: cur.execute('savepoint refused')
        with self.assertRaises(psycopg2.Error): self.claim(placement=True)
        with self.conn.cursor() as cur:
            cur.execute('rollback to savepoint refused')
            cur.execute('select count(*) from public.upload_processing_requests')
            self.assertEqual(cur.fetchone()[0],0)
        self.assertEqual(self.claim()['job_id'],JOB)
    def test_key_cannot_change_the_spending_request(self):
        self.claim()
        with self.assertRaises(psycopg2.Error): self.claim(placement=True)
    def test_nonowner_cannot_claim_or_retrieve(self):
        self.claim()
        with self.conn.cursor() as cur: cur.execute("select set_config('request.jwt.claim.sub',%s,true)",(OTHER,))
        with self.assertRaises(psycopg2.Error): self.claim()
    def test_private_receipts_and_no_anonymous_execute(self):
        with self.conn.cursor() as cur:
            cur.execute("select has_table_privilege('authenticated','public.upload_processing_requests','SELECT'),has_function_privilege('anon','public.claim_upload_processing(uuid,uuid,double precision,double precision,boolean,boolean,text,uuid)','EXECUTE')")
            self.assertEqual(cur.fetchone(),(False,False))
    def test_only_whole_match_estimates_escape(self):
        with self.conn.cursor() as cur:
            cur.execute("insert into public.jobs values(%s,%s,'content_check','queued')",(JOB,OWNER))
            cur.execute("insert into public.processing_estimate_cache values(%s,'main',jsonb_build_object('state','range','ready_latest_at',now()+interval '45 seconds'),now()+interval '90 seconds')",(JOB,))
            cur.execute('select public._fresh_processing_estimate(%s)',(JOB,))
            self.assertIsNone(cur.fetchone()[0])
            cur.execute("update public.jobs set kind='deadspace_cut'")
            cur.execute('select public._fresh_processing_estimate(%s)',(JOB,))
            self.assertEqual(cur.fetchone()[0]['ready_scope'],'match')
            cur.execute("update public.processing_estimate_cache set estimate=jsonb_build_object('state','queue_only')")
            cur.execute('select public._fresh_processing_estimate(%s)',(JOB,))
            self.assertIsNone(cur.fetchone()[0])

if __name__=='__main__': unittest.main()
