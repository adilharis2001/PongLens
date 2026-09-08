import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MEDIA_BUCKET,createMultipartUpload,presignUploadPart,listParts,completeMultipartUpload,headObject,presignGet,abortMultipartUpload,deleteObjects,listObjects } from '@/lib/r2';
import { PART_SIZE,validateImport,validateEdit,canReadVideo,publicVideo } from '@/lib/lessonVideo/model';
import { lessonCanSetCoach } from '@/lib/lessonVideo/presentation';
import { queueLessonRender } from '@/lib/lessonVideo/queueing';
import { QUOTA_ERRORS,type StorageState } from '@/lib/quota';
export const runtime='nodejs';
export const maxDuration=60;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure=(error:string,status=400)=>NextResponse.json({error},{status});
// The signed-in client is kept alongside the admin one because two questions
// have to be asked as the user rather than as the service role: who may read
// a recap, and how much storage they have left. Both read auth.uid(), which
// the admin client does not carry.
async function context(){const client=await createClient();const {data:{user}}=await client.auth.getUser();return {user,client,db:user?createAdminClient():null};}
/**
 * The owner's question: is this recap shared right now.
 *
 * Two directions, and neither answers for the other. A coach's import is
 * shared through `coach_entries`, which they can take back from the student
 * page without the video row changing. A player's import is shared through
 * one column on their own lesson, which they can clear from the recap page.
 */
async function entryShared(db:ReturnType<typeof createAdminClient>,row:Record<string,unknown>){
 if(!row.lesson_id||row.status!=='ready')return false;
 if(row.coach_ref_id){const {data}=await db.from('lessons').select('shared_with_coach_at').eq('id',row.lesson_id).eq('user_id',row.owner_id).maybeSingle();return !!data?.shared_with_coach_at;}
 if(!row.student_id)return false;
 const {data}=await db.from('coach_entries').select('id').eq('lesson_id',row.lesson_id).not('shared_at','is',null).limit(1);
 return !!data?.length;
}
export async function GET(req:Request){
 const {user,client,db}=await context();if(!user||!db)return failure('Not signed in',401);
 const url=new URL(req.url),id=url.searchParams.get('id'),studentId=url.searchParams.get('studentId');
 try{
  if(id){
   if(!UUID.test(id))return failure('Not found',404);
   const {data:row,error}=await db.from('lesson_videos').select('*').eq('id',id).maybeSingle();
   if(error)throw error;if(!row)return failure('Not found',404);
   const owner=row.owner_id===user.id;
   // One function answers who may read a recap in both directions, so the
   // route stops asking the question its own way and drifting from the
   // database's. It reads auth.uid(), which is why it goes through the
   // signed-in client; the admin client would answer null for everybody.
   // The owner is not put through it: their own recap must not depend on a
   // round trip that can fail.
   let access:string|null='owner';
   if(!owner){const {data:granted}=await client.rpc('lesson_video_access',{p_video_id:id});access=typeof granted==='string'?granted:null;}
   if(!canReadVideo(access,row.status))return failure('Not found',404);
   const sourceUrl=owner&&row.status!=='uploading'?await presignGet(MEDIA_BUCKET,row.source_key,{expiresSeconds:14400,filename:row.original_name,disposition:'inline'}):undefined;
   // A key that is set is a file that exists. The status says what is
   // happening next, not whether there is anything to watch now, and
   // reading it as both is what made an edit look like a fresh import.
   const watchable=(owner&&!!row.summary_key)||['review','ready'].includes(row.status);
   const summaryUrl=row.summary_key&&watchable?await presignGet(MEDIA_BUCKET,row.summary_key,{expiresSeconds:14400}):undefined;
   const playbackUrl=row.playback_key&&watchable?await presignGet(MEDIA_BUCKET,row.playback_key,{expiresSeconds:14400}):summaryUrl;
   let posterUrl: string | undefined;
   if(playbackUrl&&row.playback_key){
    const posterKey=row.playback_key.replace(/\.mp4$/,'.jpg');
    try{if(await headObject(MEDIA_BUCKET,posterKey)!==null)posterUrl=await presignGet(MEDIA_BUCKET,posterKey,{expiresSeconds:14400});}catch{ /* A missing preview must not prevent playback. */ }
   }
   // Whether the other person can see it today. A ready row is not the same
   // thing: the coach can take the entry back from the student page, and a
   // player can stop sharing their own recap.
   const sharedNow=owner?await entryShared(db,row):true;
   return NextResponse.json({video:publicVideo(row,owner),isOwner:owner,shared:sharedNow,sourceUrl,summaryUrl,playbackUrl,posterUrl},{headers:{'Cache-Control':'private, no-store'}});
  }
  let q=db.from('lesson_videos').select('id,owner_id,student_id,coach_ref_id,lesson_id,original_name,file_size,duration_s,status,stage,error,edit,revision,created_at,updated_at').eq('owner_id',user.id).order('created_at',{ascending:false}).limit(100);
  if(studentId){if(!UUID.test(studentId))return failure('Invalid student');q=q.eq('student_id',studentId);}
  const {data,error}=await q;if(error)throw error;
  const videos=data??[];
  const lessonIds=videos.map(v=>v.lesson_id).filter((x):x is string=>!!x);
  const sharedIds=new Set<string>();
  if(lessonIds.length){
   const {data:entries}=await db.from('coach_entries').select('lesson_id').in('lesson_id',lessonIds).not('shared_at','is',null);entries?.forEach(e=>{if(e.lesson_id)sharedIds.add(e.lesson_id);});
   // A player's recap is shared through a column on their own lesson rather
   // than through a coach entry, so a list that read entries alone had every
   // shared recap of theirs saying "Ready to share".
   const {data:own}=await db.from('lessons').select('id').in('id',lessonIds).eq('user_id',user.id).not('shared_with_coach_at','is',null);own?.forEach(l=>{if(l.id)sharedIds.add(l.id);});
  }
  return NextResponse.json({videos:videos.map(v=>({...v,shared:v.status==='ready'&&!!v.lesson_id&&sharedIds.has(v.lesson_id)}))},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){console.error('lesson-video read failed',e);return failure('Could not load lesson videos. Try again.',500);}
}
export async function POST(req:Request){
 const {user,client,db}=await context();if(!user||!db)return failure('Not signed in',401);
 let body:Record<string,unknown>;try{body=await req.json();}catch{return failure('Invalid request');}
 const action=String(body.action??'');
 try{
  if(action==='create'){
   const fileSize=Number(body.fileSize),duration=Number(body.durationS);const invalid=validateImport(fileSize,duration);if(invalid)return failure(invalid);
   // Lower-cased on the way in. Foundation encodes a Swift UUID as its
   // uppercase `uuidString`, and Postgres hands uuid columns back in lower
   // case, so a resumed import from the phone compared its own id against
   // the row it had just created and decided they were different videos.
   // That 409s the retry, and every retry after it, leaving a 20 GB file
   // on the phone with no way to finish. Postgres itself does not care —
   // the `.eq()` filters cast to uuid — but these three string
   // comparisons do.
   const studentId=typeof body.studentId==='string'?body.studentId.toLowerCase():null;
   const coachRefId=typeof body.coachRefId==='string'?body.coachRefId.toLowerCase():null;
   // Importing is open to every player now. Being a coach only decides who a
   // lesson may be addressed TO: a coach makes one for a student on their
   // roster, a player makes one with a coach on their list, and a lesson that
   // names neither is private, which is what a coach's own private import has
   // always been. The database refuses both at once as well
   // (lesson_videos_one_direction); this says so in words the caller can read.
   if(studentId&&coachRefId)return failure('A lesson names a student or a coach, not both.');
   if(studentId){
    if(user.user_metadata?.is_coach!==true)return failure('Only a coach can make a lesson for a student.',403);
    if(!UUID.test(studentId))return failure('Invalid student');
    const {data:s}=await db.from('coach_students').select('id').eq('id',studentId).eq('coach_id',user.id).is('archived_at',null).maybeSingle();if(!s)return failure('Choose a student from your roster.',403);
   }
   // Their own list, and still live: an archived coach cannot be given a new
   // lesson, and naming somebody else's row would attribute the recording to
   // a relationship the caller is not in.
   if(coachRefId){
    if(!UUID.test(coachRefId))return failure('Choose a coach from your list.',403);
    const {data:c}=await db.from('player_coaches').select('id').eq('id',coachRefId).eq('player_id',user.id).is('archived_at',null).maybeSingle();if(!c)return failure('Choose a coach from your list.',403);
   }
   const importToken=typeof body.clientRequestId==='string'?body.clientRequestId:null;
   if(importToken&&!UUID.test(importToken))return failure('Invalid import identifier');
   if(importToken){const {data:existing}=await db.from('lesson_videos').select('*').eq('owner_id',user.id).eq('import_token',importToken).maybeSingle();if(existing){if(existing.file_size!==fileSize||existing.student_id!==studentId||existing.coach_ref_id!==coachRefId)return failure('This import belongs to a different video.',409);return NextResponse.json({id:existing.id,video:publicVideo(existing,true),partSize:PART_SIZE});}}
   // Bound unfinished imports separately from match allowances.
   const {count,error:countError}=await db.from('lesson_videos').select('id',{head:true,count:'exact'}).eq('owner_id',user.id).in('status',['uploading','queued','processing']);
   if(countError)throw countError;if((count??0)>=8)return failure('Finish an existing lesson upload before starting another.',429);
   // The original of a lesson counts against the player's storage, so refuse
   // an import that will not fit before it uploads twenty gigabytes to find
   // out. Same sentence the match upload path uses, plus a marker the page
   // can branch on to offer Request more storage rather than showing this as
   // an error. Asked with the signed-in client because my_storage_state()
   // reads auth.uid().
   //
   // A failed lookup refuses, the same way checkUploadAllowed does for a
   // match (`quotaGate.test.ts`: "a failed storage lookup cannot grant
   // upload access"). One question, two surfaces, and letting this one
   // through on an error would mean the same query decided differently
   // depending on which page asked it.
   const {data:storage,error:storageError}=await client.rpc('my_storage_state').single();
   if(storageError||!storage)return failure(QUOTA_ERRORS.unavailable,503);
   const quota=storage as StorageState;
   const remaining=Number(quota.storage_limit_bytes)-Number(quota.used_bytes);
   if(Number.isFinite(remaining)&&fileSize>remaining)return NextResponse.json({error:QUOTA_ERRORS.storage,resource:'storage'},{status:413});
   const id=crypto.randomUUID(),mime=body.contentType==='video/quicktime'?'video/quicktime':'video/mp4';
   const key=`lesson-video/${user.id}/${id}/original.${mime==='video/quicktime'?'mov':'mp4'}`;
   const uploadId=await createMultipartUpload(MEDIA_BUCKET,key,mime);
   const {data:video,error}=await db.from('lesson_videos').insert({id,owner_id:user.id,student_id:studentId,coach_ref_id:coachRefId,import_token:importToken,original_name:String(body.originalName??'Lesson.mov').slice(0,240),file_size:fileSize,duration_s:duration,source_key:key,upload_id:uploadId}).select().single();
   if(error){await abortMultipartUpload(MEDIA_BUCKET,key,uploadId);if(error.code==='23505'&&importToken){const {data:existing}=await db.from('lesson_videos').select('*').eq('owner_id',user.id).eq('import_token',importToken).single();if(existing&&existing.file_size===fileSize&&existing.student_id===studentId&&existing.coach_ref_id===coachRefId)return NextResponse.json({id:existing.id,video:publicVideo(existing,true),partSize:PART_SIZE});}throw error;}
   return NextResponse.json({id,video:publicVideo(video,true),partSize:PART_SIZE});
  }
  const id=String(body.id??'');if(!UUID.test(id))return failure('Not found',404);
  const {data:row,error:readError}=await db.from('lesson_videos').select('*').eq('id',id).eq('owner_id',user.id).maybeSingle();
  if(readError)throw readError;if(!row)return failure('Not found',404);
  if(action==='sign-part'){
   if(row.status!=='uploading')return failure('This video has already uploaded.',409);
   const n=Number(body.partNumber);if(!Number.isInteger(n)||n<1||n>Math.ceil(row.file_size/PART_SIZE))return failure('Invalid upload part');
   return NextResponse.json({url:await presignUploadPart(MEDIA_BUCKET,row.source_key,row.upload_id,n,86400)});
  }
  if(action==='list-parts'){
   if(row.status!=='uploading')return NextResponse.json({parts:[],complete:true,video:publicVideo(row,true)});
   const parts=await listParts(MEDIA_BUCKET,row.source_key,row.upload_id);
   // The object can exist if completion succeeded before the API response failed.
   if(parts===null&&await headObject(MEDIA_BUCKET,row.source_key)===row.file_size)return NextResponse.json({parts:[],complete:true});
   return NextResponse.json({parts:parts??[],gone:parts===null});
  }
  if(action==='complete'){
   if(row.status!=='uploading')return NextResponse.json({ok:true,video:publicVideo(row,true)});
   let actual=await headObject(MEDIA_BUCKET,row.source_key);
   if(actual===null){
    const parts=await listParts(MEDIA_BUCKET,row.source_key,row.upload_id);
    if(!parts)return failure('This upload expired. Import the original again.',409);
    const count=Math.ceil(row.file_size/PART_SIZE);
    if(parts.length!==count||parts.some((p,i)=>p.PartNumber!==i+1||p.Size!==Math.min(PART_SIZE,row.file_size-i*PART_SIZE)))return failure('Some video parts are missing. Resume the upload.',409);
    await completeMultipartUpload(MEDIA_BUCKET,row.source_key,row.upload_id,parts.map(p=>({partNumber:p.PartNumber,etag:p.ETag})));
    actual=await headObject(MEDIA_BUCKET,row.source_key);
   }
   if(actual!==row.file_size)return failure('The uploaded size does not match the original. Resume the upload.',409);
   const {data:video,error}=await db.rpc('complete_lesson_video',{p_id:id,p_owner:user.id,p_bytes:actual});if(error)throw error;
   return NextResponse.json({ok:true,video:publicVideo(video??row,true)});
  }
  if(action==='retry'){
   if(row.stage==='Deleting')return failure('This lesson is being deleted.',409);
   if(row.status!=='failed')return failure('This lesson is not waiting for a retry.',409);
   const {error}=await db.from('lesson_videos').update(queueLessonRender('Waiting to process',new Date().toISOString())).eq('id',id).eq('status','failed').eq('revision',row.revision).or('stage.is.null,stage.neq.Deleting');if(error)throw error;
   return NextResponse.json({ok:true});
  }
  if(action==='edit'){
   if(!(['review','ready'].includes(row.status)||(row.status==='failed'&&row.edit&&row.stage!=='Deleting')))return failure('Wait for the recap before editing it.',409);
   if(body.expectedRevision!==row.revision)return failure('The lesson changed. Reload before editing.',409);
   const edit=validateEdit(body.edit,row.duration_s);if(!edit)return failure('Check the chapter text and clip times. Recaps can have up to 16 chapters and be up to 15 minutes.');
   // CAS prevents a late editor from overwriting a newly queued/rendered version.
   // The recap that exists keeps playing while the new one is made. The
   // text saved here is the truth and the file catches up, which is the
   // rule clip edits already follow. Clearing the keys meant a recap
   // vanished the moment its wording was corrected, and the page fell
   // back to the card that stands in before a recap exists at all, so a
   // typo fix read as the whole lesson being processed again. The worker
   // writes its new file under a key stamped with the new revision, so
   // the old one is never overwritten while it is still being watched.
   const {data:changed,error}=await db.from('lesson_videos').update({...queueLessonRender('Updating recap',new Date().toISOString()),edit,revision:row.revision+1}).eq('id',id).eq('revision',row.revision).eq('status',row.status).select('id').maybeSingle();
   if(error)throw error;if(!changed)return failure('The lesson changed. Reload before editing.',409);
   if(row.lesson_id)await db.from('coach_entries').update({shared_at:null}).eq('lesson_id',row.lesson_id).eq('coach_id',user.id);
   return NextResponse.json({ok:true});
  }
  if(action==='share'){
   // Publishing and sharing are one act for a coach and two for a player: a
   // coach's recap goes to the student the moment it is published, while a
   // player is asked each time and the answer is no unless they said yes.
   // publish_lesson_video ignores p_share on a coach's video.
   const {data:video,error}=await db.rpc('publish_lesson_video',{p_id:id,p_owner:user.id,p_share:body.share===true});
   if(error){console.error('lesson publish',error);return failure(row.coach_ref_id?'The recap could not be shared. Check that it is ready and the coach is still on your list.':'The recap could not be shared. Check that it is ready and the student is still on your roster.',409);}
   return NextResponse.json({ok:true,video:publicVideo(video,true)});
  }
  if(action==='unshare'){
   // A coach takes a recap back from the student page, where they can see
   // everything that student holds and decide in context. A second control
   // for it here would be a second place to keep right.
   if(!row.coach_ref_id)return failure('Take this recap back from the student page.',409);
   if(!row.lesson_id)return failure('This recap has not been shared yet.',409);
   const {error}=await db.from('lessons').update({shared_with_coach_at:null}).eq('id',row.lesson_id).eq('user_id',user.id);if(error)throw error;
   return NextResponse.json({ok:true});
  }
  if(action==='recipient'){
   // Who taught the lesson, answered or corrected after the import.
   //
   // The importer asks, but nobody is a real answer and an unanswered
   // picker looks the same as one, so a lesson could be filed against
   // no coach with no way back: nothing set it afterwards, and a recap
   // with nobody on it can never be shared. Owner only, and never on a
   // coach's own import, which names a student instead.
   if(!lessonCanSetCoach(row,true))return failure('This recap cannot be reattributed.',409);
   const coachRefId=typeof body.coachRefId==='string'?body.coachRefId.toLowerCase():null;
   if(coachRefId){
    if(!UUID.test(coachRefId))return failure('Choose a coach from your list.',403);
    const {data:c}=await db.from('player_coaches').select('id').eq('id',coachRefId).eq('player_id',user.id).is('archived_at',null).maybeSingle();
    if(!c)return failure('Choose a coach from your list.',403);
   }
   if(coachRefId===row.coach_ref_id)return NextResponse.json({ok:true,video:publicVideo(row,true)});
   const {data:changed,error}=await db.from('lesson_videos').update({coach_ref_id:coachRefId,updated_at:new Date().toISOString()}).eq('id',id).eq('owner_id',user.id).eq('revision',row.revision).select().maybeSingle();
   if(error)throw error;if(!changed)return failure('The lesson changed. Reload before changing the coach.',409);
   // The entry moves with it, and sharing does not come along. Whoever
   // it was shared with was a different person, and carrying their
   // access across to somebody they have never met is the one mistake
   // this must not make.
   if(row.lesson_id)await db.from('lessons').update({coach_ref_id:coachRefId,shared_with_coach_at:null}).eq('id',row.lesson_id).eq('user_id',user.id);
   return NextResponse.json({ok:true,video:publicVideo(changed,true)});
  }
  if(action==='delete'){
   if(['uploading','queued','processing'].includes(row.status))return failure('Wait for uploading and processing to finish before deleting this lesson.',409);
   // Reserve deletion under the same row lock used by claims and edits.
   const {data:reserved,error:reserveError}=await db.from('lesson_videos').update({status:'failed',stage:'Deleting',lease_token:null,revision:row.revision+1}).eq('id',id).eq('status',row.status).eq('revision',row.revision).select('id').maybeSingle();
   if(reserveError)throw reserveError;if(!reserved)return failure('The lesson changed. Reload before deleting.',409);
   if(row.upload_id)await abortMultipartUpload(MEDIA_BUCKET,row.source_key,row.upload_id);
   const objects=await listObjects(MEDIA_BUCKET,`lesson-video/${user.id}/${id}/`);await deleteObjects(MEDIA_BUCKET,objects.map(o=>o.key));
   if(objects.length){const {error:ledgerError}=await db.from('storage_ledger').insert(objects.map(o=>({user_id:user.id,kind:'other',bytes:-o.size,r2_key:`r2://${MEDIA_BUCKET}/${o.key}`})));if(ledgerError)console.error('lesson storage deletion ledger',ledgerError);}
   if(row.lesson_id)await db.from('lessons').delete().eq('id',row.lesson_id).eq('user_id',user.id);
   const {error}=await db.from('lesson_videos').delete().eq('id',id).eq('owner_id',user.id);if(error)throw error;
   return NextResponse.json({ok:true});
  }
  return failure('Unknown action');
 }catch(e){console.error('lesson-video action failed',action,e);return failure('Could not finish that step. Your original is safe; try again.',500);}
}
