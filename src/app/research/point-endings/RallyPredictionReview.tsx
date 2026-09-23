'use client';
import {clock,type EndingLabel} from '@/lib/research/pointEndings';
import {canConfirmRallyBounce,rallyPending,type RallyPrediction} from '@/lib/research/rallyPredictions';
const secondary='min-h-11 w-full rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40 sm:w-auto';
const side=(s:'near'|'far')=>s==='near'?'Player nearer the camera':'Player farther from the camera';
export function RallyPredictionReview({prediction:p,label,start,ready,onSeek,onConfirm,onKeep,onCorrect}:{prediction:RallyPrediction;label:EndingLabel;start:number;ready:boolean;onSeek:()=>void;onConfirm:()=>void;onKeep:()=>void;onCorrect:()=>void}){
 const b=p.lastBounce,w=p.winner,own=label.bounceReview?.lastBounce,pending=rallyPending(label,p);
 const ownEvent=label.bounceReview?.events.find(e=>e.id===own);
 const ownName=own?.startsWith('detected:')?`Bounce ${Number(own.slice(9))+1}`:ownEvent?.rawTime!==undefined?`Added bounce · ${clock(ownEvent.rawTime-start)}`:null;
 const state=pending?'New experiment':own===b?.id?'Confirmed suggestion':own?'Your correction':'Reviewed without a last-bounce mark';
 return <section aria-label="Trajectory experiment" className="space-y-3 border-t border-edge pt-4">
  <div><p className={`text-xs ${pending?'text-amber-200':'text-cyan-100'}`}>{state}</p><h3 className="mt-1 text-sm font-medium text-zinc-200">Last bounce suggestion</h3></div>
  <p className="text-sm text-amber-100">{b?`${b.origin==='detected'?`Bounce ${Number(b.id.slice(9))+1}`:'Inferred bounce'} · ${clock(b.rawTime-start)} into point`:'No last bounce could be identified'}</p>
  {ownName&&<p className="text-xs text-zinc-400">Your saved mark: {ownName}</p>}
  {b&&<button className={secondary} disabled={!ready} onClick={onSeek}>Go to suggested bounce</button>}
  {pending&&<div className="flex flex-col gap-2">
   {canConfirmRallyBounce(label,p)&&<button className="min-h-11 w-full rounded-lg bg-cyan-glow px-3 py-2 text-sm font-medium text-black hover:brightness-110" onClick={onConfirm}>Confirm last bounce</button>}
   {own&&<button className={secondary} onClick={onKeep}>Keep my last-bounce mark</button>}
   <button className={secondary} onClick={onCorrect}>Choose a different bounce</button>
   {!own&&<button className={secondary} onClick={onKeep}>Cannot identify the last bounce</button>}
  </div>}
  <div className="space-y-1 text-xs text-zinc-400">
   <p className="font-medium text-zinc-200">Trajectory winner prediction</p>
   <p>{w.side?side(w.side):'No prediction above the cutoff'}</p>
   <p className="tabular-nums">Model confidence score: {w.score===null?'Unavailable':`${(w.score*100).toFixed(1)} / 100`}</p>
   <p className="tabular-nums">Cutoff: {w.threshold===null?'No qualifying cutoff':`${(w.threshold*100).toFixed(1)} / 100`}{w.side?' · Passes cutoff':w.score!==null&&w.threshold!==null?' · Below cutoff':''}</p>
   <p>This score is not a measured probability of being right.</p>
  </div>
  <details className="text-xs text-zinc-400"><summary className="min-h-11 cursor-pointer py-3">About this experiment</summary>
   <div className="space-y-2 pb-2">
    {b&&<p>Last-bounce sequence agreement: {(b.agreement*100).toFixed(1)} / 100. This is agreement among the retained rally interpretations, not measured accuracy.</p>}
    <p>{b?.origin==='trajectory'?'The trajectory suggests a bounce where there is no matching detected marker. Confirming adds this frame to your bounce labels.':'Confirm the last table bounce during play. Ignore bounces after a failed net shot has ended the point.'}</p>
    <p>The winner score was produced with this recording excluded from training. Calibration against new recordings is still needed.</p>
    {p.baselineWinner&&<p>Earlier scoring rule: {side(p.baselineWinner)}. The combined experiment keeps that decision; the confidence score above belongs only to the trajectory winner model.</p>}
   </div>
  </details>
 </section>;
}
