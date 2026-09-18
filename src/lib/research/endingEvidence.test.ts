import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evidenceAt,containedFrame,type EndingEvidence} from './endingEvidence.ts';
const evidence:EndingEvidence={width:1920,height:1080,rawOffset:241.96666666666667,track:[[10,.2,.3],[10.033,.21,.31],[10.3,.3,.4],[10.333,.31,.41],[10.4,.9,.8]],bounces:[{t:10.3,x:.3,y:.4}],lineage:'Stored detections'};
test('Yu Yu Lin original-video offset aligns both trail and bounces without shifting twice',()=>{
 const state=evidenceAt(evidence,252.3);
 assert.equal(state.trail.length,4);assert.equal(state.bounces.length,1);assert.equal(state.bounces[0].index,1);
 assert.equal(evidenceAt(evidence,10.333).trail.length,0);
});
test('trail omits future observations and breaks at gaps and large jumps',()=>{
 const state=evidenceAt({...evidence,rawOffset:0},10.401);
 assert.deepEqual(state.trail.map(p=>p.connect),[false,true,false,true,false]);
 assert.equal(evidenceAt(evidence,253).trail.length,0);
 assert.equal(evidenceAt(evidence,253).bounces.length,0);
});
test('bounce rings hold either side of event for paused seeking',()=>{
 const shifted={...evidence,rawOffset:0};
 assert.equal(evidenceAt(shifted,10.1).bounces.length,1);
 assert.equal(evidenceAt(shifted,10.7).bounces.length,0);
});
test('overlay respects letterboxing, including portrait originals',()=>{
 assert.deepEqual(containedFrame(560,315,1920,1080),{x:0,y:0,width:560,height:315});
 assert.deepEqual(containedFrame(400,300,1920,1080),{x:0,y:37.5,width:400,height:225});
 assert.deepEqual(containedFrame(400,300,1080,1920),{x:115.625,y:0,width:168.75,height:300});
});
