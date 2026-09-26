'use client';
import {basisText,checkState,predictedName,type WinnerCheck} from '@/lib/research/winnerCheck';
export function WinnerCheckPanel({check}:{check:WinnerCheck}) {
 const name=predictedName(check),state=checkState(check);
 const tone=state==='agrees'?'text-cyan-100':state==='disagrees'?'text-amber-200':'text-zinc-500';
 const verdict=state==='agrees'?'Matches your saved winner':state==='disagrees'?'Does not match your saved winner':state==='no_call'?'Not confident enough to call this point':'This point has no saved winner';
 return <section aria-label="Model’s winner" className="space-y-1 border-t border-edge pt-4 text-sm">
  <p className="text-zinc-300">Model’s winner: <strong className="font-semibold text-white">{name??'No call'}</strong></p>
  {name&&<p className="text-xs text-zinc-500">{basisText(check)}</p>}
  <p className={`text-xs ${tone}`}>{verdict}</p>
 </section>;
}
