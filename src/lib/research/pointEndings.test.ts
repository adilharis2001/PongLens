import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validEndingLabel, frameStep, nextUnlabeled, savedLabel, type EndingRow, bounceReviewInPoint, normalizeEndingLabel, sameEndingLabel, updateBounce, removeBounce, type BounceReview, bounceFrameTime } from './pointEndings.ts';
test('accepts explicit uncertainty and rejects invented reasons or missing custom text', () => {
  assert.equal(validEndingLabel({reason:'unsure',custom:'',note:''}),true);
  assert.equal(validEndingLabel({reason:'custom',custom:'Ball hit a light',note:'Rare'}),true);
  for(const value of [{reason:'custom',custom:' ',note:''},{reason:'out',custom:'',note:''},{reason:'net',custom:'',note:5},{reason:'net',custom:'',note:'x'.repeat(4001)}]) assert.equal(validEndingLabel(value),false);
});
test('step always moves one decoded frame even when time lies on a rounding boundary', () => {
  const fps=30000/1001;
  const t=frameStep(999/fps,1,fps,0,100);
  assert.ok(t>999/fps);
  assert.equal(Math.floor(t*fps),1000);
  assert.equal(Math.floor(frameStep(t,1,fps,0,100)*fps),1001);
  assert.equal(Math.floor(frameStep(t,-1,fps,0,100)*fps),999);
  assert.equal(frameStep(0,-1,fps,0,100),0);
});
test('resume skips completed labels but preserves explicit cannot-tell as reviewed',()=>{
 const rows=[{id:'a',label:{reason:'unsure',custom:'',note:''}},{id:'b',label:{reason:null,custom:'',note:''}},{id:'c',label:{reason:'net',custom:'',note:''}}] as EndingRow[];
 assert.equal(nextUnlabeled(rows,'a')?.id,'b');assert.equal(nextUnlabeled(rows,'c')?.id,'b');
 assert.equal(savedLabel(rows[0].label),true);
});

test('rejects malformed optional bounce annotations without requiring them on older labels',()=>{
 const base={reason:null,custom:'',note:''};
 assert.equal(validEndingLabel(base),true);
 for(const bounceReview of [null,{}, {version:2,events:[],lastBounce:null},
  {version:1,events:[{id:'detected:0',kind:'invented',side:null}],lastBounce:null},
  {version:1,events:[{id:'added:a',kind:'table',side:null,rawTime:-1}],lastBounce:null},
  {version:1,events:[{id:'detected:0',kind:'floor',side:null}],lastBounce:'detected:0'},
  {version:1,events:[{id:'detected:0',kind:'paddle',side:null},{id:'detected:0',kind:'floor',side:null}],lastBounce:null}]) {
  assert.equal(validEndingLabel({...base,bounceReview}),false,JSON.stringify(bounceReview));
 }
});

test('optional annotations save independently of an ending and validate point references',()=>{
 const review:BounceReview={version:1,events:[{id:'added:11111111-1111-1111-1111-111111111111',rawTime:255,kind:'serve',side:'near'}],lastBounce:'detected:1'};
 const label={reason:null,custom:'',note:'',bounceReview:review};
 assert.equal(validEndingLabel(label),true);assert.equal(savedLabel(label),false);
 assert.equal(bounceReviewInPoint(review,{start:250,end:260},2),true);
 assert.equal(bounceReviewInPoint(review,{start:250,end:260},1),false);
 assert.equal(bounceReviewInPoint(review,{start:1,end:10},2),false);
});
test('changing a last rally bounce to a non-rally event clears its designation; removal clears references',()=>{
 const review:BounceReview={version:1,events:[],lastBounce:'detected:2'};
 const changed=updateBounce(review,{id:'detected:2',kind:'paddle',side:'far'});
 assert.equal(changed.lastBounce,null);assert.equal(review.lastBounce,'detected:2');
 assert.deepEqual(removeBounce(changed,'detected:2'),{version:1,events:[],lastBounce:null});
});
test('older clients preserve optional annotations; retries compare every annotation independent of key order',()=>{
 const old={reason:'long' as const,custom:'',note:''};
 const review:BounceReview={version:1,events:[{id:'detected:1',kind:'floor',side:null}],lastBounce:null};
 const current={...old,bounceReview:review};
 assert.deepEqual(normalizeEndingLabel(old,current),current);
 assert.equal(sameEndingLabel(current,{...current,bounceReview:{lastBounce:null,events:[{side:null,kind:'floor',id:'detected:1'}],version:1}}),true);
 assert.equal(sameEndingLabel(current,{...current,bounceReview:{...review,events:[]}}),false);
});
test('missed-bounce time stays inside point after playback overshoots its end',()=>{
 assert.equal(bounceFrameTime(12.18,3,12),12);
 assert.equal(bounceFrameTime(2.99,3,12),3);
 assert.equal(bounceFrameTime(8.123,3,12),8.123);
});

test('non-rally, other-table and handling annotations cannot be the last rally bounce',()=>{
 const base={reason:null,custom:'',note:''};
 for(const kind of ['non_rally','other_table','ball_handling','non_playing'] as const){
  const event={id:'detected:0',kind,side:null};
  const bounceReview={version:1 as const,events:[event],lastBounce:null};
  assert.equal(validEndingLabel({...base,bounceReview}),true,kind);
  assert.equal(validEndingLabel({...base,bounceReview:{...bounceReview,lastBounce:event.id}}),false,kind);
  assert.equal(updateBounce({...bounceReview,lastBounce:event.id},event).lastBounce,null);
  assert.deepEqual(normalizeEndingLabel(base,{...base,bounceReview}).bounceReview,bounceReview);
 }
 const label=(kind:'non_rally'|'other_table')=>({...base,bounceReview:{version:1 as const,events:[{id:'detected:0',kind,side:null}],lastBounce:null}});
 assert.equal(sameEndingLabel(label('non_rally'),label('other_table')),false);
});

test('last rally contact is optional, allows explicit uncertainty and rejects other values',()=>{
 const base={reason:null,custom:'',note:''};
 for(const lastRallyContact of [undefined,null,'near','far','unsure'] as const){
  const label={...base,lastRallyContact};
  assert.equal(validEndingLabel(label),true);
  assert.equal(savedLabel(label),false,'contact alone must not mark the ending reviewed');
 }
 for(const lastRallyContact of ['','both','winner',1,{},[]])assert.equal(validEndingLabel({...base,lastRallyContact}),false);
});
test('last rally contact survives older clients and distinguishes changed, cleared and uncertain answers',()=>{
 const old={reason:'long' as const,custom:'',note:''};
 const current={...old,lastRallyContact:'near' as const};
 assert.deepEqual(normalizeEndingLabel(old,current),current);
 assert.equal(sameEndingLabel(current,{...old,lastRallyContact:'far'}),false);
 assert.equal(sameEndingLabel(current,{...old,lastRallyContact:'unsure'}),false);
 const cleared=normalizeEndingLabel({...old,lastRallyContact:null},current);
 assert.equal(cleared.lastRallyContact??null,null);
 assert.equal(sameEndingLabel(current,cleared),false);
 assert.equal(sameEndingLabel(old,cleared),true);
 assert.equal(normalizeEndingLabel({...old,lastRallyContact:'unsure'},current).lastRallyContact,'unsure');
});
