'use client';
import {CHECK_GROUPS,checkTotals,type WinnerCheck} from '@/lib/research/winnerCheck';
const pct=(n:number,d:number)=>d?`${Math.round(100*n/d)}%`:'–';
export function CheckResults({rows}:{rows:readonly {check?:WinnerCheck}[]}) {
 const totals=checkTotals(rows);
 if(!totals.length)return null;
 return <details className="mt-3 text-sm text-zinc-400">
  <summary className="min-h-11 cursor-pointer py-3">Model results</summary>
  <div className="max-w-2xl space-y-2 pb-3">
   <table className="w-full text-left text-xs sm:text-sm"><thead><tr><th scope="col" className="py-2 pr-3 font-medium">Matches</th><th scope="col" className="py-2 pr-3 font-medium">Points called</th><th scope="col" className="py-2 font-medium">Right</th></tr></thead><tbody>
    {totals.map(t=><tr key={t.group} className="border-t border-edge"><td className="py-2 pr-3">{CHECK_GROUPS.find(([g])=>g===t.group)?.[1]}</td><td className="py-2 pr-3 tabular-nums">{pct(t.calls,t.points)} ({t.calls} of {t.points})</td><td className="py-2 tabular-nums">{pct(t.correct,t.calls)} ({t.correct} of {t.calls})</td></tr>)}
   </tbody></table>
   <p className="text-xs text-zinc-500">Right means the model’s winner matches your saved winner. Your original six were used to build the model, so their numbers are the most flattering.</p>
  </div>
 </details>;
}
