import {BOUNCE_KINDS,ENDING_REASONS,EMPTY_BOUNCE_REVIEW,isRallyBounce,updateBounce,type BounceAnnotation,type BounceKind,type EndingLabel,type EndingReason} from './pointEndings.ts';
const LEGACY_SUGGESTION_RUN_ID='contact-review-20260922-v1';
export const SUGGESTION_RUN_ID='paddle-contact-20260924-v1';
const knownRun=(id:string)=>id===SUGGESTION_RUN_ID||id===LEGACY_SUGGESTION_RUN_ID;
// The new run only appends paddle proposals; existing reviews remain authoritative.
const carriesReview=(saved:string|undefined,current:string)=>saved===current||(saved===LEGACY_SUGGESTION_RUN_ID&&current===SUGGESTION_RUN_ID);
type Guess<T>={value:T|null;confidence:'tentative'|'uncertain';detail:string};
export type SuggestedEvent={id:string;kind:BounceKind|null;side:'near'|'far'|null;confidence:'tentative'|'uncertain';detail:string};
export type EndingSuggestion={version:1;runId:string;reason:Guess<EndingReason>;lastRallyContact:Guess<'near'|'far'>;lastBounce:Guess<string>;events:SuggestedEvent[]};
export type SuggestionState='pending'|'accepted'|'corrected'|'dismissed'|'human'|'uncertain';
const eventId=(id:unknown,count:number)=>typeof id==='string'&&/^detected:(0|[1-9][0-9]{0,3})$/.test(id)&&Number(id.slice(9))<count;
export function validSuggestion(value:unknown,count:number):value is EndingSuggestion {
 if(!value||typeof value!=='object')return false;
 const x=value as EndingSuggestion;
 const common=(g:unknown)=>!!g&&typeof g==='object'&&['tentative','uncertain'].includes((g as Guess<unknown>).confidence)&&typeof (g as Guess<unknown>).detail==='string'&&(g as Guess<unknown>).detail.length<=240;
 if(x.version!==1||!knownRun(x.runId)||!common(x.reason)||!common(x.lastRallyContact)||!common(x.lastBounce)||!Array.isArray(x.events)||x.events.length>200)return false;
 if(x.reason.value!==null&&!ENDING_REASONS.some(([k])=>k===x.reason.value&&k!=='custom'))return false;
 if(![null,'near','far'].includes(x.lastRallyContact.value))return false;
 if(x.lastBounce.value!==null&&!eventId(x.lastBounce.value,count))return false;
 if(new Set(x.events.map(e=>e.id)).size!==x.events.length)return false;
 return x.events.every(e=>common(e)&&eventId(e.id,count)&&(e.kind===null||BOUNCE_KINDS.some(([k])=>k===e.kind))&&[null,'near','far'].includes(e.side));
}
export function suggestionKeys(s:EndingSuggestion) {return ['reason','lastRallyContact','lastBounce',...s.events.map(e=>`event:${e.id}`)];}
function proposed(s:EndingSuggestion,key:string):unknown {
 if(key==='reason')return s.reason.value;
 if(key==='lastRallyContact')return s.lastRallyContact.value;
 if(key==='lastBounce')return s.lastBounce.value;
 const e=s.events.find(e=>`event:${e.id}`===key);return e?.kind?{id:e.id,kind:e.kind,side:e.side}:null;
}
function answer(label:EndingLabel,key:string):unknown {
 if(key==='reason')return label.reason;
 if(key==='lastRallyContact')return label.lastRallyContact??null;
 if(key==='lastBounce')return label.bounceReview?.lastBounce??null;
 const e=label.bounceReview?.events.find(e=>`event:${e.id}`===key);return e?{id:e.id,kind:e.kind,side:e.side}:null;
}
function reviewed(label:EndingLabel,s:EndingSuggestion,key:string) {return carriesReview(label.suggestionReview?.runId,s.runId)&&!!label.suggestionReview?.fields.includes(key);}
export function suggestionState(label:EndingLabel,s:EndingSuggestion,key:string):SuggestionState {
 const own=answer(label,key),guess=proposed(s,key);
 if(own===null&&conflictsWithLast(label,s,key))return 'uncertain';
 if(reviewed(label,s,key))return own===null?'dismissed':JSON.stringify(own)===JSON.stringify(guess)?'accepted':'corrected';
 return own!==null?'human':guess!==null?'pending':'uncertain';
}
function lastAllowed(label:EndingLabel,s:EndingSuggestion) {
 const id=s.lastBounce.value;if(!id)return false;
 const kind=label.bounceReview?.events.find(e=>e.id===id)?.kind??s.events.find(e=>e.id===id)?.kind;
 return !kind||isRallyBounce(kind);
}
function conflictsWithLast(label:EndingLabel,s:EndingSuggestion,key:string) {
 const e=s.events.find(e=>`event:${e.id}`===key);
 return !!e?.kind&&e.id===label.bounceReview?.lastBounce&&!isRallyBounce(e.kind);
}
export function pendingSuggestionKeys(label:EndingLabel,s?:EndingSuggestion) {
 return s?suggestionKeys(s).filter(k=>suggestionState(label,s,k)==='pending'&&!conflictsWithLast(label,s,k)&&(k!=='lastBounce'||lastAllowed(label,s))):[];
}
function withReviewed(label:EndingLabel,s:EndingSuggestion,keys:string[]):EndingLabel {
 if(!keys.length)return label;
 const old=carriesReview(label.suggestionReview?.runId,s.runId)?label.suggestionReview?.fields??[]:[];
 return {...label,suggestionReview:{runId:s.runId,fields:Array.from(new Set([...old,...keys])).sort()}};
}
/** Merge only explicit confirmations. Merely displaying a suggestion never writes it. */
export function confirmSuggestions(label:EndingLabel,s:EndingSuggestion,keys=pendingSuggestionKeys(label,s),dismiss=false):EndingLabel {
 let next={...label};const done:string[]=[];
 for(const key of [...keys.filter(k=>k!=='lastBounce'),...keys.filter(k=>k==='lastBounce')]){
  if(!suggestionKeys(s).includes(key)||(!dismiss&&conflictsWithLast(label,s,key)))continue;
  if(key==='lastBounce'&&!dismiss&&!lastAllowed(next,s))continue;
  if(suggestionState(label,s,key)!=='pending')continue;
  const value=proposed(s,key);done.push(key);if(dismiss)continue;
  if(key==='reason')next={...next,reason:value as EndingReason,custom:''};
  else if(key==='lastRallyContact')next={...next,lastRallyContact:value as 'near'|'far'};
  else if(key==='lastBounce')next={...next,bounceReview:{...(next.bounceReview??EMPTY_BOUNCE_REVIEW),lastBounce:value as string}};
  else next={...next,bounceReview:updateBounce(next.bounceReview??EMPTY_BOUNCE_REVIEW,value as BounceAnnotation)};
 }
 return withReviewed(next,s,done);
}
export function displayLabel(label:EndingLabel,s?:EndingSuggestion):EndingLabel {
 if(!s)return label;
 const shown=confirmSuggestions(label,s);return {...shown,suggestionReview:label.suggestionReview};
}
export function reviewChangedFields(before:EndingLabel,after:EndingLabel,s?:EndingSuggestion):EndingLabel {
 if(!s)return after;
 const keys=suggestionKeys(s).filter(key=>JSON.stringify(answer(before,key))!==JSON.stringify(answer(after,key)));
 if(suggestionState(before,s,'lastBounce')==='pending'&&!lastAllowed(after,s)&&keys.includes(`event:${s.lastBounce.value}`))keys.push('lastBounce');
 return withReviewed(after,s,keys);
}
