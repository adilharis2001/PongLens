'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {PART_SIZE,validateImport,type LessonVideo} from '@/lib/lessonVideo/model';
import {lessonStatusLabel} from '@/lib/lessonVideo/presentation';
import {AllowanceRequest} from '@/components/AllowanceRequest';
import {QUOTA_ERRORS} from '@/lib/quota';
const button='rounded-full border border-zinc-700 px-5 py-2.5 text-sm text-zinc-100 hover:border-cyan-400 disabled:opacity-40';
async function post(body:object){const r=await fetch('/api/lesson-video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error??'Could not continue. Try again.');return d;}
/**
 * Importing a lesson, from either side of it.
 *
 * A coach imports a lesson FOR a student; a player imports a lesson they
 * had WITH a coach. Same upload, same recap, same page — the only thing
 * that differs is who the picker names and which field the create call
 * carries. Two pages would be two places for the resumable upload to
 * drift, and that upload is the part nobody wants to write twice.
 */
export function LessonVideos({students,coaches=[],audience='coach',userId,initialStudent}:{students:{id:string;display_name:string}[];coaches?:{id:string;display_name:string}[];audience?:'coach'|'player';userId:string;initialStudent:string}){
 const player=audience==='player';
 const people=player?coaches:students;
 const [videos,setVideos]=useState<LessonVideo[]>([]),[student,setStudent]=useState(player?'':initialStudent),[answered,setAnswered]=useState(!player),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');const input=useRef<HTMLInputElement>(null);const active=useRef(true);
 // A dual-role account owns lessons in both directions. This page shows
 // one of them: a coach's imports for a student never belong on the page
 // where a player imports their own lesson, and the reverse.
 async function load(){try{const r=await fetch('/api/lesson-video'+(!player&&initialStudent?'?studentId='+encodeURIComponent(initialStudent):''));const d=await r.json();if(!r.ok)throw new Error(d.error);if(active.current)setVideos((d.videos as LessonVideo[]).filter(v=>player?!v.student_id:true));}catch(e){if(active.current)setError(String((e as Error).message));}}
 useEffect(()=>{active.current=true;void load();const timer=setInterval(()=>{void load();},10000);return()=>{active.current=false;clearInterval(timer);};},[initialStudent,player]);
 async function upload(file:File){setBusy(true);setError('');setProgress('Reading the video…');let objectUrl='';
  try{
   objectUrl=URL.createObjectURL(file);const duration=await new Promise<number>((resolve,reject)=>{const v=document.createElement('video');v.preload='metadata';v.onloadedmetadata=()=>{const d=v.duration;v.removeAttribute('src');v.load();resolve(d);};v.onerror=()=>reject(new Error('This browser could not read the video. Import it in the iPhone app.'));v.src=objectUrl;});
   const invalid=validateImport(file.size,duration);if(invalid)throw new Error(invalid);
   const fingerprint=[file.name,file.size,file.lastModified,student].join(':');const storageKey='lesson-video-upload:'+userId;let id:string|undefined;let clientRequestId=crypto.randomUUID();
   try{const saved=JSON.parse(localStorage.getItem(storageKey)??'null');if(saved?.fingerprint===fingerprint){id=saved.id;clientRequestId=saved.clientRequestId??clientRequestId;}}catch{}
   if(!id){localStorage.setItem(storageKey,JSON.stringify({fingerprint,clientRequestId}));const created=await post({action:'create',clientRequestId,...(player?{coachRefId:student||undefined}:{studentId:student||undefined}),originalName:file.name,fileSize:file.size,durationS:duration,contentType:file.type});id=created.id;localStorage.setItem(storageKey,JSON.stringify({id,fingerprint,clientRequestId}));}
   const listed=await post({action:'list-parts',id});
   if(!listed.complete){
    if(listed.gone){localStorage.removeItem(storageKey);throw new Error('The unfinished upload expired. Choose the same video again to restart.');}
    const done=new Map<number,string>((listed.parts??[]).map((p:{PartNumber:number;ETag:string})=>[p.PartNumber,p.ETag]));
    for(let n=1;n<=Math.ceil(file.size/PART_SIZE);n++){
     if(done.has(n))continue;
     setProgress(`Uploading ${Math.round((n-1)*PART_SIZE/file.size*100)}%`);
     let success=false;
     for(let attempt=0;attempt<3&&!success;attempt++){
      const signed=await post({action:'sign-part',id,partNumber:n});const r=await fetch(signed.url,{method:'PUT',body:file.slice((n-1)*PART_SIZE,Math.min(n*PART_SIZE,file.size))});success=r.ok;
      if(!success&&attempt===2)throw new Error('The upload paused. Choose this same video again to resume.');
     }
    }
   }
   await post({action:'complete',id});localStorage.removeItem(storageKey);setProgress('Uploaded. Your recap is being prepared.');await load();
  }catch(e){setError((e as Error).message);}finally{if(objectUrl)URL.revokeObjectURL(objectUrl);setBusy(false);if(input.current)input.current.value='';}
 }
 return <main className="text-zinc-100"><Link href={!player&&initialStudent?`/coaching/students/${initialStudent}`:"/coaching"} className={button}>{!player&&initialStudent?"Back to student":"Back to Coaching"}</Link><h1 className="mb-8 mt-8 text-2xl font-bold tracking-tight sm:text-3xl">Lesson videos</h1><div className="rounded-2xl border border-edge bg-surface p-5"><h2 className="text-base font-semibold">Import a lesson</h2><p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">Record in the iPhone Camera app at 1080p and 30 fps, in landscape. Place the tripod near the coach, angled across the table. Check that you can hear their explanation over the ball sounds.</p><p className="mt-3 text-sm text-zinc-400">Lessons up to three hours and 20 GB. Your original and recap are kept until you delete them.</p><label className="mt-6 block text-sm">{player?'Who taught it?':'Student'}{/* A picker that starts on "No coach" looks answered and is not: three
    lessons in one day were filed against nobody that way. The player's
    starts on "Choose", and the upload button waits for a real answer,
    of which "No coach" is one. */}<select disabled={busy||(!player&&!!initialStudent)} className="mt-2 block w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-3" value={player&&!answered?'__choose__':(student||'__none__')} onChange={e=>{const v=e.target.value;setStudent(v==='__none__'?'':v);setAnswered(true);}}>{player&&!answered&&<option value="__choose__" disabled>Choose…</option>}<option value="__none__">{player?'No coach':'Private lesson'}</option>{people.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select></label><input ref={input} type="file" accept="video/mp4,video/quicktime,video/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);}}/><button disabled={busy||(player&&!answered)} className={button+' mt-5 bg-cyan-950'} onClick={()=>input.current?.click()}>{busy?'Uploading…':'Choose a video'}</button>{busy&&<p className="mt-3 text-sm text-zinc-400">Keep this page open during upload. For a long recording, the iPhone app also saves upload progress.</p>}{progress&&<p role="status" className="mt-4 text-cyan-300">{progress}</p>}{error&&<p role="alert" className="mt-4 text-amber-300">{error}</p>}{error===QUOTA_ERRORS.storage&&<div className="mt-3 max-w-md"><AllowanceRequest resource="storage"/></div>}</div><div className="mt-8 space-y-3">{videos.map(v=><Link className="flex items-center justify-between gap-4 rounded-2xl border border-edge bg-surface p-5 text-sm hover:bg-surface-2" key={v.id} href={'/lesson-video/'+v.id}><div><p className="font-medium">{v.edit?.title??v.original_name}</p><p className="mt-1 text-sm text-zinc-400">{new Date(v.created_at).toLocaleDateString()} · {Math.round(v.duration_s/60)} minutes</p></div><span className="text-sm text-cyan-300">{lessonStatusLabel(v,!!v.shared,!!v.edit)}</span></Link>)}</div></main>;
}
