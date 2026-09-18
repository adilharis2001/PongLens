import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EndingSaveQueue} from './endingSaveQueue.ts';
test('serializes rapid edits with the returned revision and retains the latest draft',async()=>{
 const calls:number[]=[]; const pending:Array<(v:{revision:number})=>void>=[];
 const queue=new EndingSaveQueue(0,async(_label,revision)=>{calls.push(revision);return await new Promise(resolve=>pending.push(resolve));},()=>{});
 queue.set({reason:'net',custom:'',note:''});
 queue.set({reason:'long',custom:'',note:'latest'});
 assert.deepEqual(calls,[0]);pending.shift()!({revision:1});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[0,1]);pending.shift()!({revision:2});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(queue.pending,false);assert.equal(queue.revision,2);
});
test('failed saves keep the answer pending and retry the same revision',async()=>{
 let fail=true;const calls:number[]=[];
 const q=new EndingSaveQueue(4,async(_label,r)=>{calls.push(r);if(fail)throw Error('offline');return {revision:5};},()=>{});
 q.set({reason:'wide',custom:'',note:''});await new Promise(resolve=>setImmediate(resolve));assert.equal(q.pending,true);
 fail=false;q.retry();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[4,4]);assert.equal(q.pending,false);
});
