'use client';

import Link from 'next/link';
import {useEffect,useMemo,useRef,useState} from 'react';
import {clock,ENDING_REASONS,frameStep,nextUnlabeled,reasonText,savedLabel,validEndingLabel,type EndingLabel,type EndingRow} from '@/lib/research/pointEndings';
import {EndingSaveQueue} from '@/lib/research/endingSaveQueue';
import type {EndingEvidence} from '@/lib/research/endingEvidence';
import {BallEvidence} from './BallEvidence';

const field='w-full min-h-11 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-glow focus:outline-none';
const secondary='min-h-11 w-full rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40 sm:w-auto';
const mediaButton='min-h-11 rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40';
type SaveStatus={state:'saving'|'saved'|'error'|'draft';message?:string};

export function PointEndingReview({initialRows,initialCustom}:{initialRows:EndingRow[];initialCustom:string[]}) {
 const [rows,setRows]=useState(initialRows);
 const rowsRef=useRef(rows);rowsRef.current=rows;
 const [selected,setSelected]=useState(()=>nextUnlabeled(initialRows)?.id??initialRows[0]?.id??'');
 const [matchId,setMatchId]=useState('all');
 const [filter,setFilter]=useState<'all'|'unlabeled'|'labeled'>('all');
 const [statuses,setStatuses]=useState<Record<string,SaveStatus>>({});
 const [exitBlocked,setExitBlocked]=useState(false);
 const writers=useRef(new Map<string,EndingSaveQueue>());
 const acknowledged=useRef(new Map(initialRows.map(r=>[r.id,r.label])));
 const [customOptions,setCustomOptions]=useState(initialCustom);
 const [url,setUrl]=useState<string|null>(null);
 const [mediaError,setMediaError]=useState('');
 const [mediaRetry,setMediaRetry]=useState(0);
 const [ready,setReady]=useState(false);
 const [showTrail,setShowTrail]=useState(true);
 const [showBounces,setShowBounces]=useState(true);
 const [evidenceResult,setEvidenceResult]=useState<{id:string;data:EndingEvidence}|null>(null);
 const [evidenceError,setEvidenceError]=useState('');
 const [evidenceRetry,setEvidenceRetry]=useState(0);
 const evidenceCache=useRef(new Map<string,EndingEvidence>());
 const [time,setTime]=useState(0);
 const [playing,setPlaying]=useState(false);
 const [rate,setRate]=useState(1);
 const video=useRef<HTMLVideoElement>(null);
 const review=useRef<HTMLDivElement>(null);
 const cache=useRef(new Map<string,{url:string;expires:number}>());
 const point=rows.find(r=>r.id===selected)??rows[0];
 const pointRef=useRef(point);pointRef.current=point;
 const evidence=evidenceResult?.id===point?.id?evidenceResult?.data??null:null;
 const matches=useMemo(()=>Array.from(new Map(rows.map(r=>[r.match_id,r.source.matchName])).entries()),[rows]);
 const matchRows=rows.filter(r=>matchId==='all'||r.match_id===matchId);
 const visible=matchRows.filter(r=>filter==='all'||(filter==='labeled')===savedLabel(r.label));
 const done=rows.filter(r=>savedLabel(r.label)).length;
 const selectedStatus=point?statuses[point.id]:undefined;
 const unfinishedSaves=Object.values(statuses).filter(s=>s.state!=='saved').length;

 function change(patch:Partial<EndingLabel>,saveNow=true) {
   const p=pointRef.current;if(!p)return;
   const label={...p.label,...patch};
   if(saveNow)label.custom=label.custom.trim();
   // Update the ref synchronously: consecutive events cannot erase an earlier field.
   const next=rowsRef.current.map(r=>r.id===p.id?{...r,label}:r);
   rowsRef.current=next;pointRef.current={...p,label};setRows(next);
   if(!saveNow||!validEndingLabel(label)) {setStatuses(s=>s[p.id]?.state==='error'?s:({...s,[p.id]:{state:'draft',message:label.custom.trim()?'Finish editing the custom reason to save.':'Enter your custom reason to save.'}}));return;}
   let writer=writers.current.get(p.id);
   if(!writer){
     writer=new EndingSaveQueue(p.revision,async(value,revision)=>{
       const res=await fetch('/api/research/point-endings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:p.id,revision,label:value})});
       const result=await res.json();
       if(!res.ok)throw new Error(result.error??'Could not save. Try again.');
       if(value.reason==='custom')setCustomOptions(options=>Array.from(new Set([...options,value.custom.trim()])).sort());
       acknowledged.current.set(p.id,result.saved.label);
       return result.saved;
     },(state,message)=>setStatuses(s=>{
       const draft=rowsRef.current.find(r=>r.id===p.id)?.label;
       const ack=acknowledged.current.get(p.id);
       if(state==='saved'&&(draft?.reason!==ack?.reason||draft?.custom!==ack?.custom||draft?.note!==ack?.note))return {...s,[p.id]:{state:'draft',message:'Finish editing the custom reason to save.'}};
       return {...s,[p.id]:{state,message}};
     }));
     writers.current.set(p.id,writer);
   }
   writer.set(label);
 }

 useEffect(()=>{
   const beforeUnload=(event:BeforeUnloadEvent)=>{if(Object.values(statuses).some(s=>s.state!=='saved')){event.preventDefault();}};
   window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);
 },[statuses]);

 useEffect(()=>{
   if(!point)return;
   let cancelled=false;
   const abort=new AbortController();
   setUrl(null);setReady(false);setMediaError('');
   const stored=cache.current.get(point.match_id);
   if(stored&&stored.expires>Date.now()){setUrl(stored.url);return;}
   void (async()=>{
     try{
       const res=await fetch(`/api/research/point-endings/media?id=${point.id}`,{signal:abort.signal});
       const data=await res.json();if(!res.ok||!data.url)throw Error(data.error??'Could not load video.');
       if(cancelled)return;
       cache.current.set(point.match_id,{url:data.url,expires:Date.now()+50*60*1000});setUrl(data.url);
     }catch(error){if(!cancelled)setMediaError(error instanceof Error?error.message:'Could not load video.');}
   })();
   return()=>{cancelled=true;abort.abort();};
   // One signed original per match. Point changes seek within that same video.
   // eslint-disable-next-line react-hooks/exhaustive-deps
 },[point?.match_id,mediaRetry]);

 useEffect(()=>{
   if(!point)return;
   const id=point.id,abort=new AbortController();let cancelled=false;
   setEvidenceError('');
   const cached=evidenceCache.current.get(id);
   if(cached){setEvidenceResult({id,data:cached});return;}
   void (async()=>{
     try{
       const response=await fetch(`/api/research/point-endings/evidence?id=${id}`,{signal:abort.signal});
       const result=await response.json();
       if(!response.ok||result.id!==id||!result.evidence)throw Error(result.error??'Could not load ball evidence.');
       if(cancelled)return;
       evidenceCache.current.set(id,result.evidence);setEvidenceResult({id,data:result.evidence});
     }catch(error){if(!cancelled)setEvidenceError(error instanceof Error?error.message:'Could not load ball evidence.');}
   })();
   return()=>{cancelled=true;abort.abort();};
 },[point?.id,evidenceRetry]);

 function seek(at:number){const v=video.current;if(!v||!point)return;v.pause();v.currentTime=Math.min(point.source.end,Math.max(point.source.start,at));setTime(v.currentTime);}
 function seekEnding(){const p=pointRef.current;const v=video.current;if(!p||!v)return;v.pause();v.currentTime=Math.max(p.source.start,(p.source.tap??p.source.end)-4);setTime(v.currentTime);}
 useEffect(()=>{if(video.current?.readyState){seekEnding();setReady(true);}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[selected,url]);
 useEffect(()=>{if(video.current)video.current.playbackRate=rate;},[rate,url]);
 useEffect(()=>{const v=video.current;return()=>{v?.pause();};},[url]);
 function play(){const v=video.current;if(!v||!point)return;if(!v.paused){v.pause();return;}if(v.currentTime>=point.source.end-0.05||v.currentTime<point.source.start)seekEnding();v.playbackRate=rate;void v.play().catch(()=>setMediaError('Video could not play. Reload the video to try again.'));}
 function next(){const index=matchRows.findIndex(r=>r.id===selected);const p=nextUnlabeled(matchRows,selected)??matchRows[index+1];if(p)setSelected(p.id);}
 function selectMatch(id:string){setMatchId(id);const list=rows.filter(r=>id==='all'||r.match_id===id);setSelected((nextUnlabeled(list)??list[0])?.id??'');}
 function retryVideo(){if(point)cache.current.delete(point.match_id);setMediaRetry(n=>n+1);}

 if(!point)return <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8"><h1 className="text-2xl font-semibold">Point-ending labels</h1><p className="mt-3 text-zinc-400">The study points have not been loaded yet.</p></main>;
 const start=point.source.start,end=point.source.end;
 const customSelected=point.label.reason==='custom'&&customOptions.includes(point.label.custom);
 return <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 lg:px-6">
   <Link href="/research" onClick={e=>{if(unfinishedSaves){e.preventDefault();setExitBlocked(true);}}} className="text-sm text-zinc-400 hover:text-cyan-glow">← Research</Link>
   <h1 className="mt-3 text-2xl font-semibold text-white">Point-ending labels</h1>
   <p className="mt-1 max-w-3xl text-sm text-zinc-400">Choose how each point ended. Your answers and notes save automatically, so you can return at any time.</p>
   <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-zinc-300" aria-live="polite">
     <span className="tabular-nums">{done} labeled of {rows.length}</span>
     <span className="text-zinc-500">{rows.length-done} remaining</span>
     <span className={unfinishedSaves?'text-amber-200':'text-zinc-500'}>{unfinishedSaves?`${unfinishedSaves} answer${unfinishedSaves===1?'':'s'} not yet saved`:'All answers saved'}</span>
   </div>
   {exitBlocked&&unfinishedSaves>0&&<p role="alert" className="mt-3 text-sm text-amber-200">Wait for your answers to save, or retry an unsaved answer before leaving.</p>}
   <div className="mt-4 flex flex-wrap gap-2" aria-label="Matches">
     {[['all','All matches'],...matches].map(([id,name])=><button key={id} onClick={()=>selectMatch(id)} aria-pressed={matchId===id} className={`rounded-full border px-3 py-1.5 text-sm ${matchId===id?'border-cyan-glow/60 bg-cyan-500/15 text-cyan-100':'border-edge text-zinc-400 hover:border-zinc-500'}`}>{name}{id!=='all'&&<span className="ml-2 text-xs text-zinc-500">{rows.filter(r=>r.match_id===id&&savedLabel(r.label)).length}/{rows.filter(r=>r.match_id===id).length}</span>}</button>)}
   </div>
   <div className="mt-3 flex flex-wrap gap-2">
     {(['all','unlabeled','labeled'] as const).map(f=><button key={f} onClick={()=>setFilter(f)} aria-pressed={filter===f} className={`rounded-full border px-3 py-1 text-sm ${filter===f?'border-cyan-glow/60 bg-cyan-500/15 text-cyan-100':'border-edge text-zinc-400'}`}>{f==='all'?'All points':f==='unlabeled'?'Unlabeled':'Labeled'}</button>)}
   </div>
   <div ref={review} className="mt-4 scroll-mt-4 flex flex-col gap-6 lg:flex-row">
     <div className="min-w-0 flex-1">
       <div className="relative aspect-video overflow-hidden rounded-xl border border-edge bg-black">
         {url&&<video ref={video} src={url} playsInline preload="metadata" className="absolute inset-0 h-full w-full" onLoadedMetadata={()=>{seekEnding();setReady(true);if(video.current)video.current.playbackRate=rate;}} onTimeUpdate={e=>{const v=e.currentTarget;setTime(v.currentTime);if(v.currentTime>=end&&!v.paused)v.pause();}} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>setMediaError('Could not play this video. Reload it to try again.')} />}
         {url&&<BallEvidence key={url} video={video} evidence={evidence} trail={showTrail} bounces={showBounces}/>}
         {!ready&&!mediaError&&<div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">Loading video…</div>}
       </div>
       {mediaError&&<div role="alert" className="mt-3 space-y-2 text-sm text-rose-300"><p>{mediaError}</p><button className={secondary} onClick={retryVideo}>Reload video</button></div>}
       <div className="mt-2 flex flex-wrap items-center gap-2">
         <button type="button" aria-pressed={showTrail} onClick={()=>setShowTrail(v=>!v)} className={`rounded-full border px-3 py-1.5 text-xs ${showTrail?'border-yellow-400/50 text-yellow-200':'border-edge text-zinc-400'}`}>Ball trail</button>
         <button type="button" aria-pressed={showBounces} onClick={()=>setShowBounces(v=>!v)} className={`rounded-full border px-3 py-1.5 text-xs ${showBounces?'border-amber-400/50 text-amber-200':'border-edge text-zinc-400'}`}>Detected bounces</button>
         {!evidence&&!evidenceError&&<span className="text-xs text-zinc-500">Loading ball evidence…</span>}
       </div>
       {evidenceError&&<div role="alert" className="mt-2 text-sm text-rose-300">{evidenceError} <button className={secondary} onClick={()=>setEvidenceRetry(n=>n+1)}>Retry ball evidence</button></div>}
       {evidence&&showBounces&&<div className="mt-2">
         <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Jump to detected bounce">
           {evidence.bounces.map((b,i)=><button key={i} disabled={!ready} onClick={()=>seek(b.t+evidence.rawOffset)} className="min-h-11 shrink-0 rounded-lg border border-edge px-3 py-2 text-xs tabular-nums text-amber-200 hover:border-zinc-500 disabled:opacity-40" aria-label={`Go to bounce ${i+1} at ${clock(b.t+evidence.rawOffset-start)} into point`}>{i+1} · {clock(b.t+evidence.rawOffset-start)}</button>)}
         </div>
         <p className="mt-1 text-xs text-zinc-500">Detected bounces may include paddle contacts or bounces off the table.</p>
       </div>}
       <label className="mt-3 block text-xs text-zinc-400">Point playback<input aria-label="Point playback" className="mt-2 block w-full accent-cyan-400" type="range" min={start} max={end} step={1/point.source.fps} value={Math.max(start,Math.min(end,time))} onChange={e=>seek(Number(e.target.value))} disabled={!ready}/></label>
       <div className="mt-2 flex items-center justify-between text-xs tabular-nums text-zinc-500"><span>Point {clock(Math.max(0,time-start))} / {clock(end-start)}</span><span>Match {clock(Math.max(0,time-point.source.rawOffset))}</span></div>
       <div className="mt-3 flex flex-wrap gap-2">
         <button className={mediaButton} disabled={!ready} onClick={play}>{playing?'Pause':'Play'}</button>
         <button className={mediaButton} disabled={!ready} onClick={()=>seek(frameStep(time,-1,point.source.fps,start,end))} aria-label="Back one frame">−1 frame</button>
         <button className={mediaButton} disabled={!ready} onClick={()=>seek(frameStep(time,1,point.source.fps,start,end))} aria-label="Forward one frame">+1 frame</button>
         {[0.25,0.5,1].map(r=><button key={r} aria-pressed={rate===r} onClick={()=>setRate(r)} className={`${mediaButton} ${rate===r?'border-cyan-glow/60 text-cyan-100':''}`}>{r}×</button>)}
       </div>
       <div className="mt-3 flex flex-col gap-2 sm:flex-row">
         <button className={secondary} disabled={!ready} onClick={()=>{seekEnding();void video.current?.play();}}>Replay ending</button>
         <button className={secondary} disabled={!ready} onClick={()=>{seek(start);void video.current?.play();}}>Play whole point</button>
         {point.source.tap!==null&&<button className={secondary} disabled={!ready} onClick={()=>seek(point.source.tap!)}>Go to saved tap</button>}
       </div>
     </div>
     <div className="w-full shrink-0 lg:w-[340px]">
       <div className="space-y-4 rounded-xl border border-edge bg-surface-1 p-4">
         <div><h2 className="text-sm font-medium text-white">{point.source.matchName} · Point {point.source.number}</h2><p className="mt-1 text-xs text-zinc-500">Game {point.source.game} · Score before {point.source.scoreBefore.join('–')}</p></div>
         <div className="text-xs text-zinc-400"><p>Saved winner: {point.source.winner}</p>{point.source.server&&<p className="mt-1">Server: {point.source.server}</p>}<p className="mt-1">{point.source.tap===null?'No saved end tap':`Saved end tap: ${clock(point.source.tap-point.source.rawOffset)}`}</p></div>
         <label className="block text-sm text-zinc-300" htmlFor="ending-reason">How did the point end?</label>
         <select id="ending-reason" className={field} value={customSelected?`custom:${point.label.custom}`:point.label.reason??''} onChange={e=>{const value=e.target.value;if(value.startsWith('custom:'))change({reason:'custom',custom:value.slice(7)});else change({reason:(value||null) as EndingLabel['reason'],custom:''});}}>
           <option value="">Choose a reason</option>
           {ENDING_REASONS.map(([key,text])=><option key={key} value={key}>{text}</option>)}
           {customOptions.length>0&&<optgroup label="Your custom reasons">{customOptions.map(c=><option key={c} value={`custom:${c}`}>{c}</option>)}</optgroup>}
         </select>
         {point.label.reason==='net'&&<p className="text-xs text-zinc-400">Includes the ball staying on the table or rolling off after hitting the net.</p>}
         {point.label.reason==='missed_return'&&<p className="text-xs text-zinc-400">Includes an opponent’s winner that bounced legally and could not be reached.</p>}
         {point.label.reason==='custom'&&<label className="block text-sm text-zinc-300">Custom reason<input className={`${field} mt-2`} maxLength={120} value={point.label.custom} onChange={e=>change({custom:e.target.value},false)} onBlur={()=>change({})} placeholder="Describe the ending"/><span className="mt-1 block text-xs text-zinc-500">Saved reasons are available on every point.</span></label>}
         <label className="block text-sm text-zinc-300">Note <span className="text-zinc-500">(optional)</span><textarea className={`${field} mt-2 resize-y`} rows={3} maxLength={4000} value={point.label.note} onChange={e=>change({note:e.target.value})}/></label>
         <div role="status" className={`text-xs ${selectedStatus?.state==='error'?'text-rose-300':selectedStatus?.state==='draft'?'text-amber-200':'text-zinc-400'}`}>{selectedStatus?.state==='saving'?'Saving…':selectedStatus?.state==='error'?selectedStatus.message:selectedStatus?.state==='draft'?selectedStatus.message:selectedStatus?.state==='saved'?'Saved':point.source.imported?'Carried over from your earlier review':savedLabel(point.label)?'Saved':'Not labeled yet'}</div>
         {selectedStatus?.state==='error'&&<button className={secondary} onClick={()=>writers.current.get(point.id)?.retry()}>Retry save</button>}
         <button className="min-h-11 w-full rounded-lg bg-cyan-glow px-4 py-2 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-40" disabled={!nextUnlabeled(matchRows,selected)} onClick={next}>Next unlabeled point</button>
         <button className={secondary} disabled={matchRows.findIndex(r=>r.id===selected)<=0} onClick={()=>{const i=matchRows.findIndex(r=>r.id===selected);if(i>0)setSelected(matchRows[i-1].id);}}>Previous point</button>
       </div>
     </div>
   </div>
   <details className="mt-5 text-xs text-zinc-500"><summary className="cursor-pointer">About the saved references</summary><p className="mt-2">Scores, servers and taps come from the study’s saved Scorekeeper record. A tap is a timing reference, not an exact physical ending. These labels do not change match scores.</p>{evidence&&<p className="mt-2">{evidence.lineage}</p>}</details>
   <div className="mt-6 border-t border-edge pt-4"><h2 className="text-sm font-medium text-zinc-300">{visible.length} points in this view</h2>
     <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
       {visible.map(r=><button key={r.id} aria-current={selected===r.id?'true':undefined} onClick={()=>{setSelected(r.id);review.current?.scrollIntoView({behavior:'smooth',block:'start'});}} className={`min-h-14 rounded-lg border px-3 py-2 text-left ${selected===r.id?'border-cyan-glow/60 bg-cyan-500/10':'border-edge hover:border-zinc-500'}`}><span className="block text-sm text-zinc-200">{r.source.matchName} · {r.source.number}</span><span className={`mt-1 block text-xs ${statuses[r.id]?.state==='error'?'text-rose-300':savedLabel(r.label)?'text-cyan-100':'text-zinc-500'}`}>{statuses[r.id]?.state==='error'?'Not saved':reasonText(r.label)}</span></button>)}
     </div>
   </div>
 </main>;
}
