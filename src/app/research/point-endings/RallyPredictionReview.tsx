'use client';
import {clock,type EndingLabel} from '@/lib/research/pointEndings';
import {canConfirmRallyBounce,rallyPending,type RallyPrediction} from '@/lib/research/rallyPredictions';
import {winnerSummary,type ResearchPlayers} from '@/lib/research/researchWinner';
const secondary='min-h-11 w-full rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40 sm:w-auto';
export function RallyPredictionReview({prediction:p,players,label,start,ready,onSeek,onConfirm,onKeep,onNoBounce,onUncertain,onCorrect}:{prediction:RallyPrediction;players:ResearchPlayers|null;label:EndingLabel;start:number;ready:boolean;onSeek:()=>void;onConfirm:()=>void;onKeep:()=>void;onNoBounce:()=>void;onUncertain:()=>void;onCorrect:()=>void}){
 const summary=winnerSummary(p,players);
 const b=p.lastBounce,own=label.bounceReview?.lastBounce,pending=rallyPending(label,p);
 const ownEvent=label.bounceReview?.events.find(e=>e.id===own);
 const ownName=own?.startsWith('detected:')?`Bounce ${Number(own.slice(9))+1}`:ownEvent?.rawTime!==undefined?`Added bounce · ${clock(ownEvent.rawTime-start)}`:null;
 const state=pending?'Suggested':own&&own===b?.id?'Confirmed suggestion':own?'Your correction':label.rallyReview?.outcome==='no_live_bounce'?'Reviewed: no live table bounce':label.rallyReview?.outcome==='uncertain'?'Reviewed: cannot tell':'Reviewed without a last-bounce mark';
 return <section aria-label="Last-bounce experiment" className="space-y-3 border-t border-edge pt-4">
  <div className="space-y-1 text-sm">
   <p className="text-zinc-300">Predicted winner: <strong className="font-semibold text-white">{summary.name??'No confident prediction'}</strong></p>
   <p className="text-zinc-300">Winner confidence: <strong className="font-semibold tabular-nums text-white">{summary.score===null?'Not available':`${(summary.score*100).toFixed(1)} / 100`}</strong></p>
   <p className="text-xs text-zinc-500">{summary.source==='rule'&&summary.score===null?'Net/out rule; confidence not scored.':'Experimental score, not measured accuracy.'}</p>
  </div>
  <div className="border-t border-edge pt-3">
   <p className="text-sm text-zinc-300">Suggested last bounce: <span className="text-amber-100">{b?`${b.origin==='detected'?`Bounce ${Number(b.id.slice(9))+1}`:'Missed bounce'} · ${clock(b.rawTime-start)}`:'Not identified'}</span></p>
   <p className={`mt-1 text-xs ${pending?'text-amber-200':'text-cyan-100'}`}>{state}</p>
  </div>
  {ownName&&<p className="text-xs text-zinc-400">Your saved mark: {ownName}</p>}
  {b&&<button className={secondary} disabled={!ready} onClick={onSeek}>Go to suggested bounce</button>}
  <div className="flex flex-col gap-2">
   {pending&&canConfirmRallyBounce(label,p)&&<button className="min-h-11 w-full rounded-lg bg-cyan-glow px-3 py-2 text-sm font-medium text-black hover:brightness-110" onClick={onConfirm}>Confirm last bounce</button>}
   {pending&&own&&<button className={secondary} onClick={onKeep}>Keep my last-bounce mark</button>}
   <button className={secondary} onClick={onCorrect}>Choose a different bounce</button>
   <details className="text-xs text-zinc-400"><summary className="min-h-11 cursor-pointer py-3">No bounce to mark?</summary><div className="flex flex-col gap-2"><button className={secondary} onClick={onNoBounce}>{own?'Clear my mark: no live table bounce':'No live table bounce occurred'}</button><button className={secondary} onClick={onUncertain}>{own?'Clear my mark: cannot tell':'Cannot tell from this footage'}</button></div></details>
  </div>
 </section>;
}
