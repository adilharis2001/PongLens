'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {PART_SIZE,validateImport,type LessonVideo} from '@/lib/lessonVideo/model';
const button='rounded-full border border-zinc-700 px-5 py-2.5 text-sm text-zinc-100 hover:border-cyan-400 disabled:opacity-40';
async function post(body:object){const r=await fetch('/api/lesson-video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error??'Could not continue. Try again.');return d;}
export function LessonVideos({students,userId,initialStudent}:{students:{id:string;display_name:string}[];userId:string;initialStudent:string}){
 const [videos,setVideos]=useState<LessonVideo[]>([]),[student,setStudent]=useState(initialStudent),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');const input=useRef<HTMLInputElement>(null);const active=useRef(true);
 async function load(){try{const r=await fetch('/api/lesson-video');const d=await r.json();if(!r.ok)throw new Error(d.error);if(active.current)setVideos(d.videos);}catch(e){if(active.current)setError(String((e as Error).message));}}
 useEffect(()=>{active.current=true;void load();const timer=setInterval(()=>{void load();},10000);return()=>{active.current=false;clearInterval(timer);};},[]);
 async function upload(file:File){setBusy(true);setError('');setProgress('Reading the video…');let objectUrl='';
  try{
   objectUrl=URL.createObjectURL(file);const duration=await new Promise<number>((resolve,reject)=>{const v=document.createElement('video');v.preload='metadata';v.onloadedmetadata=()=>{const d=v.duration;v.removeAttribute('src');v.load();resolve(d);};v.onerror=()=>reject(new Error('This browser could not read the video. Import it in the iPhone app.'));v.src=objectUrl;});
   const invalid=validateImport(file.size,duration);if(invalid)throw new Error(invalid);
   const fingerprint=[file.name,file.size,file.lastModified,student].join(':');const storageKey='lesson-video-upload:'+userId;let id:string|undefined;let clientRequestId=crypto.randomUUID();
   try{const saved=JSON.parse(localStorage.getItem(storageKey)??'null');if(saved?.fingerprint===fingerprint){id=saved.id;clientRequestId=saved.clientRequestId??clientRequestId;}}catch{}
   if(!id){localStorage.setItem(storageKey,JSON.stringify({fingerprint,clientRequestId}));const created=await post({action:'create',clientRequestId,studentId:student||undefined,originalName:file.name,fileSize:file.size,durationS:duration,contentType:file.type});id=created.id;localStorage.setItem(storageKey,JSON.stringify({id,fingerprint,clientRequestId}));}
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
 return <main className="mx-auto max-w-5xl px-5 py-8 text-zinc-100"><Link href="/coaching" className={button}>Back to Coaching</Link><h1 className="mb-8 mt-9 text-3xl font-semibold">Lesson videos</h1><div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6"><h2 className="text-xl font-medium">Import a lesson</h2><p className="mt-4 max-w-2xl text-zinc-300">Record in the iPhone Camera app at 1080p and 30 fps, in landscape. Place the tripod near the coach, angled across the table. Check that you can hear their explanation over the ball sounds.</p><p className="mt-3 text-sm text-zinc-400">Lessons up to three hours and 20 GB. Your original and recap are kept until you delete them.</p><label className="mt-6 block text-sm">Student<select disabled={busy} className="mt-2 block w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-3" value={student} onChange={e=>setStudent(e.target.value)}><option value="">My own lesson</option>{students.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select></label><input ref={input} type="file" accept="video/mp4,video/quicktime,video/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);}}/><button disabled={busy} className={button+' mt-5 bg-cyan-950'} onClick={()=>input.current?.click()}>{busy?'Uploading…':'Choose a video'}</button>{busy&&<p className="mt-3 text-sm text-zinc-400">Keep this page open during upload. For a long recording, the iPhone app also saves upload progress.</p>}{progress&&<p role="status" className="mt-4 text-cyan-300">{progress}</p>}{error&&<p role="alert" className="mt-4 text-amber-300">{error}</p>}</div><div className="mt-8 space-y-3">{videos.map(v=><Link className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800 p-5 hover:border-zinc-600" key={v.id} href={'/lesson-video/'+v.id}><div><p className="font-medium">{v.edit?.title??v.original_name}</p><p className="mt-1 text-sm text-zinc-400">{new Date(v.created_at).toLocaleDateString()} · {Math.round(v.duration_s/60)} minutes</p></div><span className="text-sm text-cyan-300">{v.status==='review'?'Ready to review':v.status==='ready'?'Ready':v.status==='failed'?'Needs attention':v.stage??v.status}</span></Link>)}</div></main>;
}
