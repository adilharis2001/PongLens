'use client';

import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {comparisonPlaybackWindow,comparisonReview,comparisonReviewAllowed,parseComparisonRow,sameComparisonReview,type ComparisonReview,type ComparisonRow,type TimingVerdict,type WinnerVerdict} from '@/lib/research/matchComparison';
import {readComparisonDraft,writeComparisonDraft,clearComparisonDraft} from '@/lib/research/matchComparisonDrafts';
import {clock,frameStep} from '@/lib/research/pointEndings';
import {PlaybackTimeline} from '../point-endings/PlaybackTimeline';

const field='w-full min-h-11 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-glow focus:outline-none';
const secondary='min-h-11 w-full rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40 sm:w-auto';
const primary='min-h-11 w-full rounded-lg bg-cyan-glow px-4 py-2 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-40';
type Status={state:'saving'|'saved'|'error'|'conflict';message?:string};

export function MatchComparisonReview({initialRows}:{initialRows:ComparisonRow[]}) {
 const [rows,setRows]=useState(initialRows);
 const [selected,setSelected]=useState(initialRows[0]?.id??'');
 const [match,setMatch]=useState('all');
 const [drafts,setDrafts]=useState<Record<string,ComparisonReview>>({});
 const [draftsReady,setDraftsReady]=useState(false);
 const [storageError,setStorageError]=useState('');
 const draftValues=useRef<Record<string,ComparisonReview>>({});
 const draftRevisions=useRef<Record<string,number>>({});
 const initialDraftRows=useRef(initialRows);
 const [statuses,setStatuses]=useState<Record<string,Status>>({});
 const [media,setMedia]=useState<{id:string;url:string}|null>(null);
 const [mediaError,setMediaError]=useState('');
 const [retry,setRetry]=useState(0);
 const [ready,setReady]=useState(false);
 const [playing,setPlaying]=useState(false);
 const [rate,setRate]=useState(1);
 const [exitBlocked,setExitBlocked]=useState(false);
 const video=useRef<HTMLVideoElement>(null);
 const comparisonContainer=useRef<HTMLDivElement>(null);
 const pending=useRef(new Set<string>());
 const playbackEnd=useRef(0);
 const point=rows.find(r=>r.id===selected)??rows[0];
 const source=point?.source;
 const visible=rows.filter(r=>match==='all'||r.match_id===match);
 const index=visible.findIndex(r=>r.id===point?.id);
 const review=point?(drafts[point.id]??comparisonReview(point.label)):null;
 const status=point?statuses[point.id]:undefined;
 const dirty=!!point&&!!review&&!sameComparisonReview(review,comparisonReview(point.label));
 const unsaved=rows.filter(r=>drafts[r.id]&&!sameComparisonReview(drafts[r.id],comparisonReview(r.label))).length;
 const url=media&&point&&media.id===point.id?media.url:null;
 const matches=Array.from(new Map(rows.map(r=>[r.match_id,r.source.matchName])).entries());

 useEffect(()=>{
  const restored:Record<string,ComparisonReview>={},conflicts:Record<string,Status>={};
  for(const row of initialDraftRows.current){
   try{
    const draft=readComparisonDraft(window.sessionStorage,row);
    if(draft.state==='none')continue;
    if(draft.state==='draft'&&sameComparisonReview(draft.review,comparisonReview(row.label))){clearComparisonDraft(window.sessionStorage,row.id,{revision:draft.revision,review:draft.review});continue;}
    restored[row.id]=draft.review;draftRevisions.current[row.id]=draft.revision;
    if(draft.state==='conflict')conflicts[row.id]={state:'conflict',message:'The saved review changed while you were away. Your draft is restored. Load the saved review before editing again.'};
   }catch{setStorageError('Drafts could not be restored in this tab. Save any new changes before leaving.');}
  }
  draftValues.current=restored;setDrafts(restored);setStatuses(s=>({...s,...conflicts}));setDraftsReady(true);
 },[]);
 useEffect(()=>{
  const beforeUnload=(event:BeforeUnloadEvent)=>{if(unsaved||pending.current.size){event.preventDefault();}};
  window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);
 },[unsaved]);
 useEffect(()=>{
  if(!point)return;const id=point.id;const abort=new AbortController();let cancelled=false;
  setMedia(null);setReady(false);setPlaying(false);setMediaError('');
  void (async()=>{
   try{const response=await fetch(`/api/research/match-comparison/media?id=${id}`,{signal:abort.signal});const data=await response.json();if(!response.ok||typeof data.url!=='string')throw Error(data.error??'Could not load video.');if(!cancelled)setMedia({id,url:data.url});}
   catch(error){if(!cancelled)setMediaError(error instanceof Error?error.message:'Could not load video.');}
  })();
  return()=>{cancelled=true;abort.abort();};
 },[point?.id,retry]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{const v=video.current;return()=>{v?.pause();};},[url]);
 useEffect(()=>{if(video.current)video.current.playbackRate=rate;},[rate,url]);
 useEffect(()=>{
  const v=video.current;if(!v||!source)return;let handle=0;
  const check=()=>{if(!v.paused&&v.currentTime>=playbackEnd.current){v.pause();v.currentTime=playbackEnd.current;}if(v.requestVideoFrameCallback)handle=v.requestVideoFrameCallback(check);};
  if(v.requestVideoFrameCallback)handle=v.requestVideoFrameCallback(check);
  return()=>{if(handle)v.cancelVideoFrameCallback(handle);};
 },[url,source]);

 function navigate(delta:number) {
  const next=visible[index+delta];if(!next)return;
  setSelected(next.id);
  requestAnimationFrame(()=>comparisonContainer.current?.scrollIntoView({block:'start',behavior:'smooth'}));
 }
 function change(patch:Partial<ComparisonReview>) {
  if(!point||!review||!draftsReady||pending.current.has(point.id))return;
  const next={...(draftValues.current[point.id]??comparisonReview(point.label)),...patch};
  const revision=draftRevisions.current[point.id]??point.revision;
  draftValues.current={...draftValues.current,[point.id]:next};draftRevisions.current[point.id]=revision;
  try{writeComparisonDraft(window.sessionStorage,point,next,revision);}catch{setStorageError('Drafts could not be stored in this tab. Save your changes before leaving.');}
  setDrafts(d=>({...d,[point.id]:next}));
  setStatuses(s=>s[point.id]?.state==='conflict'?s:Object.fromEntries(Object.entries(s).filter(([id])=>id!==point.id)));
 }
 function seek(at:number) {const v=video.current;if(!v||!source)return;v.pause();playbackEnd.current=source.preview.end;v.currentTime=Math.max(source.preview.start,Math.min(source.preview.end,at));}
 function playWindow(choice:'current'|'proposed') {
  const v=video.current;if(!v||!source)return;const window=comparisonPlaybackWindow(source,choice);if(!window)return;
  v.pause();v.currentTime=window.start;playbackEnd.current=window.end;v.playbackRate=rate;
  void v.play().catch(()=>setMediaError('Video could not play. Reload it to try again.'));
 }
 function playPause() {const v=video.current;if(!v||!source)return;if(!v.paused){v.pause();return;}if(v.currentTime>=playbackEnd.current||v.currentTime<source.preview.start){v.currentTime=source.preview.start;playbackEnd.current=source.preview.end;}void v.play().catch(()=>setMediaError('Video could not play. Reload it to try again.'));}
 async function save() {
  if(!point||!review||!draftsReady||status?.state==='conflict'||pending.current.has(point.id))return;
  const id=point.id,value={...review},revision=draftRevisions.current[point.id]??point.revision;
  pending.current.add(id);setStatuses(s=>({...s,[id]:{state:'saving'}}));
  try{
   const response=await fetch('/api/research/match-comparison',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,revision,review:value})});const data=await response.json();
   if(!response.ok){setStatuses(s=>({...s,[id]:{state:response.status===409?'conflict':'error',message:data.error??'Could not save. Your draft is still here.'}}));return;}
   const saved=parseComparisonRow({...point,...data.saved});
   if(saved.id!==id||saved.revision!==revision+1||!sameComparisonReview(comparisonReview(saved.label),value))throw Error('The save could not be confirmed. Your draft is still here.');
   try{clearComparisonDraft(window.sessionStorage,id,{revision,review:value});}catch{setStorageError('The review is saved, but its local draft could not be cleared.');}
   draftRevisions.current[id]=saved.revision;
   setRows(r=>r.map(row=>row.id===id?saved:row));setStatuses(s=>({...s,[id]:{state:'saved'}}));
  }catch(error){setStatuses(s=>({...s,[id]:{state:'error',message:error instanceof Error?error.message:'Could not save. Your draft is still here.'}}));}
  finally{pending.current.delete(id);}
 }
 async function loadSaved() {
  if(!point||pending.current.has(point.id))return;const id=point.id;pending.current.add(id);
  try{const response=await fetch(`/api/research/match-comparison?id=${id}`);const data=await response.json();if(!response.ok)throw Error(data.error??'Could not load the saved review.');const row=parseComparisonRow(data.row);if(row.id!==id)throw Error('Could not load the saved review.');try{clearComparisonDraft(window.sessionStorage,id);}catch{setStorageError('The saved review is loaded, but its local draft could not be cleared.');}draftValues.current[id]=comparisonReview(row.label);draftRevisions.current[id]=row.revision;setRows(r=>r.map(p=>p.id===id?row:p));setDrafts(d=>({...d,[id]:comparisonReview(row.label)}));setStatuses(s=>({...s,[id]:{state:'saved'}}));}
  catch(error){setStatuses(s=>({...s,[id]:{state:'conflict',message:error instanceof Error?error.message:'Could not load the saved review.'}}));}
  finally{pending.current.delete(id);}
 }
 if(!point||!source||!review)return <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 lg:px-6"><Link href="/research" className="text-sm text-zinc-400 hover:text-cyan-glow">← Research</Link><h1 className="mt-3 text-2xl font-semibold text-white">Match comparison</h1><p className="mt-3 text-zinc-400">No comparisons have been loaded yet.</p></main>;
 const busy=!draftsReady||status?.state==='saving';
 const timings=(kind:'start'|'end',title:string)=><label className="block text-sm text-zinc-300">{title} <span className="text-zinc-500">(optional)</span><select className={`${field} mt-2`} value={review[kind]??''} disabled={busy} onChange={e=>change({[kind]:(e.target.value||null) as TimingVerdict})}><option value="">Not reviewed</option><option value="current" disabled={!source.original}>Current is better</option><option value="proposed" disabled={!source.proposed}>Proposed is better</option><option value="both" disabled={!source.original||!source.proposed}>Both are fine</option><option value="neither">Neither is right</option><option value="unsure">Cannot tell</option></select></label>;
 return <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 lg:px-6">
  <Link href="/research" className="text-sm text-zinc-400 hover:text-cyan-glow" onClick={e=>{if(unsaved||pending.current.size){e.preventDefault();setExitBlocked(true);}}}>← Research</Link>
  <h1 className="mt-3 text-2xl font-semibold text-white">Match comparison</h1>
  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-400" aria-live="polite"><span>{rows.length} comparisons</span><span>{unsaved?`${unsaved} unsaved review${unsaved===1?'':'s'}`:'All changes saved'}</span></div>
  {exitBlocked&&unsaved>0&&<p role="alert" className="mt-3 text-sm text-amber-200">Save your drafts before leaving, or keep reviewing here.</p>}
  {storageError&&<p role="alert" className="mt-3 text-sm text-amber-200">{storageError}</p>}
  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
   <label className="block min-w-0 flex-1 text-sm text-zinc-300">Match<select className={`${field} mt-2`} value={match} onChange={e=>{const next=e.target.value;setMatch(next);setSelected(rows.find(r=>next==='all'||r.match_id===next)?.id??'');}}><option value="all">All matches</option>{matches.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
   <label className="block min-w-0 flex-1 text-sm text-zinc-300">Comparison<select className={`${field} mt-2`} value={point.id} onChange={e=>setSelected(e.target.value)}>{visible.map(r=><option key={r.id} value={r.id}>{r.source.matchName} · Point {r.source.number}</option>)}</select></label>
  </div>
  <div ref={comparisonContainer} className="mt-4 scroll-mt-4 flex flex-col gap-6 lg:flex-row">
   <div className="min-w-0 flex-1">
    <div className="relative aspect-video overflow-hidden rounded-xl border border-edge bg-black">
     {url&&<video key={point.id+url} ref={video} src={url} playsInline preload="metadata" className="absolute inset-0 h-full w-full" onLoadedMetadata={e=>{const v=e.currentTarget;v.currentTime=source.preview.start;v.playbackRate=rate;playbackEnd.current=source.preview.end;setReady(true);}} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onTimeUpdate={e=>{const v=e.currentTarget;if(!v.paused&&v.currentTime>=playbackEnd.current){v.pause();v.currentTime=playbackEnd.current;}}} onError={()=>{setReady(false);setMediaError('Could not play this video. Reload it to try again.');}}/>}
     {!ready&&!mediaError&&<div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">Loading video…</div>}
    </div>
    {mediaError&&<div role="alert" className="mt-3 space-y-2 text-sm text-rose-300"><p>{mediaError}</p><button className={secondary} onClick={()=>setRetry(n=>n+1)}>Reload video</button></div>}
    <PlaybackTimeline key={point.id+url} video={video} start={source.preview.start} end={source.preview.end} fps={source.fps} rawOffset={0} ready={ready} onSeek={seek}/>
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
     <button className={secondary} disabled={!ready} onClick={playPause}>{playing?'Pause':'Play'}</button>
     <button className={secondary} disabled={!ready} onClick={()=>seek(frameStep(video.current?.currentTime??source.preview.start,-1,source.fps,source.preview.start,source.preview.end))}>Back one frame</button>
     <button className={secondary} disabled={!ready} onClick={()=>seek(frameStep(video.current?.currentTime??source.preview.start,1,source.fps,source.preview.start,source.preview.end))}>Forward one frame</button>
     <label className="flex min-h-11 items-center gap-2 text-sm text-zinc-400">Speed<select aria-label="Playback speed" className={`${field} flex-1 sm:w-auto`} value={rate} onChange={e=>setRate(Number(e.target.value))}><option value={.25}>0.25×</option><option value={.5}>0.5×</option><option value={1}>1×</option></select></label>
    </div>
    <div className="mt-3 flex flex-col gap-2 sm:flex-row"><button className={secondary} disabled={!ready||!source.original} onClick={()=>playWindow('current')}>Play current</button><button className={secondary} disabled={!ready||!source.proposed} onClick={()=>playWindow('proposed')}>Play proposed</button></div>
    <div className="mt-4 space-y-2 text-sm tabular-nums text-zinc-400"><p>Current: {source.original?`${clock(source.original.start)} to ${clock(source.original.end)}`:'No matched point'}</p><p>Proposed: {source.proposed?`${clock(source.proposed.start)} to ${clock(source.proposed.end)}`:'No proposed point'}</p></div>
   </div>
   <div className="w-full shrink-0 lg:w-[340px]"><div className="space-y-4 rounded-xl border border-edge bg-surface-1 p-4">
    <div><h2 className="text-sm font-medium text-white">{source.matchName} · Point {source.number}</h2>{source.game!==null&&<p className="mt-1 text-xs text-zinc-500">Game {source.game}</p>}</div>
    <div className="space-y-2 text-sm text-zinc-300"><p>Predicted winner: {source.predictedWinner.name??'No prediction'}</p><p>Saved winner: {source.savedWinner.name??'Not available'}</p><p className="text-zinc-400">Winner confidence: {source.predictedWinner.decisionScore===null?'Not available':`${(source.predictedWinner.decisionScore*100).toFixed(1)} / 100`}</p><p className="text-xs text-zinc-500">Experimental scores are not measured accuracy.</p></div>
    {source.flags.length>0&&<ul className="space-y-2 text-sm text-amber-200">{source.flags.map((flag,i)=><li key={i}>{flag}</li>)}</ul>}
    {timings('start','Point start')}{timings('end','Point end')}
    <label className="block text-sm text-zinc-300">Winner <span className="text-zinc-500">(optional)</span><select className={`${field} mt-2`} value={review.winner??''} disabled={busy} onChange={e=>change({winner:(e.target.value||null) as WinnerVerdict})}><option value="">Not reviewed</option><option value="prediction" disabled={source.predictedWinner.side===null}>Prediction is right</option><option value="saved" disabled={source.savedWinner.name===null}>Saved winner is right</option><option value="neither">Neither is right</option><option value="unsure">Cannot tell</option></select></label>
    <label className="block text-sm text-zinc-300">Note <span className="text-zinc-500">(optional)</span><textarea className={`${field} mt-2 resize-y`} rows={3} maxLength={4000} value={review.note} disabled={busy} onChange={e=>change({note:e.target.value})}/></label>
    <p role="status" className={`text-xs ${status?.state==='error'||status?.state==='conflict'?'text-rose-300':dirty?'text-amber-200':'text-zinc-400'}`}>{!draftsReady?'Restoring drafts…':busy?'Saving…':status?.state==='error'||status?.state==='conflict'?status.message:dirty?'Changes not saved':status?.state==='saved'||point.label.comparisonReview?'Saved':'Not reviewed'}</p>
    {status?.state==='conflict'&&<button className={secondary} onClick={loadSaved}>Load saved review and discard this draft</button>}
    <button className={primary} disabled={busy||status?.state==='conflict'||!dirty||!comparisonReviewAllowed(review,source)} onClick={save}>{!draftsReady?'Restoring drafts…':busy?'Saving…':'Save review'}</button>
    <div className="flex flex-col gap-2 sm:flex-row"><button className={secondary} disabled={index<=0} onClick={()=>navigate(-1)}>Previous</button><button className={secondary} disabled={index<0||index>=visible.length-1} onClick={()=>navigate(1)}>Next comparison</button></div>
   </div></div>
  </div>
  <details className="mt-5 text-xs text-zinc-500"><summary className="min-h-11 cursor-pointer py-3 text-sm text-zinc-400">About this comparison</summary><div className="space-y-2"><p>{source.lineage}</p><p>{source.savedWinner.basis}</p><p>Near: {source.players.near}. Far: {source.players.far}.</p>{source.predictedWinner.branch&&<p>Prediction method: {source.predictedWinner.branch}</p>}{source.predictedWinner.threshold!==null&&<p>Model cutoff: {(source.predictedWinner.threshold*100).toFixed(1)} / 100.</p>}<p>Reviews stay in this research study. They do not change match scores or point cuts.</p></div></details>
 </main>;
}
