import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validEndingLabel, frameStep, nextUnlabeled, savedLabel, type EndingRow } from './pointEndings.ts';
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
