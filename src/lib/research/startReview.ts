import type {CutBoundary,CutReview} from './cutReview.ts';

export const START_REVIEW_RUN_ID='serve-start-disagreements-20260925-v1';
export const START_REVIEW_CORRECTION_RUN_ID='serve-start-correction-20260925-v2';
export type StartReview={runId:string;outcome:'yes'|'no'|'uncertain'|null;observedServeStart:CutBoundary};
export type StartReviewCase={pointId:string;runId:string;proposedStart:number;recordedServeTap:number|null;retainedExistingStart?:boolean};
export function validStartReview(value:unknown):value is StartReview {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const x=value as StartReview;
 return [START_REVIEW_RUN_ID,START_REVIEW_CORRECTION_RUN_ID].includes(x.runId)&&[null,'yes','no','uncertain'].includes(x.outcome)&&
  (x.observedServeStart===null||x.observedServeStart==='uncertain'||(typeof x.observedServeStart==='number'&&Number.isFinite(x.observedServeStart)&&x.observedServeStart>=0));
}

type StartLabel={startReview?:StartReview;cutReview?:CutReview};
export function startReviewComplete(label:StartLabel,item?:StartReviewCase) {
 const review=label.startReview;
 return !!item&&!!review&&validStartReview(review)&&review.runId===item.runId&&review.outcome!==null&&review.observedServeStart===(label.cutReview?.serveStart??null);
}
/** A mark edit keeps the previous verdict as history, but never makes it current. */
export function startReviewAllowed(review:StartReview,existing:StartReview|undefined,serveStart:CutBoundary,item?:StartReviewCase) {
 if(!item||!validStartReview(review))return false;
 const unchanged=!!existing&&review.runId===existing.runId&&review.outcome===existing.outcome&&review.observedServeStart===existing.observedServeStart;
 return unchanged||(review.runId===item.runId&&review.observedServeStart===serveStart);
}
export function startReference(marks:CutReview|undefined,item:StartReviewCase):{time:number;kind:'mark'|'tap'}|null {
 return typeof marks?.serveStart==='number'?{time:marks.serveStart,kind:'mark'}:item.recordedServeTap!==null?{time:item.recordedServeTap,kind:'tap'}:null;
}
export function startReviewRows<T extends {id:string;label:StartLabel}>(rows:T[],cases:readonly StartReviewCase[]):T[] {
 return rows.filter(row=>cases.some(item=>item.pointId===row.id));
}
export function nextStartReview<T extends {id:string;label:StartLabel}>(rows:T[],cases:readonly StartReviewCase[],current?:string):T|undefined {
 const eligible=startReviewRows(rows,cases),index=eligible.findIndex(row=>row.id===current);
 return [...eligible.slice(index+1),...eligible.slice(0,index<0?0:index)].find(row=>!startReviewComplete(row.label,cases.find(item=>item.pointId===row.id)));
}

/** Extend playback only to a server-authorized start; frozen evidence stays unchanged. */
export function startReviewWindow(source:{start:number;end:number},item?:StartReviewCase) {
 const proposed=item?.proposedStart;
 return {start:typeof proposed==='number'&&Number.isFinite(proposed)&&proposed>=0&&proposed<source.end?Math.min(source.start,proposed):source.start,end:source.end};
}
