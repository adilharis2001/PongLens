import assert from 'node:assert/strict';
import test from 'node:test';
import { entryThemes, recapHref, recapIdOf } from './entries.ts';

const id = 'c75c8a89-16ee-41a1-b8f2-d3b441f0f82f';
const note = `Video lesson: https://ponglens.com/lesson-video/${id}`;

test('the column names the recap, and the old link is the fallback', () => {
  assert.equal(recapIdOf({ lesson_video_id: id, transcript: 'anything' }), id);
  assert.equal(recapIdOf({ lesson_video_id: null, transcript: note }), id);
  assert.equal(recapIdOf({ transcript: `Video lesson: https://www.ponglens.com/lesson-video/${id.toUpperCase()}` }), id);
  assert.equal(recapIdOf({ lesson_video_id: null, transcript: 'Forehand approach and backhand swing' }), null);
  assert.equal(recapIdOf({ transcript: 'https://example.com/lesson-video/' + id }), null, 'only our own host');
});

test('a recap hides the link takeaway and keeps the real ones', () => {
  const themes = [
    { name: 'Movement', points: ['Step in before loading the arm'] },
    { name: 'Lesson video', points: [note] },
  ];
  assert.deepEqual(entryThemes(themes, true), [themes[0]]);
  assert.deepEqual(entryThemes(themes, false), themes, 'a plain note shows everything it has');
  assert.deepEqual(entryThemes([{ name: 'Lesson video', points: ['Watch the pendulum serve'] }], true), [
    { name: 'Lesson video', points: ['Watch the pendulum serve'] },
  ], 'a coach who happens to name a theme that way keeps it');
  assert.deepEqual(entryThemes(null, true), []);
});

test('a recap opens on its own page, in this tab', () => {
  assert.equal(recapHref(id), `/lesson-video/${id}`);
});
