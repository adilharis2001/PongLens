import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bounceOrder, keyForKind, keyForReason, kindForKey, reasonForKey, stepBounce, toggleLastBounce, typingTarget, withKind} from './endingShortcuts.ts';
import {EMPTY_BOUNCE_REVIEW, validBounceReview, type BounceReview} from './pointEndings.ts';

const added = 'added:11111111-2222-4333-8444-555555555555';

test('letters map to bounce types and back, case-insensitively', () => {
  assert.equal(kindForKey('F'), 'floor');
  assert.equal(kindForKey('t'), 'table');
  assert.equal(kindForKey('s'), 'serve');
  assert.equal(kindForKey('z'), null);
  assert.equal(keyForKind('net_clip'), 'C');
  assert.equal(keyForKind('rally'), null);
});

test('digits follow the ending-reason list and never pick custom', () => {
  assert.equal(reasonForKey('1'), 'long');
  assert.equal(reasonForKey('3'), 'net');
  assert.equal(reasonForKey('9'), 'unsure');
  assert.equal(reasonForKey('0'), null);
  assert.equal(keyForReason('custom'), null);
});

test('detected and added bounces are visited in time order', () => {
  const review: BounceReview = {version: 1, events: [{id: added, kind: 'table', side: null, rawTime: 12.5}], lastBounce: null};
  const order = bounceOrder([{t: 1}, {t: 3}], 10, review);
  assert.deepEqual(order.map(s => s.id), ['detected:0', added, 'detected:1']);
  assert.equal(stepBounce(order, '', 1)?.id, 'detected:0');
  assert.equal(stepBounce(order, '', -1)?.id, 'detected:1');
  assert.equal(stepBounce(order, 'detected:0', 1)?.id, added);
  assert.equal(stepBounce(order, 'detected:1', 1)?.id, 'detected:1');
  assert.equal(stepBounce([], '', 1), null);
});

test('a type key stores the same event the dropdown would, keeping side and added time', () => {
  const shown: BounceReview = {version: 1, events: [{id: 'detected:0', kind: 'table', side: 'far'}], lastBounce: null};
  const out = withKind(EMPTY_BOUNCE_REVIEW, shown, {id: 'detected:0', rawTime: 4}, 'floor');
  assert.deepEqual(out.events, [{id: 'detected:0', kind: 'floor', side: 'far'}]);
  const withAdded: BounceReview = {version: 1, events: [{id: added, kind: 'table', side: null, rawTime: 7}], lastBounce: added};
  const relabeled = withKind(withAdded, withAdded, {id: added, rawTime: 7}, 'paddle');
  assert.deepEqual(relabeled.events, [{id: added, kind: 'paddle', side: null, rawTime: 7}]);
  assert.equal(relabeled.lastBounce, null, 'a bounce that stops being a table bounce loses the last mark');
  assert.equal(validBounceReview(relabeled), true);
});

test('last bounce toggles like the checkbox and refuses non-table events', () => {
  const floor: BounceReview = {version: 1, events: [{id: 'detected:1', kind: 'floor', side: null}], lastBounce: null};
  assert.ok('refused' in toggleLastBounce(floor, floor, 'detected:1'));
  const set = toggleLastBounce(EMPTY_BOUNCE_REVIEW, EMPTY_BOUNCE_REVIEW, 'detected:0');
  assert.ok('review' in set && set.review.lastBounce === 'detected:0' && set.review.events.length === 0);
  assert.ok('review' in set && validBounceReview(set.review));
  const cleared = toggleLastBounce({...EMPTY_BOUNCE_REVIEW, lastBounce: 'detected:0'}, {...EMPTY_BOUNCE_REVIEW, lastBounce: 'detected:0'}, 'detected:0');
  assert.ok('review' in cleared && cleared.review.lastBounce === null);
  const suggested = toggleLastBounce(EMPTY_BOUNCE_REVIEW, {...EMPTY_BOUNCE_REVIEW, lastBounce: 'detected:0'}, 'detected:0');
  assert.deepEqual(suggested, {dismissSuggestion: true});
});

test('shortcuts step aside for text fields and selects, not for buttons or checkboxes', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({tagName, isContentEditable: false, ...extra}) as unknown as EventTarget;
  assert.equal(typingTarget(el('TEXTAREA')), true);
  assert.equal(typingTarget(el('SELECT')), true);
  assert.equal(typingTarget(el('INPUT', {type: 'text'})), true);
  assert.equal(typingTarget(el('INPUT', {type: 'checkbox'})), false);
  assert.equal(typingTarget(el('BUTTON')), false);
  assert.equal(typingTarget(el('DIV', {isContentEditable: true})), true);
  assert.equal(typingTarget(null), false);
});
