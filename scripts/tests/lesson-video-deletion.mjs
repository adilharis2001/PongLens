// Isolated PostgreSQL-WASM checks. PGLITE_MODULE points at a disposable install;
// this script cannot access hosted credentials or a production database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
try {
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table public.coach_students(id uuid primary key,coach_id uuid,archived_at timestamptz);
 create table public.lessons(id uuid primary key default gen_random_uuid(),user_id uuid,transcript text,takeaways jsonb,status text,kind text);
 create table public.coach_entries(id uuid primary key default gen_random_uuid(),coach_id uuid,student_id uuid,lesson_id uuid unique,shared_at timestamptz);
 create table public.storage_ledger(user_id uuid,kind text,bytes bigint,r2_key text);
 `);
 for (const name of ['173_lesson_video.sql','174_lesson_video_import_identity.sql','175_lesson_video_storage.sql','177_lesson_video_account_deletion.sql'])
  await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 const owner='11111111-1111-1111-1111-111111111111', video='22222222-2222-2222-2222-222222222222';
 await db.query('insert into auth.users values($1)',[owner]);
 await db.query("insert into lesson_videos(id,owner_id,original_name,file_size,duration_s,source_key,status,upload_id) values($1,$2,'test.mov',10,5400,'test-original','queued','multipart')",[video,owner]);
 await db.exec("insert into lesson_video_release(release_id,enabled) values('test-release',true)");
 const claim=await db.query("select * from claim_lesson_video('test-release','test-worker',false)");
 assert.equal(claim.rows.length,1);assert.ok(claim.rows[0].lease_token);
 const fence=await db.query('select * from begin_lesson_video_account_deletion($1)',[owner]);
 assert.deepEqual(fence.rows,[{source_key:'test-original',upload_id:'multipart'}]);
 const state=(await db.query('select status,stage,lease_token,revision from lesson_videos where id=$1',[video])).rows[0];
 assert.deepEqual(state,{status:'failed',stage:'Deleting',lease_token:null,revision:2});
 await assert.rejects(db.query("insert into lesson_videos(owner_id,original_name,file_size,duration_s,source_key) values($1,'new',1,1,'blocked')",[owner]),/account is being deleted/);
 // Even a privileged stale write back to queued cannot get through the claim guard.
 await db.query("update lesson_videos set status='queued' where id=$1",[video]);
 assert.equal((await db.query("select * from claim_lesson_video('test-release','test-worker',false)")).rows.length,0);
 assert.equal((await db.query('select lesson_video_attempt_cancelled($1,$2) as cancelled',[owner,video])).rows[0].cancelled,true);
 await db.query('select ack_lesson_video_deletion_sweep($1)',[owner]);
 assert.equal((await db.query('select * from lesson_video_deletions')).rows.length,1);
 await db.query('delete from auth.users where id=$1',[owner]);
 assert.equal((await db.query('select * from lesson_video_deletions')).rows.length,1,'marker survives auth cascade');
 await db.query('select ack_lesson_video_deletion_sweep($1)',[owner]);
 const marker=(await db.query('select * from lesson_video_deletions')).rows[0];
 assert.ok(marker.account_gone_at);assert.equal(marker.sweep_count,2);
 await db.query("update lesson_video_deletions set account_gone_at=now()-interval '25 hours',last_swept_at=now()-interval '6 minutes'");
 assert.equal((await db.query('select * from lesson_video_deletion_targets()')).rows.length,1);
 await db.query('select ack_lesson_video_deletion_sweep($1)',[owner]);
 assert.equal((await db.query('select * from lesson_video_deletions')).rows.length,0,'retires only after final sweep beyond 24h');
 assert.equal((await db.query('select lesson_video_attempt_cancelled($1,$2) as cancelled',[owner,video])).rows[0].cancelled,true,'late worker still sees absent owner after marker retirement');
 const grants=await db.query("select has_function_privilege('authenticated','begin_lesson_video_account_deletion(uuid)','execute') as user_can_call,has_function_privilege('service_role','begin_lesson_video_account_deletion(uuid)','execute') as service_can_call");
 assert.deepEqual(grants.rows[0],{user_can_call:false,service_can_call:true});
 console.log('Lesson deletion SQL: migration, fencing, blocked create/claim, private grants and durable 24h retirement passed.');
} finally { await db.close(); }
