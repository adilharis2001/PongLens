import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEndingLabel,sameEndingLabel,validEndingLabel,type EndingLabel} from './pointEndings.ts';

const base:EndingLabel={reason:null,custom:'',note:'Keep this note'};
test('cut marks persist independently of ending labels and survive older clients',()=>{
 const current={...base,cutReview:{version:1 as const,serveStart:12.3,pointEnd:17.8}};
 assert.equal(validEndingLabel(current),true);
 assert.deepEqual(normalizeEndingLabel(current),current);
 assert.deepEqual(normalizeEndingLabel(base,current),current);
 assert.equal(sameEndingLabel(current,{...current,cutReview:{...current.cutReview,pointEnd:18}}),false);
});
test('cut review rejects malformed or reversed marks and permits skipping either boundary',()=>{
 for(const cutReview of [null,{}, {version:2,serveStart:1,pointEnd:2}, {version:1,serveStart:5,pointEnd:2}, {version:1,serveStart:5,pointEnd:5}, {version:1,serveStart:-1,pointEnd:2}, {version:1,serveStart:NaN,pointEnd:null}, {version:1,serveStart:'soon',pointEnd:2}])assert.equal(validEndingLabel({...base,cutReview}),false);
 for(const cutReview of [{version:1,serveStart:null,pointEnd:2},{version:1,serveStart:'uncertain',pointEnd:null},{version:1,serveStart:1,pointEnd:'uncertain'}])assert.equal(validEndingLabel({...base,cutReview}),true);
});
test('explicit clearing retains the other boundary and existing bounce answers',()=>{
 const current={...base,bounceReview:{version:1 as const,events:[],lastBounce:'detected:1'},cutReview:{version:1 as const,serveStart:12,pointEnd:20}};
 const cleared={...current,cutReview:{...current.cutReview,serveStart:null}};
 assert.deepEqual(normalizeEndingLabel(cleared,current),cleared);
});


test('cut marks use the original review window and uncertain answers count as reviewed',async()=>{
 const {cutReviewInPoint,cutReviewComplete}=await import('./cutReview.ts');
 const source={start:100,end:110};
 assert.equal(cutReviewInPoint({version:1,serveStart:100,pointEnd:110},source),true);
 assert.equal(cutReviewInPoint({version:1,serveStart:99.9,pointEnd:105},source),false);
 assert.equal(cutReviewInPoint({version:1,serveStart:105,pointEnd:110.1},source),false);
 assert.equal(cutReviewInPoint({version:1,serveStart:'uncertain',pointEnd:null},source),true);
 assert.equal(cutReviewComplete({version:1,serveStart:100,pointEnd:null}),false);
 assert.equal(cutReviewComplete({version:1,serveStart:100,pointEnd:'uncertain'}),true);
 assert.equal(cutReviewComplete(undefined),false);
});
