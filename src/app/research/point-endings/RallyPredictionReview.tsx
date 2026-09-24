'use client';
import {clock,type EndingLabel} from '@/lib/research/pointEndings';
import {canConfirmRallyBounce,rallyPending,type RallyPrediction} from '@/lib/research/rallyPredictions';
import {LastBounceGuide} from './LastBounceGuide';
const secondary='min-h-11 w-full rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40 sm:w-auto';
const side=(s:'near'|'far')=>s==='near'?'Player nearer the camera':'Player farther from the camera';
export function RallyPredictionReview({prediction:p,label,start,ready,onSeek,onConfirm,onKeep,onNoBounce,onUncertain,onCorrect}:{prediction:RallyPrediction;label:EndingLabel;start:number;ready:boolean;onSeek:()=>void;onConfirm:()=>void;onKeep:()=>void;onNoBounce:()=>void;onUncertain:()=>void;onCorrect:()=>void}){
 const b=p.lastBounce,w=p.winner,own=label.bounceReview?.lastBounce,pending=rallyPending(label,p);
 const ownEvent=label.bounceReview?.events.find(e=>e.id===own);
 const ownName=own?.startsWith('detected:')?`Bounce ${Number(own.slice(9))+1}`:ownEvent?.rawTime!==undefined?`Added bounce · ${clock(ownEvent.rawTime-start)}`:null;
 const state=pending?'New experiment':own&&own===b?.id?'Confirmed suggestion':own?'Your correction':label.rallyReview?.outcome==='no_live_bounce'?'Reviewed: no live table bounce':label.rallyReview?.outcome==='uncertain'?'Reviewed: cannot tell':'Reviewed without a last-bounce mark';
 return <section aria-label="Last-bounce experiment" className="space-y-3 border-t border-edge pt-4">
  <div><p className={`text-xs ${pending?'text-amber-200':'text-cyan-100'}`}>{state}</p><h3 className="mt-1 text-sm font-medium text-zinc-200">Last playable bounce suggestion</h3></div>
  <p className="text-sm text-amber-100">{b?`${b.origin==='detected'?`Bounce ${Number(b.id.slice(9))+1}`:'Inferred bounce'} · ${clock(b.rawTime-start)} into point`:'No last bounce could be identified'}</p>
  {p.ranking&&<div className="space-y-1 text-xs text-zinc-400">
   <p className="text-zinc-200">{p.ranking.method==='ball_pose'?'Ball path + body pose':p.ranking.method==='ball_only'?'Ball path only':'No bounce candidate'}</p>
   {p.ranking.method==='ball_only'&&<p>{p.ranking.reason==='missing_pose'?'Pose evidence is unavailable for this point.':'Pose evidence is too incomplete for this point.'}</p>}
   <p>Ranking margin: <span className="tabular-nums">{p.ranking.margin===null?'Unavailable':p.ranking.margin.toFixed(2)}</span></p>
   <p>This measures separation from the next candidate, not the chance of being correct.</p>
  </div>}
  <LastBounceGuide/>
  {ownName&&<p className="text-xs text-zinc-400">Your saved mark: {ownName}</p>}
  {b&&<button className={secondary} disabled={!ready} onClick={onSeek}>Go to suggested bounce</button>}
  <div className="flex flex-col gap-2">
   {pending&&canConfirmRallyBounce(label,p)&&<button className="min-h-11 w-full rounded-lg bg-cyan-glow px-3 py-2 text-sm font-medium text-black hover:brightness-110" onClick={onConfirm}>Confirm last bounce</button>}
   {pending&&own&&<button className={secondary} onClick={onKeep}>Keep my last-bounce mark</button>}
   <button className={secondary} onClick={onCorrect}>Choose a different bounce</button>
   <details className="text-xs text-zinc-400"><summary className="min-h-11 cursor-pointer py-3">No bounce to mark?</summary><div className="flex flex-col gap-2"><button className={secondary} onClick={onNoBounce}>{own?'Clear my mark: no live table bounce':'No live table bounce occurred'}</button><button className={secondary} onClick={onUncertain}>{own?'Clear my mark: cannot tell':'Cannot tell from this footage'}</button></div></details>
  </div>
  <div className="space-y-1 text-xs text-zinc-400">
   <p className="font-medium text-zinc-200">Previous winner experiment</p>
   <p>{w.side?side(w.side):'No prediction above the cutoff'}</p>
   <p className="tabular-nums">Winner model score: {w.score===null?'Unavailable':`${(w.score*100).toFixed(1)} / 100`}</p>
   <p className="tabular-nums">Cutoff: {w.threshold===null?'No qualifying cutoff':`${(w.threshold*100).toFixed(1)} / 100`}{w.side?' · Passes cutoff':w.score!==null&&w.threshold!==null?' · Below cutoff':''}</p>
   <p>This score is not a measured probability of being right.</p>
  </div>
  <details className="text-xs text-zinc-400"><summary className="min-h-11 cursor-pointer py-3">About this experiment</summary>
   <div className="space-y-2 pb-2">
    {p.ranking&&<>
     <p>Available pose measurements: {(p.ranking.poseCoverage*100).toFixed(0)}%. This is the fraction of body measurements available across candidate bounce windows, not accuracy.</p>
     <p>In the 50 marked points, ball path plus pose matched 32 marks; ball path alone matched 28. Each recording was excluded when fitting the model used to evaluate it.</p>
     <p>These existing marks may vary in definition. New reviews are needed to measure accuracy across the full corpus; last-bounce confidence is not calibrated yet.</p>
    </>}
    {b&&<p>Last-bounce sequence agreement: {(b.agreement*100).toFixed(1)} / 100. This is agreement among the retained rally interpretations, not measured accuracy.</p>}
    <p>{b?.origin==='trajectory'?'The trajectory suggests a bounce where there is no matching detected marker. Confirming adds this frame to your bounce labels.':'Confirm the last table bounce during play. Ignore bounces after a failed net shot has ended the point.'}</p>
    <p>The unchanged winner score is from the earlier experiment, with this recording excluded from training. Calibration against new recordings is still needed.</p>
    {p.baselineWinner&&<p>Earlier scoring rule: {side(p.baselineWinner)}. The combined experiment keeps that decision; the confidence score above belongs only to the trajectory winner model.</p>}
   </div>
  </details>
 </section>;
}
