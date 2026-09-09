import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareFileState, shareFileDownloadable, shareFileCanPrepare, shareFileSize, sameChapterTiming } from './shareFile.ts';
import { withSummaryClock } from './shareFile.ts';

const ready = { status: 'ready', revision: 4, r2_key: 'k', bytes: 134217728, stage: null, error: null };

test('no row means nobody has asked for the file', () => {
  assert.equal(shareFileState(null, 4), 'none');
  assert.equal(shareFileState(undefined, 4), 'none');
});

test('a file built from the current wording is ready', () => {
  assert.equal(shareFileState(ready, 4), 'ready');
});

test('a file built before the last correction is behind, not broken', () => {
  assert.equal(shareFileState(ready, 5), 'behind');
  assert.ok(shareFileDownloadable('behind'));
});

test('a ready row with no key is not a file', () => {
  assert.equal(shareFileState({ ...ready, r2_key: null }, 4), 'none');
});

test('the queue and a failure each read as themselves', () => {
  assert.equal(shareFileState({ ...ready, status: 'queued' }, 4), 'queued');
  assert.equal(shareFileState({ ...ready, status: 'processing' }, 4), 'processing');
  assert.equal(shareFileState({ ...ready, status: 'failed' }, 4), 'failed');
});

test('asking again while one is being made does nothing', () => {
  assert.equal(shareFileCanPrepare('queued'), false);
  assert.equal(shareFileCanPrepare('processing'), false);
  assert.equal(shareFileCanPrepare('ready'), false);
  assert.equal(shareFileCanPrepare('behind'), true);
  assert.equal(shareFileCanPrepare('failed'), true);
  assert.equal(shareFileCanPrepare('none'), true);
});

test('a size is printed only when it is known', () => {
  assert.equal(shareFileSize(134217728), '128 MB');
  assert.equal(shareFileSize(2147483648), '2.0 GB');
  assert.equal(shareFileSize(0), null);
  assert.equal(shareFileSize(null), null);
  assert.equal(shareFileSize(undefined), null);
});

test('retyping a cue keeps the same clips, so nothing is re-cut', () => {
  const before = [{ start_s: 10, end_s: 40 }, { start_s: 90, end_s: 120 }];
  assert.ok(sameChapterTiming(before, [{ start_s: 10, end_s: 40 }, { start_s: 90, end_s: 120 }]));
});

test('removing a chapter changes the video, so it is not a text edit', () => {
  const before = [{ start_s: 10, end_s: 40 }, { start_s: 90, end_s: 120 }];
  assert.equal(sameChapterTiming(before, [{ start_s: 10, end_s: 40 }]), false);
});

test('reordering or moving a clip is not a text edit either', () => {
  const before = [{ start_s: 10, end_s: 40 }, { start_s: 90, end_s: 120 }];
  assert.equal(sameChapterTiming(before, [{ start_s: 90, end_s: 120 }, { start_s: 10, end_s: 40 }]), false);
  assert.equal(sameChapterTiming(before, [{ start_s: 10, end_s: 41 }, { start_s: 90, end_s: 120 }]), false);
});

test('a text edit keeps the clock the recap is seeked by', () => {
  const chapters = [
    { title: 'One', cues: ['a'], start_s: 30, end_s: 60 },
    { title: 'Two', cues: ['b'], start_s: 120, end_s: 165 },
  ];
  assert.deepEqual(withSummaryClock(chapters).map((c) => [c.summary_start_s, c.summary_end_s]),
    [[0, 30], [30, 75]]);
});

test('the clock is rewritten, never trusted from the input', () => {
  const chapters = [{ title: 'One', cues: ['a'], start_s: 30, end_s: 60, summary_start_s: 999, summary_end_s: 999 }];
  assert.deepEqual(withSummaryClock(chapters)[0].summary_start_s, 0);
  assert.deepEqual(withSummaryClock(chapters)[0].summary_end_s, 30);
});
