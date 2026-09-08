import test from 'node:test';
import assert from 'node:assert/strict';
import { ballDisagreement, comparisonSummary } from './activeBallComparison.ts';
const visible={state:'visible' as const,x:100,y:100};
const absent={state:'absent' as const,x:null,y:null};
test('location errors are counted even when visibility agrees',()=>{
 assert.equal(ballDisagreement(visible,{...visible,x:125}),true);
 assert.equal(ballDisagreement(visible,{...visible,x:112,y:116}),false);
 assert.equal(ballDisagreement(absent,{...absent,state:'hidden'}),true);
});
test('missed balls remain in the visible denominator and negatives stay separate',()=>{
 const s=comparisonSummary([{reference_label:visible,prediction:{...visible,x:112,y:116}},{reference_label:visible,prediction:absent},{reference_label:absent,prediction:visible}]);
 assert.deepEqual(s,{total:3,visible:2,located:1,nonvisible:1,falseDetections:1,stateAgreement:1,disagreements:2,unanswered:0});
});

test('unusable completed answers stay in scoring denominators',()=>{
 const s=comparisonSummary([{reference_label:visible,prediction:null}]);
 assert.equal(s.total,1);assert.equal(s.visible,1);assert.equal(s.located,0);assert.equal(s.unanswered,1);assert.equal(s.disagreements,1);
});
