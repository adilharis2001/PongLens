import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MEDIA_BUCKET,createMultipartUpload,presignUploadPart,listParts,completeMultipartUpload,headObject,presignGet,abortMultipartUpload,deleteObjects,listObjects } from '@/lib/r2';
import { PART_SIZE,validateImport,validateEdit,canReadVideo,publicVideo } from '@/lib/lessonVideo/model';
export const runtime='nodejs';
export const maxDuration=60;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure=(error:string,status=400)=>NextResponse.json({error},{status});
async function context(){const client=await createClient();const {data:{user}}=await client.auth.getUser();return {user,db:user?createAdminClient():null};}
async function shared(db:ReturnType<typeof createAdminClient>,row:Record<string,unknown>,uid:string){
 if(!row.lesson_id||row.status!=='ready')return false;
 const {data:entries}=await db.from('coach_entries').select('student_id').eq('lesson_id',row.lesson_id).not('shared_at','is',null);
 if(!entries?.length)return false;
 const {data:student}=await db.from('coach_students').select('id').in('id',entries.map(e=>e.student_id)).eq('player_id',uid).is('archived_at',null).limit(1);
 return !!student?.length;
}
export async function GET(req:Request){
 const {user,db}=await context();if(!user||!db)return failure('Not signed in',401);
 const url=new URL(req.url),id=url.searchParams.get('id'),studentId=url.searchParams.get('studentId');
 try{
  if(id){
   if(!UUID.test(id))return failure('Not found',404);
   const {data:row,error}=await db.from('lesson_videos').select('*').eq('id',id).maybeSingle();
   if(error)throw error;if(!row)return failure('Not found',404);
   const owner=row.owner_id===user.id;
   if(!canReadVideo(user.id,row.owner_id,row.status,owner?false:await shared(db,row,user.id)))return failure('Not found',404);
   const sourceUrl=owner&&row.status!=='uploading'?await presignGet(MEDIA_BUCKET,row.source_key,{expiresSeconds:14400,filename:row.original_name,disposition:'inline'}):undefined;
   const summaryUrl=row.summary_key&&['review','ready'].includes(row.status)?await presignGet(MEDIA_BUCKET,row.summary_key,{expiresSeconds:14400}):undefined;
   const playbackUrl=row.playback_key&&['review','ready'].includes(row.status)?await presignGet(MEDIA_BUCKET,row.playback_key,{expiresSeconds:14400}):summaryUrl;
   return NextResponse.json({video:publicVideo(row,owner),isOwner:owner,sourceUrl,summaryUrl,playbackUrl},{headers:{'Cache-Control':'private, no-store'}});
  }
  let q=db.from('lesson_videos').select('id,owner_id,student_id,lesson_id,original_name,file_size,duration_s,status,stage,error,edit,revision,created_at,updated_at').eq('owner_id',user.id).order('created_at',{ascending:false}).limit(100);
  if(studentId){if(!UUID.test(studentId))return failure('Invalid student');q=q.eq('student_id',studentId);}
  const {data,error}=await q;if(error)throw error;
  return NextResponse.json({videos:data??[]},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){console.error('lesson-video read failed',e);return failure('Could not load lesson videos. Try again.',500);}
}
export async function POST(req:Request){
 const {user,db}=await context();if(!user||!db)return failure('Not signed in',401);
 let body:Record<string,unknown>;try{body=await req.json();}catch{return failure('Invalid request');}
 const action=String(body.action??'');
 if(['create','edit','retry','share'].includes(action)&&user.user_metadata?.is_coach!==true)return failure('Lesson video imports are available in the coaching workspace.',403);
 try{
  if(action==='create'){
   const fileSize=Number(body.fileSize),duration=Number(body.durationS);const invalid=validateImport(fileSize,duration);if(invalid)return failure(invalid);
   const studentId=typeof body.studentId==='string'?body.studentId:null;
   if(studentId){if(!UUID.test(studentId))return failure('Invalid student');const {data:s}=await db.from('coach_students').select('id').eq('id',studentId).eq('coach_id',user.id).is('archived_at',null).maybeSingle();if(!s)return failure('Choose a student from your roster.',403);}
   const importToken=typeof body.clientRequestId==='string'?body.clientRequestId:null;
   if(importToken&&!UUID.test(importToken))return failure('Invalid import identifier');
   if(importToken){const {data:existing}=await db.from('lesson_videos').select('*').eq('owner_id',user.id).eq('import_token',importToken).maybeSingle();if(existing){if(existing.file_size!==fileSize||existing.student_id!==studentId)return failure('This import belongs to a different video.',409);return NextResponse.json({id:existing.id,video:publicVideo(existing,true),partSize:PART_SIZE});}}
   // Bound unfinished imports separately from match allowances.
   const {count,error:countError}=await db.from('lesson_videos').select('id',{head:true,count:'exact'}).eq('owner_id',user.id).in('status',['uploading','queued','processing']);
   if(countError)throw countError;if((count??0)>=8)return failure('Finish an existing lesson upload before starting another.',429);
   const id=crypto.randomUUID(),mime=body.contentType==='video/quicktime'?'video/quicktime':'video/mp4';
   const key=`lesson-video/${user.id}/${id}/original.${mime==='video/quicktime'?'mov':'mp4'}`;
   const uploadId=await createMultipartUpload(MEDIA_BUCKET,key,mime);
   const {data:video,error}=await db.from('lesson_videos').insert({id,owner_id:user.id,student_id:studentId,import_token:importToken,original_name:String(body.originalName??'Lesson.mov').slice(0,240),file_size:fileSize,duration_s:duration,source_key:key,upload_id:uploadId}).select().single();
   if(error){await abortMultipartUpload(MEDIA_BUCKET,key,uploadId);if(error.code==='23505'&&importToken){const {data:existing}=await db.from('lesson_videos').select('*').eq('owner_id',user.id).eq('import_token',importToken).single();if(existing&&existing.file_size===fileSize&&existing.student_id===studentId)return NextResponse.json({id:existing.id,video:publicVideo(existing,true),partSize:PART_SIZE});}throw error;}
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
   const {error}=await db.from('lesson_videos').update({status:'queued',stage:'Waiting to process',error:null,lease_token:null,lease_until:null,updated_at:new Date().toISOString()}).eq('id',id).eq('status','failed').eq('revision',row.revision).or('stage.is.null,stage.neq.Deleting');if(error)throw error;
   return NextResponse.json({ok:true});
  }
  if(action==='edit'){
   if(!(['review','ready'].includes(row.status)||(row.status==='failed'&&row.edit&&row.stage!=='Deleting')))return failure('Wait for the recap before editing it.',409);
   if(body.expectedRevision!==row.revision)return failure('The lesson changed. Reload before editing.',409);
   const edit=validateEdit(body.edit,row.duration_s);if(!edit)return failure('Check the chapter text and clip times. Recaps can be up to seven minutes.');
   // CAS prevents a late editor from overwriting a newly queued/rendered version.
   const {data:changed,error}=await db.from('lesson_videos').update({edit,status:'queued',stage:'Updating recap',summary_key:null,playback_key:null,revision:row.revision+1,updated_at:new Date().toISOString()}).eq('id',id).eq('revision',row.revision).eq('status',row.status).select('id').maybeSingle();
   if(error)throw error;if(!changed)return failure('The lesson changed. Reload before editing.',409);
   if(row.lesson_id)await db.from('coach_entries').update({shared_at:null}).eq('lesson_id',row.lesson_id).eq('coach_id',user.id);
   return NextResponse.json({ok:true});
  }
  if(action==='share'){
   const {data:video,error}=await db.rpc('publish_lesson_video',{p_id:id,p_owner:user.id});if(error){console.error('lesson publish',error);return failure('The recap could not be shared. Check that it is ready and the student is still on your roster.',409);}
   return NextResponse.json({ok:true,video:publicVideo(video,true)});
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
