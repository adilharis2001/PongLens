import {COMPARISON_BATCH,validComparisonId,validComparisonReview,sameComparisonReview,type ComparisonReview,type ComparisonRow} from './matchComparison.ts';
type DraftStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type DraftValue={revision:number;review:ComparisonReview};
export type RestoredComparisonDraft={state:'none'}|({state:'draft'|'conflict'}&DraftValue);
export function comparisonDraftKey(id:string) {return `ponglens:match-comparison:${COMPARISON_BATCH}:${id}`;}
function decode(raw:string|null,id:string):DraftValue|null {
 if(!raw||raw.length>20000)return null;
 try{const x=JSON.parse(raw);return x?.version===1&&x.batch===COMPARISON_BATCH&&x.rowId===id&&Number.isSafeInteger(x.revision)&&x.revision>=0&&validComparisonReview(x.review)?{revision:x.revision,review:x.review}:null;}
 catch{return null;}
}
/** Storage exceptions deliberately reach the caller so the UI cannot claim durability. */
export function readComparisonDraft(storage:DraftStorage,row:Pick<ComparisonRow,'id'|'revision'>):RestoredComparisonDraft {
 const draft=decode(storage.getItem(comparisonDraftKey(row.id)),row.id);
 return draft?{state:draft.revision===row.revision?'draft':'conflict',...draft}:{state:'none'};
}
/** Call synchronously on each edit, before SPA navigation can unmount the component. */
export function writeComparisonDraft(storage:DraftStorage,row:Pick<ComparisonRow,'id'>,review:ComparisonReview,revision:number) {
 if(!validComparisonId(row.id)||!validComparisonReview(review)||!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid local review draft.');
 storage.setItem(comparisonDraftKey(row.id),JSON.stringify({version:1,batch:COMPARISON_BATCH,rowId:row.id,revision,review}));
}
/** An old save response must not erase a newer draft created after navigation. */
export function clearComparisonDraft(storage:DraftStorage,id:string,expected?:DraftValue) {
 const key=comparisonDraftKey(id);
 if(expected){const current=decode(storage.getItem(key),id);if(!current||current.revision!==expected.revision||!sameComparisonReview(current.review,expected.review))return;}
 storage.removeItem(key);
}
