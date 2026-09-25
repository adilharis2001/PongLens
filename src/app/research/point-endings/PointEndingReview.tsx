'use client';

import Link from 'next/link';
import {useEffect,useMemo,useRef,useState} from 'react';
import {clock,BOUNCE_KINDS,EMPTY_BOUNCE_REVIEW,sameEndingLabel,ENDING_REASONS,frameStep,nextUnlabeled,reasonText,savedLabel,validEndingLabel,type EndingLabel,type EndingRow} from '@/lib/research/pointEndings';
import {confirmSuggestions,displayLabel,pendingSuggestionKeys,reviewChangedFields,suggestionState} from '@/lib/research/endingSuggestions';
import {researchPlayers} from '@/lib/research/researchWinner';
import {LastBounceGuide} from './LastBounceGuide';
import {RallyPredictionReview} from './RallyPredictionReview';
import {finishRallyReview,confirmRallyBounce,rallyPending,reviewRallyBounce,withoutLegacyLastBounce} from '@/lib/research/rallyPredictions';
import {SuggestionHint} from './SuggestionHint';
import {EndingSaveQueue} from '@/lib/research/endingSaveQueue';
import type {EndingEvidence} from '@/lib/research/endingEvidence';
import {BallEvidence} from './BallEvidence';
import {BounceDetails} from './BounceDetails';
import {CutReview} from './CutReview';
import {OvernightResults} from './OvernightResults';
import {cutReviewComplete} from '@/lib/research/cutReview';
import {nextStartReview,startReviewWindow,startReviewComplete,startReviewRows,type StartReviewCase} from '@/lib/research/startReview';
import {CUT_REVIEW_POINTS} from '@/lib/research/cutReviewStudy';
import {PlaybackTimeline} from './PlaybackTimeline';

const field='w-full min-h-11 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-glow focus:outline-none';
const secondary='min-h-11 w-full rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40 sm:w-auto';
const mediaButton='min-h-11 rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40';
type SaveStatus={state:'saving'|'saved'|'error'|'draft';message?:string};

export function PointEndingReview({initialRows,initialCustom,initialCutReview=false,initialStartReview=false,startCases=[]}:{initialRows:EndingRow[];initialCustom:string[];initialCutReview?:boolean;initialStartReview?:boolean;startCases?:readonly StartReviewCase[]}) {
 const [rows,setRows]=useState(()=>initialRows.map(r=>({...r,suggestion:withoutLegacyLastBounce(r.suggestion,r.rallyPrediction)})));
 const rowsRef=useRef(rows);rowsRef.current=rows;
 const [selected,setSelected]=useState(()=>(initialStartReview?(nextStartReview(initialRows,startCases)??startReviewRows(initialRows,startCases)[0])?.id:undefined)??(initialCutReview?(initialRows.find(r=>CUT_REVIEW_POINTS.has(r.id)&&!cutReviewComplete(r.label.cutReview))??initialRows.find(r=>CUT_REVIEW_POINTS.has(r.id)))?.id:undefined)??initialRows.find(r=>rallyPending(r.label,r.rallyPrediction)&&!r.label.bounceReview?.lastBounce)?.id??initialRows.find(r=>pendingSuggestionKeys(r.label,r.suggestion).length>0)?.id??nextUnlabeled(initialRows)?.id??initialRows[0]?.id??'');
 const [matchId,setMatchId]=useState('all');
 const [filter,setFilter]=useState<'all'|'unlabeled'|'labeled'|'suggested'|'rally'|'cuts'|'starts'>(initialStartReview?'starts':initialCutReview?'cuts':'all');
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
 const [bounceOpenRequest,setBounceOpenRequest]=useState(0);
 const [bounceSelection,setBounceSelection]=useState({pointId:'',id:''});
 const [evidenceResult,setEvidenceResult]=useState<{id:string;data:EndingEvidence}|null>(null);
 const [evidenceError,setEvidenceError]=useState('');
 const [evidenceRetry,setEvidenceRetry]=useState(0);
 const evidenceCache=useRef(new Map<string,EndingEvidence>());
 const [playing,setPlaying]=useState(false);
 const [rate,setRate]=useState(1);
 const video=useRef<HTMLVideoElement>(null);
 const review=useRef<HTMLDivElement>(null);
 const cache=useRef(new Map<string,{url:string;expires:number}>());
 const point=rows.find(r=>r.id===selected)??rows[0];
 const pointRef=useRef(point);pointRef.current=point;
 const evidence=evidenceResult?.id===point?.id?evidenceResult?.data??null:null;
 const matches=useMemo(()=>Array.from(new Map((filter==='starts'?startReviewRows(rows,startCases):rows).map(r=>[r.match_id,r.source.matchName])).entries()),[rows,filter,startCases]);
 const matchRows=rows.filter(r=>matchId==='all'||r.match_id===matchId);
 const navigationRows=filter==='starts'?startReviewRows(matchRows,startCases):filter==='cuts'?matchRows.filter(r=>CUT_REVIEW_POINTS.has(r.id)):matchRows;
 const startRemaining=rows.filter(r=>startCases.some(item=>item.pointId===r.id)&&!startReviewComplete(r.label,startCases.find(item=>item.pointId===r.id))).length;
 const cutRemaining=rows.filter(r=>CUT_REVIEW_POINTS.has(r.id)&&!cutReviewComplete(r.label.cutReview)).length;
 const visible=matchRows.filter(r=>filter==='all'||(filter==='starts'?startCases.some(item=>item.pointId===r.id):filter==='cuts'?CUT_REVIEW_POINTS.has(r.id):filter==='rally'?rallyPending(r.label,r.rallyPrediction):filter==='suggested'?pendingSuggestionKeys(r.label,r.suggestion).length>0:(filter==='labeled')===savedLabel(r.label)));
 const suggestedPoints=rows.filter(r=>pendingSuggestionKeys(r.label,r.suggestion).length>0).length;
 const pending=point?pendingSuggestionKeys(point.label,point.suggestion):[];
 const shown=point?displayLabel(point.label,point.suggestion):undefined;
 const done=rows.filter(r=>savedLabel(r.label)).length;
 const selectedStatus=point?statuses[point.id]:undefined;
 const unfinishedSaves=Object.values(statuses).filter(s=>s.state!=='saved').length;

 function change(patch:Partial<EndingLabel>,saveNow=true) {
   const p=pointRef.current;if(!p)return;
   const label=reviewRallyBounce(p.label,reviewChangedFields(p.label,{...p.label,...patch},p.suggestion),p.rallyPrediction);
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
       if(state==='saved'&&(!draft||!ack||!sameEndingLabel(draft,ack)))return {...s,[p.id]:{state:'draft',message:'Finish editing the custom reason to save.'}};
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

 function seek(at:number){const v=video.current;if(!v||!point)return;v.pause();v.currentTime=Math.min(point.source.end,Math.max(startReviewWindow(point.source,startCases.find(item=>item.pointId===point.id)).start,at));}
 function seekEnding(){const p=pointRef.current;const v=video.current;if(!p||!v)return;v.pause();v.currentTime=Math.max(p.source.start,(p.source.tap??p.source.end)-4);}
 function seekInitial(){if(filter==='cuts'||filter==='starts')seek(startReviewWindow(point.source,startCases.find(item=>item.pointId===point.id)).start);else seekEnding();}
 useEffect(()=>{if(video.current?.readyState){seekInitial();setReady(true);}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[selected,url,filter]);
 useEffect(()=>{if(video.current)video.current.playbackRate=rate;},[rate,url]);
 useEffect(()=>{const v=video.current;return()=>{v?.pause();};},[url]);
 function play(){const v=video.current;if(!v||!point)return;if(!v.paused){v.pause();return;}if(v.currentTime>=point.source.end-0.05||v.currentTime<startReviewWindow(point.source,startCases.find(item=>item.pointId===point.id)).start)seekInitial();v.playbackRate=rate;void v.play().catch(()=>setMediaError('Video could not play. Reload the video to try again.'));}
 function confirm(keys?:string[],dismiss=false){const p=pointRef.current;if(p?.suggestion)change(confirmSuggestions(p.label,p.suggestion,keys,dismiss));}
 function next(){if(filter==='starts'){const next=nextStartReview(matchRows,startCases,selected);if(next)setSelected(next.id);return;}if(filter==='cuts'){const index=navigationRows.findIndex(r=>r.id===selected);const next=[...navigationRows.slice(index+1),...navigationRows.slice(0,index)].find(r=>!cutReviewComplete(r.label.cutReview));if(next)setSelected(next.id);return;}const index=matchRows.findIndex(r=>r.id===selected);const ordered=[...matchRows.slice(index+1),...matchRows.slice(0,index)];const p=ordered.find(r=>rallyPending(r.label,r.rallyPrediction))??ordered.find(r=>pendingSuggestionKeys(r.label,r.suggestion).length>0)??nextUnlabeled(matchRows,selected)??matchRows[index+1];if(p)setSelected(p.id);}
 function selectMatch(id:string){setMatchId(id);const list=rows.filter(r=>(id==='all'||r.match_id===id)&&(filter!=='cuts'||CUT_REVIEW_POINTS.has(r.id))&&(filter!=='starts'||startCases.some(item=>item.pointId===r.id)));setSelected((filter==='starts'?(nextStartReview(list,startCases)??list[0]):filter==='cuts'?(list.find(r=>!cutReviewComplete(r.label.cutReview))??list[0]):(list.find(r=>rallyPending(r.label,r.rallyPrediction))??list.find(r=>pendingSuggestionKeys(r.label,r.suggestion).length>0)??nextUnlabeled(list)??list[0]))?.id??'');}
 function retryVideo(){if(point)cache.current.delete(point.match_id);setMediaRetry(n=>n+1);}

 if(!point)return <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8"><h1 className="text-2xl font-semibold">Point-ending labels</h1><p className="mt-3 text-zinc-400">The study points have not been loaded yet.</p></main>;
 const {start,end}=startReviewWindow(point.source,startCases.find(item=>item.pointId===point.id));
 const customSelected=point.label.reason==='custom'&&customOptions.includes(point.label.custom);
 return <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 lg:px-6">
   <Link href="/research" onClick={e=>{if(unfinishedSaves){e.preventDefault();setExitBlocked(true);}}} className="text-sm text-zinc-400 hover:text-cyan-glow">← Research</Link>
   <h1 className="mt-3 text-2xl font-semibold text-white">Point-ending labels</h1>
   <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-zinc-300" aria-live="polite">
     <span className="tabular-nums">{done} labeled of {rows.length}</span>
     <span className="text-zinc-500">{rows.length-done} remaining</span>
     {rows.some(r=>r.rallyPrediction)&&<span className="text-amber-200">{rows.filter(r=>rallyPending(r.label,r.rallyPrediction)).length} last-bounce reviews remaining</span>}
     {suggestedPoints>0&&<span className="text-amber-200">{suggestedPoints} with suggestions to review</span>}
     <span className={unfinishedSaves?'text-amber-200':'text-zinc-500'}>{unfinishedSaves?`${unfinishedSaves} answer${unfinishedSaves===1?'':'s'} not yet saved`:'All answers saved'}</span>
   </div>
   <OvernightResults/>
   {exitBlocked&&unfinishedSaves>0&&<p role="alert" className="mt-3 text-sm text-amber-200">Wait for your answers to save, or retry an unsaved answer before leaving.</p>}
   <div className="mt-4 flex flex-wrap gap-2" aria-label="Matches">
     {[['all','All matches'],...matches].map(([id,name])=><button key={id} onClick={()=>selectMatch(id)} aria-pressed={matchId===id} className={`rounded-full border px-3 py-1.5 text-sm ${matchId===id?'border-cyan-glow/60 bg-cyan-500/15 text-cyan-100':'border-edge text-zinc-400 hover:border-zinc-500'}`}>{name}{id!=='all'&&<span className="ml-2 text-xs text-zinc-500">{rows.filter(r=>r.match_id===id&&savedLabel(r.label)).length}/{rows.filter(r=>r.match_id===id).length}</span>}</button>)}
   </div>
   <div className="mt-3 flex flex-wrap gap-2">
     {(['all','starts','cuts','rally','suggested','unlabeled','labeled'] as const).map(f=><button key={f} onClick={()=>{setFilter(f);if(f==='starts'){setMatchId('all');const first=nextStartReview(rows,startCases)??startReviewRows(rows,startCases)[0];if(first)setSelected(first.id);}if(f==='cuts'){setMatchId('all');const first=rows.find(r=>CUT_REVIEW_POINTS.has(r.id)&&!cutReviewComplete(r.label.cutReview))??rows.find(r=>CUT_REVIEW_POINTS.has(r.id));if(first)setSelected(first.id);}}} aria-pressed={filter===f} className={`rounded-full border px-3 py-1 text-sm ${filter===f?'border-cyan-glow/60 bg-cyan-500/15 text-cyan-100':'border-edge text-zinc-400'}`}>{f==='all'?'All points':f==='starts'?`Start-time disagreements · ${startRemaining}`:f==='cuts'?`Cuts to review · ${cutRemaining}`:f==='rally'?'Last bounce to review':f==='suggested'?'Suggestions to review':f==='unlabeled'?'Unlabeled':'Labeled'}</button>)}
   </div>
   <div ref={review} className="mt-4 scroll-mt-4 flex flex-col gap-6 lg:flex-row">
     <div className="min-w-0 flex-1">
       <div className="relative aspect-video overflow-hidden rounded-xl border border-edge bg-black">
         {url&&<video ref={video} src={url} playsInline preload="metadata" className="absolute inset-0 h-full w-full" onLoadedMetadata={()=>{seekInitial();setReady(true);if(video.current)video.current.playbackRate=rate;}} onTimeUpdate={e=>{const v=e.currentTarget;if(v.currentTime>=end&&!v.paused)v.pause();}} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>setMediaError('Could not play this video. Reload it to try again.')} />}
         {url&&<BallEvidence key={url} video={video} evidence={evidence} trail={showTrail} bounces={showBounces} review={point.label.bounceReview}/>}
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
           {evidence.bounces.map((b,i)=><button key={i} disabled={!ready} onClick={()=>{seek(b.t+evidence.rawOffset);setBounceSelection({pointId:point.id,id:`detected:${i}`});}} className="min-h-11 shrink-0 rounded-lg border border-edge px-3 py-2 text-xs tabular-nums text-amber-200 hover:border-zinc-500 disabled:opacity-40" aria-label={`Go to bounce ${i+1} at ${clock(b.t+evidence.rawOffset-start)} into point`}>{i+1} · {clock(b.t+evidence.rawOffset-start)}{shown?.bounceReview?.lastBounce===`detected:${i}`?' · Last':''}{point.rallyPrediction?.lastBounce?.id===`detected:${i}`?' · Experiment last':''}{shown?.bounceReview?.events.find(e=>e.id===`detected:${i}`)?` · ${BOUNCE_KINDS.find(([k])=>k===shown?.bounceReview?.events.find(e=>e.id===`detected:${i}`)?.kind)?.[1]}`:''}{point.suggestion&&suggestionState(point.label,point.suggestion,`event:detected:${i}`)==='pending'?' · Suggested':''}</button>)}
           {(point.label.bounceReview??EMPTY_BOUNCE_REVIEW).events.filter(e=>e.rawTime!==undefined).map(e=><button key={e.id} disabled={!ready} onClick={()=>{seek(e.rawTime!);setBounceSelection({pointId:point.id,id:e.id});}} className="min-h-11 shrink-0 rounded-lg border border-cyan-glow/50 px-3 py-2 text-xs tabular-nums text-cyan-100">Added · {clock(e.rawTime!-start)}{point.label.bounceReview?.lastBounce===e.id?' · Last':''}</button>)}
         </div>
         <p className="mt-1 text-xs text-zinc-500">Detected bounces may include paddle contacts or bounces off the table.</p>
       </div>}
       <PlaybackTimeline key={`${point.id}:${url}`} video={video} start={start} end={end} fps={point.source.fps} rawOffset={point.source.rawOffset} ready={ready} onSeek={seek}/>
       <div className="mt-3 flex flex-wrap gap-2">
         <button className={mediaButton} disabled={!ready} onClick={play}>{playing?'Pause':'Play'}</button>
         <button className={mediaButton} disabled={!ready} onClick={()=>seek(frameStep(video.current?.currentTime??start,-1,point.source.fps,start,end))} aria-label="Back one frame">−1 frame</button>
         <button className={mediaButton} disabled={!ready} onClick={()=>seek(frameStep(video.current?.currentTime??start,1,point.source.fps,start,end))} aria-label="Forward one frame">+1 frame</button>
         {[0.25,0.5,1].map(r=><button key={r} aria-pressed={rate===r} onClick={()=>setRate(r)} className={`${mediaButton} ${rate===r?'border-cyan-glow/60 text-cyan-100':''}`}>{r}×</button>)}
       </div>
       <div className="mt-3 flex flex-col gap-2 sm:flex-row">
         <button className={secondary} disabled={!ready} onClick={()=>{seekEnding();void video.current?.play();}}>Replay ending</button>
         <button className={secondary} disabled={!ready} onClick={()=>{seek(start);void video.current?.play();}}>Play whole point</button>
         {point.source.tap!==null&&<button className={secondary} disabled={!ready} onClick={()=>seek(point.source.tap!)}>Go to saved tap</button>}
       </div>
       <CutReview key={`cut:${point.id}`} value={point.label.cutReview} initialOpen={filter==='cuts'||filter==='starts'} startCase={startCases.find(item=>item.pointId===point.id)} startReview={point.label.startReview} onStartReview={startReview=>change({startReview})} start={start} end={end} ready={ready} currentTime={()=>video.current?.currentTime??start} onSeek={seek} onChange={cutReview=>change({cutReview})}/>
       <BounceDetails key={point.id} openRequest={bounceOpenRequest} value={point.label.bounceReview} suggestion={point.suggestion} suggestionReview={point.label.suggestionReview} onReviewSuggestion={confirm} evidence={evidence} start={start} end={end} ready={ready} selected={bounceSelection.pointId===point.id?bounceSelection.id:''} onSelect={id=>setBounceSelection({pointId:point.id,id})} onChange={bounceReview=>change({bounceReview})} onSeek={seek} currentTime={()=>video.current?.currentTime??start}/>
     </div>
     <div className="w-full shrink-0 lg:w-[340px]">
       <div className="space-y-4 rounded-xl border border-edge bg-surface-1 p-4">
         <div><h2 className="text-sm font-medium text-white">{point.source.matchName} · Point {point.source.number}</h2><p className="mt-1 text-xs text-zinc-500">Game {point.source.game} · Score before {point.source.scoreBefore.join('–')}</p></div>
         <div className="text-xs text-zinc-400"><p>Saved winner: {point.source.winner}</p>{point.source.server&&<p className="mt-1">Server: {point.source.server}</p>}<p className="mt-1">{point.source.tap===null?'No saved end tap':`Saved end tap: ${clock(point.source.tap-point.source.rawOffset)}`}</p></div>
         {point.rallyPrediction&&<RallyPredictionReview players={researchPlayers(point.match_id,point.source.game,point.source.number)} prediction={point.rallyPrediction} label={point.label} start={start} ready={ready} onSeek={()=>{const b=point.rallyPrediction?.lastBounce;if(b){seek(b.rawTime);if(b.origin==='detected')setBounceSelection({pointId:point.id,id:b.id});}}} onConfirm={()=>{const p=pointRef.current;if(p?.rallyPrediction)change(confirmRallyBounce(p.label,p.rallyPrediction));}} onKeep={()=>change(finishRallyReview(point.label,point.rallyPrediction!,'kept'))} onNoBounce={()=>change(finishRallyReview(point.label,point.rallyPrediction!,'no_live_bounce'))} onUncertain={()=>change(finishRallyReview(point.label,point.rallyPrediction!,'uncertain'))} onCorrect={()=>{const b=point.rallyPrediction?.lastBounce;setBounceSelection({pointId:point.id,id:b?.origin==='detected'?b.id:evidence?.bounces.length?'detected:0':''});setBounceOpenRequest(n=>n+1);document.getElementById('bounce-details-toggle')?.scrollIntoView({block:'center',behavior:'smooth'});}}/>}
         <label className="block text-sm text-zinc-300" htmlFor="ending-reason">How did the point end?</label>
         <select id="ending-reason" className={`${field} ${pending.includes('reason')?'border-amber-400/50 text-amber-100':''}`} value={customSelected?`custom:${point.label.custom}`:shown?.reason??''} onChange={e=>{const value=e.target.value;if(!value&&point.suggestion&&suggestionState(point.label,point.suggestion,'reason')==='pending'){confirm(['reason'],true);return;}if(value.startsWith('custom:'))change({reason:'custom',custom:value.slice(7)});else change({reason:(value||null) as EndingLabel['reason'],custom:''});}}>
           <option value="">Choose a reason</option>
           {ENDING_REASONS.map(([key,text])=><option key={key} value={key}>{text}</option>)}
           {customOptions.length>0&&<optgroup label="Your custom reasons">{customOptions.map(c=><option key={c} value={`custom:${c}`}>{c}</option>)}</optgroup>}
         </select>
         {point.suggestion&&<SuggestionHint state={suggestionState(point.label,point.suggestion,'reason')} detail={point.suggestion.reason.detail} onConfirm={()=>confirm(['reason'])}/>}
         {point.label.reason==='custom'&&<label className="block text-sm text-zinc-300">Custom reason<input className={`${field} mt-2`} maxLength={120} value={point.label.custom} onChange={e=>change({custom:e.target.value},false)} onBlur={()=>change({})} placeholder="Describe the ending"/></label>}
         <div>
           <label className="block text-sm text-zinc-300" htmlFor="last-rally-contact">Who made the last paddle contact during the rally? <span className="text-zinc-500">(optional)</span></label>
           <select id="last-rally-contact" className={`${field} mt-2 ${pending.includes('lastRallyContact')?'border-amber-400/50 text-amber-100':''}`} value={shown?.lastRallyContact??''} onChange={e=>{if(!e.target.value&&point.suggestion&&suggestionState(point.label,point.suggestion,'lastRallyContact')==='pending'){confirm(['lastRallyContact'],true);return;}change({lastRallyContact:(e.target.value||null) as EndingLabel['lastRallyContact']});}}>
             <option value="">Not specified</option>
             <option value="near">Player nearer the camera</option>
             <option value="far">Player farther from the camera</option>
             <option value="unsure">Cannot tell</option>
           </select>
           {point.suggestion&&<SuggestionHint state={suggestionState(point.label,point.suggestion,'lastRallyContact')} detail={point.suggestion.lastRallyContact.detail} onConfirm={()=>confirm(['lastRallyContact'])}/>}
         </div>
         <details className="text-xs text-zinc-400">
          <summary className="min-h-11 cursor-pointer py-3 text-zinc-300">Labeling help</summary>
          <div className="space-y-3 pb-2">
           <p>Changes save automatically. Amber answers are suggestions until you confirm or change them.</p>
           <p>Net endings include a ball that stays on the table or rolls off. A winner that bounces legally is “Legal bounce, then missed return or winner.”</p>
           <p>Last paddle contact includes attempted returns and mishits, but not collecting the ball after play ends.</p>
           <p>“Confirm this point’s suggestions” confirms ending, contact and bounce types. Confirm the last bounce separately.</p>
           <p>Winner confidence is the earlier winner model’s score, not a measured chance of being right. Net/out rules take priority; no score is shown if the model does not support that winner. The last-bounce model does not yet have a calibrated confidence score.</p>
           <LastBounceGuide/>
          </div>
         </details>
         <label className="block text-sm text-zinc-300">Note <span className="text-zinc-500">(optional)</span><textarea className={`${field} mt-2 resize-y`} rows={3} maxLength={4000} value={point.label.note} onChange={e=>change({note:e.target.value})}/></label>
         <div role="status" className={`text-xs ${selectedStatus?.state==='error'?'text-rose-300':selectedStatus?.state==='draft'?'text-amber-200':'text-zinc-400'}`}>{selectedStatus?.state==='saving'?'Saving…':selectedStatus?.state==='error'?selectedStatus.message:selectedStatus?.state==='draft'?selectedStatus.message:selectedStatus?.state==='saved'?'Saved':point.source.imported?'Carried over from your earlier review':savedLabel(point.label)?'Saved':'Not labeled yet'}</div>
         {selectedStatus?.state==='error'&&<button className={secondary} onClick={()=>writers.current.get(point.id)?.retry()}>Retry save</button>}
         {pending.length>0&&<div><button type="button" className="min-h-11 w-full rounded-lg bg-cyan-glow px-4 py-2 text-sm font-medium text-black" onClick={()=>confirm()}>Confirm this point’s suggestions</button></div>}
         <button className={pending.length?secondary:"min-h-11 w-full rounded-lg bg-cyan-glow px-4 py-2 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-40"} disabled={filter==='starts'?!nextStartReview(matchRows,startCases,selected):filter==='cuts'?!navigationRows.some(r=>r.id!==selected&&!cutReviewComplete(r.label.cutReview)):!matchRows.some(r=>r.id!==selected&&(rallyPending(r.label,r.rallyPrediction)||pendingSuggestionKeys(r.label,r.suggestion).length>0))&&!nextUnlabeled(matchRows,selected)} onClick={next}>{filter==='starts'?'Next start to review':filter==='cuts'?'Next cut to review':suggestedPoints||point.rallyPrediction?'Next point to review':'Next unlabeled point'}</button>
         <button className={secondary} disabled={navigationRows.findIndex(r=>r.id===selected)<=0} onClick={()=>{const i=navigationRows.findIndex(r=>r.id===selected);if(i>0)setSelected(navigationRows[i-1].id);}}>Previous point</button>
       </div>
     </div>
   </div>
   <details className="mt-5 text-xs text-zinc-500"><summary className="cursor-pointer">About the saved references</summary><p className="mt-2">Scores, servers and taps come from the study’s saved Scorekeeper record. A tap is a timing reference, not an exact physical ending. These labels do not change match scores.</p>{evidence&&<p className="mt-2">{evidence.lineage}</p>}</details>
   <div className="mt-6 border-t border-edge pt-4"><h2 className="text-sm font-medium text-zinc-300">{visible.length} points in this view</h2>
     <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
       {visible.map(r=><button key={r.id} aria-current={selected===r.id?'true':undefined} onClick={()=>{setSelected(r.id);review.current?.scrollIntoView({behavior:'smooth',block:'start'});}} className={`min-h-14 rounded-lg border px-3 py-2 text-left ${selected===r.id?'border-cyan-glow/60 bg-cyan-500/10':'border-edge hover:border-zinc-500'}`}><span className="block text-sm text-zinc-200">{r.source.matchName} · {r.source.number}</span><span className={`mt-1 block text-xs ${statuses[r.id]?.state==='error'?'text-rose-300':savedLabel(r.label)?'text-cyan-100':'text-zinc-500'}`}>{statuses[r.id]?.state==='error'?'Not saved':filter==='starts'?(startReviewComplete(r.label,startCases.find(item=>item.pointId===r.id))?'Start reviewed':'Start to review'):filter==='cuts'?(cutReviewComplete(r.label.cutReview)?'Cut timing reviewed':'Cut timing to review'):`${r.suggestion&&suggestionState(r.label,r.suggestion,'reason')==='pending'?'Suggested: ':''}${reasonText(displayLabel(r.label,r.suggestion))}`}{pendingSuggestionKeys(r.label,r.suggestion).length>0&&<span className="ml-2 text-amber-200">Review suggestions</span>}</span></button>)}
     </div>
   </div>
 </main>;
}
