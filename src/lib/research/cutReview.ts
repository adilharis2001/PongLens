/** Owner observations on the original video's clock. They never edit a clip. */
export type CutBoundary=number|'uncertain'|null;
export type CutReview={version:1;serveStart:CutBoundary;pointEnd:CutBoundary};
export const EMPTY_CUT_REVIEW:CutReview={version:1,serveStart:null,pointEnd:null};
export function validCutReview(value:unknown):value is CutReview {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const x=value as CutReview;
 const boundary=(v:unknown)=>v===null||v==='uncertain'||(typeof v==='number'&&Number.isFinite(v)&&v>=0);
 return x.version===1&&boundary(x.serveStart)&&boundary(x.pointEnd)&&
  !(typeof x.serveStart==='number'&&typeof x.pointEnd==='number'&&x.serveStart>=x.pointEnd);
}
export function cutReviewInPoint(value:CutReview,source:{start:number;end:number}) {
 return validCutReview(value)&&[value.serveStart,value.pointEnd].every(v=>typeof v!=='number'||(v>=source.start&&v<=source.end));
}
export function cutReviewComplete(value?:CutReview) {return !!value&&value.serveStart!==null&&value.pointEnd!==null;}
