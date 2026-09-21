export const ENDING_REASONS = [
  ['long','Ball went long without a table bounce'],
  ['wide','Ball went wide without a table bounce'],
  ['net','Ball hit the net and did not continue'],
  ['missed_return','Legal bounce, then missed return or winner'],
  ['double_bounce','Ball bounced twice'],
  ['serve_fault','Serve fault'],
  ['edge','Edge or side of the table'],
  ['continuing','Rally is still continuing'],
  ['unsure','Cannot tell from this footage'],
  ['custom','Other / custom reason'],
] as const;
export type EndingReason = typeof ENDING_REASONS[number][0];
export type EndingLabel = { reason: EndingReason | null; custom: string; note: string; bounceReview?: BounceReview; lastRallyContact?: 'near' | 'far' | 'unsure' | null };
export type EndingSource = {
  matchName: string; slug: string; number: number; game: number; scoreBefore: number[];
  winner: string; server: string | null; start: number; end: number; tap: number | null;
  fps: number; rawOffset: number; sourceHash: string; imported: boolean;
};
export type EndingRow = {id:string; match_id:string; sequence:number; source:EndingSource; label:EndingLabel; revision:number};
export const EMPTY_LABEL: EndingLabel = {reason:null, custom:'', note:''};
export function validEndingLabel(value: unknown): value is EndingLabel {
  if(!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const x=value as Record<string,unknown>;
  return (x.reason === null || ENDING_REASONS.some(([key])=>key===x.reason)) &&
    typeof x.custom==='string' && x.custom.length<=120 &&
    (x.reason!=='custom' || x.custom.trim().length>0) &&
    typeof x.note==='string' && x.note.length<=4000 &&
    (x.bounceReview===undefined || validBounceReview(x.bounceReview)) &&
    (x.lastRallyContact===undefined || x.lastRallyContact===null || ['near','far','unsure'].includes(x.lastRallyContact as string));
}
export function savedLabel(label:EndingLabel) { return label.reason!==null && validEndingLabel(label); }
export function reasonText(label:EndingLabel) {
  return label.reason==='custom' ? label.custom : ENDING_REASONS.find(([key])=>key===label.reason)?.[1] ?? 'Not labeled';
}
export function nextUnlabeled(rows:EndingRow[], current?:string) {
  const i=rows.findIndex(r=>r.id===current);
  return [...rows.slice(i+1),...rows.slice(0,i+1)].find(r=>!savedLabel(r.label));
}
export function frameStep(time:number,delta:number,fps:number,start:number,end:number) {
  const frame=Math.floor(time*fps+0.00001);
  return Math.min(end,Math.max(start,(frame+delta+0.5)/fps));
}
export function clock(time:number) {
  return `${Math.floor(time/60)}:${(time%60).toFixed(2).padStart(5,'0')}`;
}


export const BOUNCE_KINDS = [
 ['table','Table bounce'], ['serve','Serve bounce'], ['rally','Rally bounce'],
 ['paddle','Paddle contact'], ['floor','Floor bounce'],
 ['non_rally','Non-rally bounces'], ['other_table','Bounce on another table'],
 // Earlier labels were interpreted both ways. Keep them until explicitly reviewed.
 ['non_playing','Non-playing table bounce (earlier label)'],
] as const;
export type BounceKind = typeof BOUNCE_KINDS[number][0];
export type BounceAnnotation = {id:string;kind:BounceKind;side:'near'|'far'|null;rawTime?:number};
export type BounceReview = {version:1;events:BounceAnnotation[];lastBounce:string|null};
export const EMPTY_BOUNCE_REVIEW:BounceReview={version:1,events:[],lastBounce:null};
export function isRallyBounce(kind:BounceKind) { return kind==='table'||kind==='serve'||kind==='rally'; }
export function validBounceReview(value:unknown):value is BounceReview {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const x=value as BounceReview;
 if(x.version!==1||!Array.isArray(x.events)||x.events.length>200||!(x.lastBounce===null||typeof x.lastBounce==='string'))return false;
 const ids=new Set<string>();
 for(const e of x.events){
  if(!e||typeof e!=='object'||typeof e.id!=='string'||ids.has(e.id)||!BOUNCE_KINDS.some(([k])=>k===e.kind)||![null,'near','far'].includes(e.side))return false;
  const detected=/^detected:(0|[1-9][0-9]{0,3})$/.test(e.id);
  const added=/^added:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.id);
  if(!detected&&!added)return false;
  if(detected&&e.rawTime!==undefined)return false;
  if(added&&(typeof e.rawTime!=='number'||!Number.isFinite(e.rawTime)||e.rawTime<0))return false;
  if(e.id===x.lastBounce&&!isRallyBounce(e.kind))return false;
  ids.add(e.id);
 }
 return x.lastBounce===null||/^detected:(0|[1-9][0-9]{0,3})$/.test(x.lastBounce)||ids.has(x.lastBounce);
}
/** Validate references against immutable per-point evidence, in raw-video time. */
export function bounceReviewInPoint(review:BounceReview,source:Pick<EndingSource,'start'|'end'>,bounceCount:number) {
 const validId=(id:string)=>!id.startsWith('detected:')||Number(id.slice(9))<bounceCount;
 return (review.lastBounce===null||validId(review.lastBounce))&&review.events.every(e=>validId(e.id)&&
  (e.rawTime===undefined||(e.rawTime>=source.start&&e.rawTime<=source.end)));
}
export function updateBounce(review:BounceReview,event:BounceAnnotation):BounceReview {
 return {...review,events:[...review.events.filter(e=>e.id!==event.id),event],
  lastBounce:review.lastBounce===event.id&&!isRallyBounce(event.kind)?null:review.lastBounce};
}
export function removeBounce(review:BounceReview,id:string):BounceReview {
 return {...review,events:review.events.filter(e=>e.id!==id),lastBounce:review.lastBounce===id?null:review.lastBounce};
}
/** Explicit field normalization makes idempotent retries independent of JSON key order. */
export function normalizeEndingLabel(label:EndingLabel,existing?:EndingLabel):EndingLabel {
 const review=label.bounceReview??existing?.bounceReview;
 // Omission from older clients preserves the answer; explicit null clears it.
 const lastRallyContact=label.lastRallyContact===undefined?existing?.lastRallyContact:label.lastRallyContact;
 return {reason:label.reason,custom:label.custom.trim(),note:label.note,...(lastRallyContact?{lastRallyContact}:{}),...(review?{bounceReview:{
  version:1 as const,lastBounce:review.lastBounce,events:review.events.map(e=>({id:e.id,kind:e.kind,side:e.side,...(e.rawTime!==undefined?{rawTime:e.rawTime}:{})})).sort((a,b)=>a.id.localeCompare(b.id))
 }}:{})};
}
export function sameEndingLabel(a:EndingLabel,b:EndingLabel) {
 return JSON.stringify(normalizeEndingLabel(a))===JSON.stringify(normalizeEndingLabel(b));
}

export function bounceFrameTime(time:number,start:number,end:number) { return Math.max(start,Math.min(end,time)); }
