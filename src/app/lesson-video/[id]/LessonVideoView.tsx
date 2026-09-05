'use client';

import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {LessonPlayback} from './LessonPlayback';
import type {LessonVideo,LessonEdit} from '@/lib/lessonVideo/model';

const button='inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-edge px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-2 disabled:opacity-40';
const primary='glow-cta inline-flex min-h-11 items-center justify-center rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-40';
const field='mt-2 block w-full rounded-xl border border-edge bg-ink p-3 text-sm text-zinc-100 focus:border-cyan-glow focus:outline-none';
interface Detail {video:LessonVideo;isOwner:boolean;sourceUrl?:string;summaryUrl?:string;playbackUrl?:string;posterUrl?:string}

export function LessonVideoView({id}:{id:string}) {
 const [detail,setDetail]=useState<Detail|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [editing,setEditing]=useState<LessonEdit|null>(null);
 const [chapter,setChapter]=useState(0);
 const [confirmDelete,setConfirmDelete]=useState(false);
 const [watching,setWatching]=useState(false);
 const resumeTime=useRef(0);

 const menu=useRef<HTMLDetailsElement|null>(null);
 const active=useRef(true);
 const editingRevision=useRef(0);
 const linkBorn=useRef(0);


 async function load(force=false) {
  const r=await fetch('/api/lesson-video?id='+id);
  const d:Detail&{error?:string}=await r.json();
  if(!r.ok)throw new Error(d.error);
  if(!active.current)return;
  setDetail(previous=>{
   if(!force&&previous?.video.revision===d.video.revision&&previous?.video.status===d.video.status&&previous?.playbackUrl&&Date.now()-linkBorn.current<3*3600*1000) {
    return {...d,playbackUrl:previous.playbackUrl,posterUrl:previous.posterUrl??d.posterUrl};
   }
   linkBorn.current=Date.now();
   return d;
  });
 }
 useEffect(()=>{
  active.current=true;
  void load().catch(e=>setError(e.message));
  const timer=setInterval(()=>{void load().catch(()=>{});},10000);
  return()=>{active.current=false;clearInterval(timer);};
 },[id]);
 const v=detail?.video;
 const edit=v?.edit;
 useEffect(()=>{setChapter(index=>Math.min(index,Math.max(0,(edit?.chapters.length??1)-1)));},[edit?.chapters.length]);
 const current=edit?.chapters[chapter]??edit?.chapters[0];
 const back=detail?.isOwner ? (v?.student_id?'/coaching/students/'+v.student_id:'/coaching/videos'):'/coaching';

 async function action(name:string,extra:object={}) {
  setBusy(true);setError('');
  try {
   const r=await fetch('/api/lesson-video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:name,id,...extra})});
   const d=await r.json();if(!r.ok)throw new Error(d.error);
   if(name==='delete'){location.href=back;return;}
   setEditing(null);await load();
  } catch(e){setError((e as Error).message);} finally{setBusy(false);}
 }
 function closeMenu(){if(menu.current)menu.current.open=false;}
 function openEditor(){closeMenu();editingRevision.current=v!.revision;setEditing(structuredClone(edit!));}

 return <main className="mx-auto min-h-dvh max-w-6xl px-5 pb-10 pt-5 text-zinc-100 sm:px-8 sm:pt-8">
  <header className="mb-6">
   <div className="flex items-center justify-between gap-4">
    <Link href={back} className={button}><span aria-hidden="true">‹</span> Back</Link>
    {v&&<details ref={menu} className="relative">
     <summary aria-label="More lesson actions" className={button+' cursor-pointer list-none [&::-webkit-details-marker]:hidden'}>More <span aria-hidden="true">···</span></summary>
     <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-edge bg-surface p-1 shadow-2xl">
      {detail?.isOwner&&edit&&(['review','ready'].includes(v.status)||v.status==='failed')&&<button className="block w-full rounded-xl px-4 py-3 text-left text-sm hover:bg-surface-2" disabled={busy} onClick={openEditor}>Edit recap</button>}
      {detail?.summaryUrl&&<a className="block rounded-xl px-4 py-3 text-sm hover:bg-surface-2" href={detail.summaryUrl} target="_blank" rel="noreferrer" onClick={closeMenu}>Video with text</a>}
      {detail?.isOwner&&detail.sourceUrl&&<a className="block rounded-xl px-4 py-3 text-sm hover:bg-surface-2" href={detail.sourceUrl} target="_blank" rel="noreferrer" onClick={closeMenu}>Original recording</a>}
      {detail?.isOwner&&!['queued','processing','uploading'].includes(v.status)&&<button className="block w-full rounded-xl px-4 py-3 text-left text-sm text-amber-300 hover:bg-surface-2" onClick={()=>{closeMenu();setConfirmDelete(true);}}>Delete lesson video</button>}
     </div>
    </details>}
   </div>
   {v&&<p className="mt-6 text-sm font-medium text-zinc-400">{v.status==='review'?'Ready to review':v.status==='ready'?(v.student_id?'Shared':'Ready'):v.stage??'Lesson video'}</p>}
   <h1 className="mt-2 text-2xl font-bold tracking-tight">{edit?.title??v?.original_name??'Lesson video'}</h1>
  </header>
  {error&&<p role="alert" className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-950/30 p-4 text-sm text-amber-200">{error}</p>}
  {!v?<p className="text-sm text-zinc-400">{error?'':'Loading lesson…'}</p>:<>
   {detail?.playbackUrl&&edit?<div className="mx-auto w-full max-w-3xl">
    <button aria-label="Play" className="group relative block aspect-video w-full overflow-hidden rounded-2xl bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-glow" onClick={()=>setWatching(true)}>
     {detail.posterUrl&&<img src={detail.posterUrl} alt="Lesson video preview" className="absolute inset-0 h-full w-full object-cover"/>}
     <span className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/20"/>
     <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md"><svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 4.5v15l12-7.5z"/></svg></span>
    </button>
    <div className="mt-4 flex items-center justify-between text-sm text-zinc-400"><span>{edit.chapters.length} chapters</span><span>{Math.round(edit.chapters.reduce((sum,c)=>sum+c.end_s-c.start_s,0)/60)} min recap</span></div>
    <div className="mt-5 border-t border-edge pt-5"><p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{resumeTime.current>0?'Continue watching':'First chapter'}</p><p className="mt-2 text-base font-medium">{current?.title}</p></div>
   </div>:<div role="status" className="rounded-2xl border border-edge bg-surface p-5"><p className="font-medium">{v.status==='failed'?'The recap needs another try':v.stage??'Waiting for the upload'}</p><p className="mt-3 text-sm text-zinc-400">{v.error??'Your lesson will be here when it is ready.'}</p></div>}
   {edit?.warning&&<p className="mt-5 text-sm text-amber-200">{edit.warning}</p>}
   {detail?.isOwner&&<footer className="mx-auto mt-7 w-full max-w-3xl">
     {v.status==='review'&&<button className={primary+' w-full min-h-12'} disabled={busy} onClick={()=>void action('share')}>{busy?'Saving…':v.student_id?'Share with student':'Approve recap'}</button>}
     {v.status==='failed'&&<button className={button+' w-full'} disabled={busy} onClick={()=>void action('retry')}>Retry processing</button>}
   </footer>}
  </>}
  {watching&&detail?.playbackUrl&&edit&&<LessonPlayback src={detail.playbackUrl} poster={detail.posterUrl} edit={edit} initialTime={resumeTime.current} onClose={(time,index)=>{resumeTime.current=time;setChapter(index);setWatching(false);}} onRetry={()=>load(true)}/>}
  {editing&&<dialog ref={node=>{if(node&&!node.open)node.showModal();}} onCancel={()=>setEditing(null)} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-edge bg-surface p-5 text-zinc-100 backdrop:bg-black/75">
   <div className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">Edit recap</h2><button className={button} onClick={()=>setEditing(null)}>Cancel</button></div>
   <label className="mt-5 block text-sm">Title<input autoFocus className={field} value={editing.title} maxLength={100} onChange={e=>setEditing({...editing,title:e.target.value})}/></label>
   {editing.chapters.map((ch,i)=><div className="mt-6 border-t border-edge pt-5" key={i}><label className="text-sm text-zinc-400">Chapter {i+1}<input aria-label={`Chapter ${i+1} title`} className={field} value={ch.title} maxLength={80} onChange={e=>setEditing({...editing,chapters:editing.chapters.map((c,n)=>n===i?{...c,title:e.target.value}:c)})}/></label>{ch.cues.map((cue,j)=><textarea key={j} aria-label={`Chapter ${i+1} reminder ${j+1}`} rows={3} className={field} value={cue} maxLength={220} onChange={e=>setEditing({...editing,chapters:editing.chapters.map((c,n)=>n===i?{...c,cues:c.cues.map((x,m)=>m===j?e.target.value:x)}:c)})}/>)}{editing.chapters.length>1&&<button className={button+' mt-3'} onClick={()=>setEditing({...editing,chapters:editing.chapters.filter((_,n)=>n!==i)})}>Remove chapter</button>}</div>)}
   <button disabled={busy} className={primary+' mt-6'} onClick={()=>void action('edit',{edit:editing,expectedRevision:editingRevision.current})}>Save and rebuild</button>
  </dialog>}
  {confirmDelete&&<dialog ref={node=>{if(node&&!node.open)node.showModal();}} onCancel={()=>setConfirmDelete(false)} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-edge bg-surface p-6 text-zinc-100 backdrop:bg-black/75"><h2 className="text-xl font-semibold">Delete this lesson video?</h2><p className="mt-4 text-sm leading-relaxed text-zinc-400">The original, recap, and linked lesson entry will be deleted. This cannot be undone.</p><div className="mt-5 flex gap-3"><button className={button+' text-amber-300'} disabled={busy} onClick={()=>void action('delete')}>Delete</button><button className={button} onClick={()=>setConfirmDelete(false)}>Cancel</button></div></dialog>}
 </main>;
}
