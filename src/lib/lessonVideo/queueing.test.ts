import test from 'node:test';
import assert from 'node:assert/strict';
import { queueLessonRender } from './queueing.ts';

test('a coach edit begins a new lease-recovery budget',()=>{
 assert.deepEqual(queueLessonRender('Updating recap','2026-09-06T12:00:00.000Z'),{
  status:'queued',stage:'Updating recap',error:null,lease_token:null,lease_until:null,
  lease_reclaim_count:0,updated_at:'2026-09-06T12:00:00.000Z',
 });
});
