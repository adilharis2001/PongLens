import test from 'node:test';
import assert from 'node:assert/strict';
import { validBallLabel, sourcePoint } from './activeBall.ts';

test('clicks map into source pixels regardless of display size', () => {
  assert.deepEqual(sourcePoint(98.25, 55.265625, 393, 221.0625, 1920, 1080), [480, 270]);
});
test('visible requires finite in-frame coordinates', () => {
  assert.equal(validBallLabel({state:'visible',x:100,y:200},1920,1080),true);
  for (const x of [null, NaN, -1, 1920, '100'])
    assert.equal(validBallLabel({state:'visible',x,y:200},1920,1080),false);
});
test('hidden and unsure cannot silently retain a previous point', () => {
  assert.equal(validBallLabel({state:'hidden',x:null,y:null},1920,1080),true);
  assert.equal(validBallLabel({state:'unsure',x:100,y:200},1920,1080),false);
  assert.equal(validBallLabel(null,1920,1080),false);
});
