import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {StartReview} from './startReview.ts';
import {normalizeEndingLabel,sameEndingLabel,validEndingLabel,type EndingLabel} from './pointEndings.ts';

const base:EndingLabel={reason:'net',custom:'',note:'Keep my note'};
const review:StartReview={runId:'serve-start-disagreements-20260925-v1',outcome:'yes',observedServeStart:12};
test('start verdict survives normalization and edits from an older client',()=>{
 const current={...base,startReview:review};
 assert.deepEqual(normalizeEndingLabel(current),current);
 assert.deepEqual(normalizeEndingLabel(base,current),current);
 assert.equal(sameEndingLabel(current,{...current,startReview:{...review,outcome:'no' as const}}),false);
});
test('start verdict rejects unknown runs, outcomes and malformed observed marks',()=>{
 for(const startReview of [null,{}, {...review,runId:'other-run'}, {...review,outcome:'confirmed_error'}, {...review,observedServeStart:NaN}, {...review,observedServeStart:Infinity}, {...review,observedServeStart:-1}, {...review,observedServeStart:undefined}])assert.equal(validEndingLabel({...base,startReview}),false);
 for(const observedServeStart of [12,null,'uncertain'])for(const outcome of ['yes','no','uncertain',null])assert.equal(validEndingLabel({...base,startReview:{...review,outcome,observedServeStart}}),true);
});

test('a corrected or cleared serve mark makes the previous verdict pending',async()=>{
 const {startReviewComplete}=await import('./startReview.ts');
 const item={pointId:'one',runId:review.runId,proposedStart:13,recordedServeTap:11};
 const label={...base,startReview:review,cutReview:{version:1 as const,serveStart:12,pointEnd:20}};
 assert.equal(startReviewComplete(label,item),true);
 assert.equal(startReviewComplete({...label,cutReview:{...label.cutReview,serveStart:12.1}},item),false);
 assert.equal(startReviewComplete({...label,cutReview:{...label.cutReview,serveStart:null}},item),false);
 assert.equal(startReviewComplete({...label,startReview:{...review,outcome:null}},item),false);
 assert.equal(startReviewComplete(label,{...item,runId:'another-run'}),false);
});
test('new verdicts must match the saved mark and an authorized case, but historical verdicts survive corrections',async()=>{
 const {startReviewAllowed}=await import('./startReview.ts');
 const item={pointId:'one',runId:review.runId,proposedStart:13,recordedServeTap:11};
 assert.equal(startReviewAllowed(review,undefined,12,item),true);
 assert.equal(startReviewAllowed(review,undefined,13,item),false);
 assert.equal(startReviewAllowed(review,undefined,12,undefined),false);
 assert.equal(startReviewAllowed(review,undefined,12,{...item,runId:'another-run'}),false);
 assert.equal(startReviewAllowed(review,review,13,item),true);
 assert.equal(startReviewAllowed({...review,outcome:'no'},review,13,item),false);
 assert.equal(startReviewAllowed({...review,observedServeStart:'uncertain'},undefined,'uncertain',item),true);
 assert.equal(startReviewAllowed({...review,observedServeStart:null},undefined,null,item),true);
});
test('comparison uses the current numeric mark or a clearly identified historical serve tap',async()=>{
 const {startReference}=await import('./startReview.ts');
 const item={pointId:'one',runId:review.runId,proposedStart:13,recordedServeTap:11};
 assert.deepEqual(startReference({version:1,serveStart:12,pointEnd:20},item),{time:12,kind:'mark'});
 assert.deepEqual(startReference({version:1,serveStart:'uncertain',pointEnd:20},item),{time:11,kind:'tap'});
 assert.equal(startReference(undefined,{...item,recordedServeTap:null}),null);
});
test('start navigation includes completed cuts and wraps only to pending start verdicts',async()=>{
 const {startReviewRows,nextStartReview}=await import('./startReview.ts');
 const cases=[{pointId:'one',runId:review.runId,proposedStart:13,recordedServeTap:null},{pointId:'two',runId:review.runId,proposedStart:13,recordedServeTap:null}];
 const rows=[{id:'one',label:{...base,cutReview:{version:1 as const,serveStart:12,pointEnd:20},startReview:review}},{id:'other',label:base},{id:'two',label:{...base,cutReview:{version:1 as const,serveStart:12,pointEnd:20}}}];
 assert.deepEqual(startReviewRows(rows,cases).map(r=>r.id),['one','two']);
 assert.equal(nextStartReview(rows,cases,'one')?.id,'two');
 assert.equal(nextStartReview(rows,cases,'two'),undefined);
 assert.equal(nextStartReview(rows,cases)?.id,'two');
});
