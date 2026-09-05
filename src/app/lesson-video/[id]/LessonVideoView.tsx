'use client';

import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {ClipPlayer} from '@/app/match/[id]/ClipPlayer';
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
 const [mediaFailed,setMediaFailed]=useState(false);
 const player=useRef<HTMLVideoElement|null>(null);
 const transport=useRef<{play:()=>void;pause:()=>void}|null>(null);
 const frame=useRef<HTMLDivElement|null>(null);
 const menu=useRef<HTMLDetailsElement|null>(null);
 const active=useRef(true);
 const editingRevision=useRef(0);
 const linkBorn=useRef(0);
 const restore=useRef<{time:number;playing:boolean}|null>(null);

 async function load(force=false) {
  const r=await fetch('/api/lesson-video?id='+id);
  const d:Detail&{error?:string}=await r.json();
  if(!r.ok)throw new Error(d.error);
  if(!active.current)return;
  setDetail(previous=>{
   if(!force&&previous?.video.revision===d.video.revision&&previous?.video.status===d.video.status&&previous?.playbackUrl&&Date.now()-linkBorn.current<3*3600*1000) {
    return {...d,playbackUrl:previous.playbackUrl,posterUrl:previous.posterUrl??d.posterUrl};
   }
   if(player.current&&!restore.current)restore.current={time:player.current.currentTime,playing:!player.current.paused};
   linkBorn.current=Date.now();
   return d;
  });
 }
 useEffect(()=>{
  active.current=true;
  void load().catch(e=>setError(e.message));
  const timer=setInterval(()=>{void load().catch(()=>{});},10000);
  return()=>{active.current=false;clearInterval(timer);transport.current?.pause();};
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
 function seek(index:number) {
  if(!edit||index<0||index>=edit.chapters.length)return;
  const time=edit.chapters[index].summary_start_s??edit.chapters.slice(0,index).reduce((sum,c)=>sum+c.end_s-c.start_s,0);
  if(player.current&&player.current.readyState>=1){player.current.currentTime=time;transport.current?.play();}
  else restore.current={time,playing:true};
  setChapter(index);
  // The picker travels with the picture. If reached by keyboard or a
  // restored scroll position, bring both back into view together.
  frame.current?.scrollIntoView({block:'start',behavior:'smooth'});
 }
 function closeMenu(){if(menu.current)menu.current.open=false;}
 async function retryPlayback(){setMediaFailed(false);try{await load(true);}catch(e){setMediaFailed(true);setError((e as Error).message);}}

 return <main className="mx-auto min-h-dvh max-w-6xl px-5 pb-10 pt-5 text-zinc-100 sm:px-8 sm:pt-8">
  <header className="mb-6">
   <div className="flex items-center justify-between gap-4">
    <Link href={back} className={button}><span aria-hidden="true">‹</span> Back</Link>
    {v&&<details ref={menu} className="relative">
     <summary aria-label="More lesson actions" className={button+' cursor-pointer list-none [&::-webkit-details-marker]:hidden'}>More <span aria-hidden="true">···</span></summary>
     <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-edge bg-surface p-1 shadow-2xl">
      {detail?.summaryUrl&&<a className="block rounded-xl px-4 py-3 text-sm hover:bg-surface-2" href={detail.summaryUrl} target="_blank" rel="noreferrer" onClick={closeMenu}>Video with text</a>}
      {detail?.isOwner&&detail.sourceUrl&&<a className="block rounded-xl px-4 py-3 text-sm hover:bg-surface-2" href={detail.sourceUrl} target="_blank" rel="noreferrer" onClick={closeMenu}>Original recording</a>}
      {detail?.isOwner&&!['queued','processing','uploading'].includes(v.status)&&<button className="block w-full rounded-xl px-4 py-3 text-left text-sm text-amber-300 hover:bg-surface-2" onClick={()=>{closeMenu();setConfirmDelete(true);}}>Delete lesson video</button>}
     </div>
    </details>}
   </div>
   <h1 className="mt-6 text-2xl font-bold tracking-tight">{edit?.title??v?.original_name??'Lesson video'}</h1>
  </header>
  {error&&<p role="alert" className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-950/30 p-4 text-sm text-amber-200">{error}</p>}
  {!v?<p className="text-sm text-zinc-400">{error?'':'Loading lesson…'}</p>:<>
   {detail?.playbackUrl&&edit?<div className="flex flex-col items-start gap-5 lg:flex-row lg:gap-6">
    <div ref={frame} className="sticky top-0 z-20 w-full min-w-0 scroll-mt-3 bg-ink pb-3 pt-2 lg:top-5 lg:flex-1 lg:rounded-2xl lg:bg-transparent lg:p-0">
     <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-edge bg-black">
      <ClipPlayer src={detail.playbackUrl} poster={detail.posterUrl} mode="cut" fill readPixels={false} videoElRef={player} playRef={transport}
       onLoadedMetadata={el=>{if(restore.current){el.currentTime=Math.max(0,Math.min(restore.current.time,Math.max(0,el.duration-.1)));if(restore.current.playing)transport.current?.play();restore.current=null;}}}
       onTime={el=>{const index=edit.chapters.findIndex(c=>el.currentTime>=(c.summary_start_s??0)&&el.currentTime<(c.summary_end_s??Infinity));if(index>=0)setChapter(index);}}
       onMediaError={state=>{if(state)restore.current={time:state.time,playing:state.wasPlaying};setMediaFailed(true);}} />
      {mediaFailed&&<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/90 p-4"><p className="text-sm text-zinc-300">Could not play this video.</p><button className={button} onClick={()=>void retryPlayback()}>Try again</button></div>}
     </div>
     <div className="mt-3 flex items-center gap-2" aria-label="Chapter navigation">
      <button className={button+' w-11 shrink-0 !px-0'} aria-label="Previous chapter" disabled={chapter===0} onClick={()=>seek(chapter-1)}>‹</button>
      <label className="flex min-h-11 min-w-0 flex-1 items-center rounded-xl border border-edge bg-surface px-3">
       <span className="shrink-0 text-xs tabular-nums text-cyan-glow">{chapter+1}/{edit.chapters.length}</span>
       <select aria-label="Chapter" className="w-full min-w-0 truncate bg-transparent px-2 py-2 text-sm font-medium text-zinc-200 focus:outline-none" value={chapter} onChange={e=>seek(Number(e.target.value))}>
        {edit.chapters.map((c,i)=><option key={i} value={i} className="bg-ink">{c.title}</option>)}
       </select>
      </label>
      <button className={button+' w-11 shrink-0 !px-0'} aria-label="Next chapter" disabled={chapter===edit.chapters.length-1} onClick={()=>seek(chapter+1)}>›</button>
     </div>
    </div>
    <section aria-label="Chapter reminders" className="w-full shrink-0 rounded-2xl border border-edge bg-surface p-5 lg:w-80">
     <h2 className="text-base font-semibold text-zinc-100">{current?.title}</h2>
     <ul className="mt-4 space-y-4">{current?.cues.map((cue,i)=><li key={i} className="border-l-2 border-cyan-glow/60 pl-4 text-sm leading-relaxed text-zinc-300">{cue}</li>)}</ul>
    </section>
   </div>:<div role="status" className="rounded-2xl border border-edge bg-surface p-5"><p className="font-medium">{v.status==='failed'?'The recap needs another try':v.stage??'Waiting for the upload'}</p><p className="mt-3 text-sm text-zinc-400">{v.error??'Your lesson will be here when it is ready.'}</p></div>}
   {edit?.warning&&<p className="mt-5 text-sm text-amber-200">{edit.warning}</p>}
   {detail?.isOwner&&<footer className="mt-6 border-t border-edge pt-5">
    <div className="flex flex-wrap items-center gap-3">
     {v.status==='review'&&<button className={primary} disabled={busy} onClick={()=>void action('share')}>{busy?'Saving…':v.student_id?'Share with student':'Approve recap'}</button>}
     {(['review','ready'].includes(v.status)||(v.status==='failed'&&edit))&&<button className={button} disabled={busy} onClick={()=>{transport.current?.pause();editingRevision.current=v.revision;setEditing(structuredClone(edit!));}}>Edit recap</button>}
     {v.status==='failed'&&<button className={button} disabled={busy} onClick={()=>void action('retry')}>Retry processing</button>}
    </div>
    <p className="mt-3 text-xs text-zinc-500">{v.status==='review'?'Private draft · Ready to review':v.status==='ready'?'Ready':v.stage}</p>
   </footer>}
  </>}
  {editing&&<dialog ref={node=>{if(node&&!node.open)node.showModal();}} onCancel={()=>setEditing(null)} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-edge bg-surface p-5 text-zinc-100 backdrop:bg-black/75">
   <div className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">Edit recap</h2><button className={button} onClick={()=>setEditing(null)}>Cancel</button></div>
   <label className="mt-5 block text-sm">Title<input autoFocus className={field} value={editing.title} maxLength={100} onChange={e=>setEditing({...editing,title:e.target.value})}/></label>
   {editing.chapters.map((ch,i)=><div className="mt-6 border-t border-edge pt-5" key={i}><label className="text-sm text-zinc-400">Chapter {i+1}<input aria-label={`Chapter ${i+1} title`} className={field} value={ch.title} maxLength={80} onChange={e=>setEditing({...editing,chapters:editing.chapters.map((c,n)=>n===i?{...c,title:e.target.value}:c)})}/></label>{ch.cues.map((cue,j)=><textarea key={j} aria-label={`Chapter ${i+1} reminder ${j+1}`} rows={3} className={field} value={cue} maxLength={220} onChange={e=>setEditing({...editing,chapters:editing.chapters.map((c,n)=>n===i?{...c,cues:c.cues.map((x,m)=>m===j?e.target.value:x)}:c)})}/>)}{editing.chapters.length>1&&<button className={button+' mt-3'} onClick={()=>setEditing({...editing,chapters:editing.chapters.filter((_,n)=>n!==i)})}>Remove chapter</button>}</div>)}
   <button disabled={busy} className={primary+' mt-6'} onClick={()=>void action('edit',{edit:editing,expectedRevision:editingRevision.current})}>Save and rebuild</button>
  </dialog>}
  {confirmDelete&&<dialog ref={node=>{if(node&&!node.open)node.showModal();}} onCancel={()=>setConfirmDelete(false)} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-edge bg-surface p-6 text-zinc-100 backdrop:bg-black/75"><h2 className="text-xl font-semibold">Delete this lesson video?</h2><p className="mt-4 text-sm leading-relaxed text-zinc-400">The original, recap, and linked lesson entry will be deleted. This cannot be undone.</p><div className="mt-5 flex gap-3"><button className={button+' text-amber-300'} disabled={busy} onClick={()=>void action('delete')}>Delete</button><button className={button} onClick={()=>setConfirmDelete(false)}>Cancel</button></div></dialog>}
 </main>;
}
