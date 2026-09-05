'use client';

import {useEffect, useRef, useState} from 'react';
import {ClipPlayer} from '@/app/match/[id]/ClipPlayer';
import type {LessonEdit} from '@/lib/lessonVideo/model';

interface Props {
 src:string;
 poster?:string;
 edit:LessonEdit;
 initialTime:number;
 onClose:(time:number,chapter:number)=>void;
 onRetry:()=>Promise<void>;
}
const control='flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-25 focus-visible:outline focus-visible:outline-cyan-glow';

/** One video and one chapter clock, whether the notes sit below or beside it. */
export function LessonPlayback({src,poster,edit,initialTime,onClose,onRetry}:Props) {
 const dialog=useRef<HTMLDialogElement>(null);
 const player=useRef<HTMLVideoElement|null>(null);
 const transport=useRef<{play:()=>void;pause:()=>void}|null>(null);
 const pages=useRef<HTMLDivElement>(null);
 const pending=useRef<{time:number;playing:boolean}|null>({time:initialTime,playing:true});
 const chapterAt=(time:number)=>{let index=0;edit.chapters.forEach((c,i)=>{if(time>=(c.summary_start_s??0))index=i;});return index;};
 const [chapter,setChapter]=useState(()=>chapterAt(initialTime));
 const chapterRef=useRef(chapter);
 const scrolling=useRef(false);
 const scrollTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [failed,setFailed]=useState(false);
 const [retrying,setRetrying]=useState(false);
 const savedPosition=useRef(initialTime);
 const previousSource=useRef(src);
 // Capture before React replaces the media source and its clock resets.
 if(previousSource.current!==src){
  pending.current??={time:savedPosition.current,playing:!(player.current?.paused??true)};
  previousSource.current=src;
 }

 useEffect(()=>{
  dialog.current?.showModal();
  const previous=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const video=player.current;
  const pause=()=>{if(document.hidden)video?.pause();};
  document.addEventListener('visibilitychange',pause);
  return()=>{video?.pause();document.body.style.overflow=previous;document.removeEventListener('visibilitychange',pause);if(scrollTimer.current)clearTimeout(scrollTimer.current);};
 },[]);
 useEffect(()=>{
  chapterRef.current=chapter;
  const el=pages.current;
  if(el)el.scrollTo({left:chapter*el.clientWidth,behavior:'smooth'});
 },[chapter]);
 useEffect(()=>{
  const el=pages.current;if(!el)return;
  const observer=new ResizeObserver(()=>el.scrollTo({left:chapterRef.current*el.clientWidth,behavior:'instant'}));
  observer.observe(el);return()=>observer.disconnect();
 },[]);
 function choose(index:number){
  if(index<0||index>=edit.chapters.length)return;
  const time=edit.chapters[index].summary_start_s??edit.chapters.slice(0,index).reduce((sum,c)=>sum+c.end_s-c.start_s,0);
  chapterRef.current=index;setChapter(index);savedPosition.current=time;
  if(player.current&&player.current.readyState>=1){player.current.currentTime=time;transport.current?.play();}
  else pending.current={time,playing:true};
 }
 function onScroll(){
  scrolling.current=true;
  if(scrollTimer.current)clearTimeout(scrollTimer.current);
  scrollTimer.current=setTimeout(()=>{
   const el=pages.current;
   if(el&&el.clientWidth){const index=Math.round(el.scrollLeft/el.clientWidth);if(index!==chapterRef.current)choose(index);}
   scrolling.current=false;
  },160);
 }
 function close(){
  const video=player.current;
  const finished=video?.ended??false;
  transport.current?.pause();
  onClose(finished?0:(video?.currentTime??savedPosition.current),finished?0:chapterRef.current);
 }
 async function retry(){
  setRetrying(true);
  pending.current??={time:savedPosition.current,playing:true};
  try{await onRetry();setFailed(false);}catch{setFailed(true);}finally{setRetrying(false);}
 }
 return <dialog ref={dialog} aria-label="Lesson playback" onCancel={event=>{event.preventDefault();close();}} className="lesson-playback m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-ink p-0 text-zinc-100 backdrop:bg-black">
  <div className="flex h-full min-h-0 flex-col" style={{paddingTop:'env(safe-area-inset-top)',paddingBottom:'env(safe-area-inset-bottom)'}}>
   <header className="flex shrink-0 items-center justify-between gap-3 px-3 py-2 sm:px-5">
    <button autoFocus className={control} aria-label="Close playback" onClick={close}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    <span className="text-sm font-medium text-zinc-300">Lesson recap</span><div className="w-11"/>
   </header>
   <div className="lesson-playback-content flex min-h-0 flex-1 flex-col">
    <div className="lesson-playback-video flex shrink-0 items-center justify-center bg-black">
     <div className="relative aspect-video w-full">
      <ClipPlayer src={src} poster={poster} mode="cut" fill readPixels={false} videoElRef={player} playRef={transport}
       onLoadedMetadata={el=>{if(pending.current){const target=pending.current;pending.current=null;el.currentTime=Math.max(0,Math.min(target.time,Math.max(0,el.duration-.1)));if(target.playing)transport.current?.play();}}}
       onTime={el=>{savedPosition.current=el.currentTime;if(scrolling.current||el.seeking)return;const index=chapterAt(el.currentTime);if(index!==chapterRef.current){chapterRef.current=index;setChapter(index);}}}
       onMediaError={state=>{if(state)pending.current={time:state.time,playing:state.wasPlaying};setFailed(true);}}/>
      {failed&&<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/90"><p className="text-sm text-zinc-300">Could not play this video.</p><button disabled={retrying} className="min-h-11 rounded-full border border-edge px-5 text-sm" onClick={()=>void retry()}>{retrying?'Loading…':'Try again'}</button></div>}
     </div>
    </div>
    <section aria-label="Chapter reminders" className="flex min-h-0 min-w-0 flex-1 flex-col">
     <div className="flex shrink-0 items-center justify-between px-3 pt-3 sm:px-5">
      <button className={control} aria-label="Previous chapter" disabled={chapter===0} onClick={()=>choose(chapter-1)}>‹</button>
      <p className="text-xs font-semibold uppercase tracking-widest text-cyan-glow">Chapter {chapter+1} of {edit.chapters.length}</p>
      <button className={control} aria-label="Next chapter" disabled={chapter===edit.chapters.length-1} onClick={()=>choose(chapter+1)}>›</button>
     </div>
     <div ref={pages} onScroll={onScroll} className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {edit.chapters.map((item,index)=><article key={index} aria-label={`Chapter ${index+1}`} aria-hidden={chapter!==index} className="h-full w-full shrink-0 snap-center overflow-y-auto px-6 pb-6 pt-2 sm:px-8">
       <h2 className="text-xl font-semibold leading-snug tracking-tight">{item.title}</h2>
       <div className="mt-5 space-y-4">{item.cues.map((cue,i)=><p key={i} className="text-base leading-relaxed text-zinc-300">{cue}</p>)}</div>
      </article>)}
     </div>
     <nav aria-label="Chapters" className="flex shrink-0 justify-center pb-3 pt-1">{edit.chapters.map((_,index)=><button key={index} aria-label={`Go to chapter ${index+1}`} aria-current={chapter===index?'step':undefined} className="flex h-9 w-8 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-cyan-glow" onClick={()=>choose(index)}><span className={'h-1.5 rounded-full transition-all '+(chapter===index?'w-5 bg-cyan-glow':'w-1.5 bg-zinc-600')}/></button>)}</nav>
    </section>
   </div>
  </div>
  <style jsx>{`
   @media (min-width: 900px), (orientation: landscape) and (max-height: 600px) {
    .lesson-playback-content { flex-direction: row; }
    .lesson-playback-video { width: 65%; flex-shrink: 1; container-type: size; }
    .lesson-playback-video > div { width: min(100%, 177.777cqh); }
   }
  `}</style>
 </dialog>;
}
