import {EMPTY_BOUNCE_REVIEW,isRallyBounce,type EndingLabel,type EndingSource} from './pointEndings.ts';
import type {EndingSuggestion} from './endingSuggestions.ts';
export const RALLY_RUN_ID='rally-review-20260923-v1';
export type RallyReview={runId:string;reviewed:true};
export type RallyPrediction={version:1;runId:string;lastBounce:{id:string;rawTime:number;side:'near'|'far';origin:'detected'|'trajectory';agreement:number}|null;winner:{side:'near'|'far'|null;score:number|null;threshold:number|null};baselineWinner:'near'|'far'|null};
const side=(x:unknown)=>x===null||x==='near'||x==='far';
const unit=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1;
export function validRallyPrediction(value:unknown,count:number,source:Pick<EndingSource,'start'|'end'>):value is RallyPrediction {
 if(!value||typeof value!=='object')return false;
 const x=value as RallyPrediction,w=x.winner,b=x.lastBounce;
 if(x.version!==1||x.runId!==RALLY_RUN_ID||!side(x.baselineWinner)||!w||!side(w.side))return false;
 if(w.score!==null&&(!unit(w.score)||w.score<.5))return false;
 if(w.threshold!==null&&(!unit(w.threshold)||w.threshold<.5))return false;
 if(w.side!==null&&(w.score===null||w.threshold===null||w.score<w.threshold))return false;
 if(w.score===null&&w.threshold!==null)return false;
 if(b===null)return true;
 if(!b||!unit(b.agreement)||!['near','far'].includes(b.side)||!Number.isFinite(b.rawTime)||b.rawTime<source.start||b.rawTime>source.end)return false;
 return b.origin==='detected'?/^detected:(0|[1-9][0-9]{0,3})$/.test(b.id)&&Number(b.id.slice(9))<count:b.origin==='trajectory'&&/^added:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.id);
}
export function validRallyReview(value:unknown):value is RallyReview {
 if(!value||typeof value!=='object')return false;
 const x=value as RallyReview;return x.runId===RALLY_RUN_ID&&x.reviewed===true;
}
export function rallyPending(label:EndingLabel,p?:RallyPrediction){return !!p&&label.rallyReview?.runId!==p.runId;}
export function canConfirmRallyBounce(label:EndingLabel,p:RallyPrediction){
 const b=p.lastBounce;if(!b||label.bounceReview?.lastBounce)return false;
 const kind=label.bounceReview?.events.find(e=>e.id===b.id)?.kind;
 return (!kind||isRallyBounce(kind))&&(b.origin==='detected'||(label.bounceReview?.events.length??0)<200);
}
export function confirmRallyBounce(label:EndingLabel,p:RallyPrediction):EndingLabel {
 if(!canConfirmRallyBounce(label,p))return label;
 const b=p.lastBounce!,review=label.bounceReview??EMPTY_BOUNCE_REVIEW;
 const events=b.origin==='trajectory'&&!review.events.some(e=>e.id===b.id)?[...review.events,{id:b.id,kind:'table' as const,side:b.side,rawTime:b.rawTime}]:review.events;
 return {...label,bounceReview:{...review,events,lastBounce:b.id},rallyReview:{runId:p.runId,reviewed:true}};
}
export function reviewRallyBounce(before:EndingLabel,after:EndingLabel,p?:RallyPrediction):EndingLabel {
 if(!p||(before.bounceReview?.lastBounce??null)===(after.bounceReview?.lastBounce??null))return after;
 return {...after,rallyReview:{runId:p.runId,reviewed:true}};
}
/** Older category suggestions remain available, but only one last-bounce experiment is displayed. */
export function withoutLegacyLastBounce(s:EndingSuggestion|undefined,p?:RallyPrediction):EndingSuggestion|undefined {
 return s&&p?{...s,lastBounce:{value:null,confidence:'uncertain',detail:'See the trajectory experiment below.'}}:s;
}
