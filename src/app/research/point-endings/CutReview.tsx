'use client';
import {useEffect,useState} from 'react';
import {clock} from '@/lib/research/pointEndings';
import {startReference,startReviewComplete,type StartReview,type StartReviewCase} from '@/lib/research/startReview';
import {EMPTY_CUT_REVIEW,validCutReview,type CutBoundary,type CutReview as CutMarks} from '@/lib/research/cutReview';

const button='min-h-11 w-full rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40 sm:w-auto';
export function CutReview({value,initialOpen=false,start,end,ready,currentTime,onSeek,onChange,startCase,startReview,onStartReview}:{value?:CutMarks;startCase?:StartReviewCase;startReview?:StartReview;onStartReview?:(review:StartReview)=>void;initialOpen?:boolean;start:number;end:number;ready:boolean;currentTime:()=>number;onSeek:(time:number)=>void;onChange:(value:CutMarks)=>void}) {
 const [open,setOpen]=useState(initialOpen),[error,setError]=useState('');
 useEffect(()=>{if(initialOpen)setOpen(true);},[initialOpen]);
 const marks=value??EMPTY_CUT_REVIEW;
 const reference=startCase?startReference(value,startCase):null;
 const reviewed=startReviewComplete({cutReview:value,startReview},startCase);
 const stale=!!startReview&&startReview.outcome!==null&&!reviewed;
 function mark(field:'serveStart'|'pointEnd',time:CutBoundary) {
  const next={...marks,[field]:time};
  if(!validCutReview(next)){setError('The serve start must be before the point end. Move or clear the other mark first.');return;}
  setError('');onChange(next);
 }
 function markFrame(field:'serveStart'|'pointEnd') {const time=Math.min(end,Math.max(start,currentTime()));onSeek(time);mark(field,time);}
 return <div className="mt-4 border-t border-edge pt-3">
  <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm text-zinc-300" aria-expanded={open} aria-controls="cut-review" onClick={()=>setOpen(v=>!v)}><span>Cut timing <span className="text-zinc-500">(optional)</span></span><span aria-hidden>{open?'−':'+'}</span></button>
  {open&&<div id="cut-review" className="space-y-4 pt-2">
   {startCase&&<div className="space-y-3">
    <h3 className="text-sm font-medium text-zinc-200">Compare serve starts</h3>
    <dl className="space-y-2 text-sm tabular-nums">
     <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-zinc-400">{reference?.kind==='tap'?'Recorded serve tap':'Saved serve mark'}</dt><dd className="text-zinc-200">{reference?`${clock(reference.time-start)} into this point`:marks.serveStart==='uncertain'?'Cannot tell':'Not marked'}</dd></div>
     <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-zinc-400">Proposed clip start</dt><dd className="text-cyan-100">{clock(startCase.proposedStart-start)} into this point</dd></div>
     {reference&&<div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-zinc-400">Proposed start minus {reference.kind==='tap'?'tap':'mark'}</dt><dd className="text-zinc-200">{startCase.proposedStart-reference.time>=0?'+':'−'}{Math.abs(startCase.proposedStart-reference.time).toFixed(3)} s</dd></div>}
    </dl>
    <p className="text-sm text-zinc-400">{reference?.kind==='tap'?'The recorded serve tap is an earlier timing reference. ':''}Watch the serve to judge the proposed clip start. You can correct the serve mark below.</p>
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
     <button type="button" className={button} disabled={!ready||!reference} onClick={()=>{if(reference)onSeek(reference.time);}}>Go to {reference?.kind==='tap'?'recorded serve tap':'saved serve mark'}</button>
     <button type="button" className={button} disabled={!ready} onClick={()=>onSeek(startCase.proposedStart)}>Go to proposed start</button>
    </div>
    <label className="block text-sm text-zinc-300" htmlFor="start-review-outcome">Does the proposed start keep the serve?</label>
    <select id="start-review-outcome" className="w-full min-h-11 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-glow focus:outline-none" value={reviewed?startReview?.outcome??'':''} onChange={event=>onStartReview?.({runId:startCase.runId,outcome:(event.target.value||null) as StartReview['outcome'],observedServeStart:marks.serveStart})}>
     <option value="">Not reviewed</option><option value="yes">Yes</option><option value="no">No</option><option value="uncertain">Cannot tell</option>
    </select>
    {stale&&<p className="text-sm text-zinc-400">The serve mark changed after your previous answer. Review the proposed start again.</p>}
   </div>}
   <p className="text-sm text-zinc-400">Pause at each moment and mark it. Either answer can be skipped; these marks do not change your clips.</p>
   {([['serveStart','Serve starts','Start of the serving action, including the toss. Ignore preparation and practice bounces.'],['pointEnd','Point ends','When the point is visibly over, not the last legal bounce or your score tap.']] as const).map(([key,title,help])=><div key={key} className="space-y-2">
    <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
    <p className="text-xs text-zinc-400">{help}</p>
    <p className="text-sm tabular-nums text-cyan-100">{typeof marks[key]==='number'?`${clock((marks[key] as number)-start)} into this point`:marks[key]==='uncertain'?'Cannot tell from this clip':'Not marked'}</p>
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
     <button type="button" className={button} disabled={!ready} onClick={()=>markFrame(key)}>{key==='serveStart'?'Mark serve start here':'Mark point end here'}</button>
     <button type="button" className={button} disabled={!ready||typeof marks[key]!=='number'} onClick={()=>onSeek(marks[key] as number)}>Go to {key==='serveStart'?'serve start':'point end'}</button>
     <button type="button" className={button} onClick={()=>mark(key,'uncertain')}>Cannot tell {key==='serveStart'?'serve start':'point end'}</button>
     {marks[key]!==null&&<button type="button" className={button} onClick={()=>mark(key,null)}>Clear {key==='serveStart'?'serve start':'point end'}</button>}
    </div>
   </div>)}
   {error&&<p role="alert" className="text-sm text-rose-300">{error}</p>}
   <details className="text-xs text-zinc-400"><summary className="min-h-11 cursor-pointer py-3">Which frame ends the point?</summary><div className="space-y-2 pb-2"><p>Long or wide: the ball clearly misses the table. Net: the failed shot cannot continue, before the dead bounces.</p><p>Winner: the ball passes the receiver without a return, or bounces a second time. A net clip that lands legally can still be in play.</p><p>If the relevant moment is off screen or outside this clip, choose “Cannot tell” and optionally explain in the note.</p></div></details>
  </div>}
 </div>;
}
