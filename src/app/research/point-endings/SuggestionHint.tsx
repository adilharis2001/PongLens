'use client';
import type {SuggestionState} from '@/lib/research/endingSuggestions';
export function SuggestionHint({state,onConfirm}:{state:SuggestionState;detail?:string;onConfirm?:()=>void}) {
 if(state==='human')return null;
 const text=state==='pending'?'Suggested':state==='accepted'?'Confirmed suggestion':state==='corrected'?'Your correction':state==='dismissed'?'Suggestion cleared':'No reliable suggestion';
 return <div className={`mt-2 text-xs ${state==='pending'?'text-amber-200':state==='uncertain'?'text-zinc-500':'text-cyan-100'}`}>
  <div className="flex flex-wrap items-center justify-between gap-2"><span>{text}</span>{state==='pending'&&onConfirm&&<button type="button" onClick={onConfirm} className="min-h-11 w-full sm:w-auto rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500">Confirm</button>}</div>
 </div>;
}
