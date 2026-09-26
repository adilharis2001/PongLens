import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WINNER_CHECK_RUN_ID, basisText, checkState, checkTotals, predictedName, validWinnerCheck, type WinnerCheck} from './winnerCheck.ts';

const check = (predicted: WinnerCheck['predicted'], savedSide: WinnerCheck['savedSide'] = 'near', group: WinnerCheck['group'] = 'new'): WinnerCheck =>
  ({version: 1, runId: WINNER_CHECK_RUN_ID, group, players: {near: 'Adil', far: 'Rowel'}, savedSide, predicted});

test('a call names the player at the predicted end', () => {
  const c = check({side: 'far', basis: 'model', score: 0.81});
  assert.equal(validWinnerCheck(c), true);
  assert.equal(predictedName(c), 'Rowel');
  assert.equal(basisText(c), 'Model score 81 / 100');
});

test('agreement is judged against the saved winner, and no call is its own state', () => {
  assert.equal(checkState(check({side: 'near', basis: 'net', score: null})), 'agrees');
  assert.equal(checkState(check({side: 'far', basis: 'out', score: 0.9})), 'disagrees');
  assert.equal(checkState(check({side: null, basis: null, score: 0.6})), 'no_call');
  assert.equal(checkState(check({side: 'near', basis: 'model', score: 0.9}, null)), 'unscored');
  assert.equal(checkState(undefined), null);
});

test('malformed checks are refused', () => {
  assert.equal(validWinnerCheck(check({side: 'near', basis: null, score: null})), false);
  assert.equal(validWinnerCheck(check({side: null, basis: 'model', score: 0.8})), false);
  assert.equal(validWinnerCheck({...check({side: 'near', basis: 'model', score: 1.2})}), false);
  assert.equal(validWinnerCheck({...check({side: 'near', basis: 'model', score: 0.8}), runId: 'other'}), false);
  assert.equal(validWinnerCheck({...check({side: 'near', basis: 'model', score: 0.8}), group: 'elsewhere'}), false);
  assert.equal(validWinnerCheck({...check({side: 'near', basis: 'model', score: 0.8}), players: {near: '', far: 'B'}}), false);
});

test('totals count only scored points, per group', () => {
  const rows = [
    {check: check({side: 'near', basis: 'model', score: 0.9})},
    {check: check({side: 'far', basis: 'model', score: 0.8})},
    {check: check({side: null, basis: null, score: null})},
    {check: check({side: 'near', basis: 'net', score: null}, null)},
    {check: check({side: 'near', basis: 'net', score: null}, 'near', 'development')},
    {},
  ];
  assert.deepEqual(checkTotals(rows), [
    {group: 'development', points: 1, calls: 1, correct: 1},
    {group: 'new', points: 3, calls: 2, correct: 1},
  ]);
});
