import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

import {formatClipLength, lessonCanShare, lessonChapterIndexAt, lessonChapterStart, lessonReaderSections, lessonRecapMinutes, lessonStatusLabel} from './presentation.ts';
import type {LessonEdit} from './model.ts';

const edit:LessonEdit={
 title:'Complete lesson',
 chapters:Array.from({length:12},(_,index)=>({
  title:`Chapter ${index+1}`,
  cues:[`Context ${index+1}`,`Solution ${index+1}`],
  start_s:index*100,
  end_s:index*100+30,
  ...(index===0||index===2?{summary_start_s:index*45}:{}),
 })),
 themes:[],
};

test('lesson reader preserves every ordered chapter and cue',()=>{
 const sections=lessonReaderSections(edit);
 assert.equal(sections.length,12);
 assert.deepEqual(sections[0],{number:1,title:'Chapter 1',cues:['Context 1','Solution 1']});
 assert.deepEqual(sections[11],{number:12,title:'Chapter 12',cues:['Context 12','Solution 12']});
});

test('chapter start uses recap timestamps and accumulated clip duration as fallback',()=>{
 assert.equal(lessonChapterStart(edit.chapters,0),0);
 assert.equal(lessonChapterStart(edit.chapters,1),30);
 assert.equal(lessonChapterStart(edit.chapters,2),90);
 assert.equal(lessonChapterStart(edit.chapters,12),null);
});

test('playback synchronization uses the same fallback chapter timeline',()=>{
 const chapters=edit.chapters.slice(0,3).map(({summary_start_s:_,...chapter})=>chapter);
 assert.equal(lessonChapterIndexAt(chapters,29),0);
 assert.equal(lessonChapterIndexAt(chapters,30),1);
 assert.equal(lessonChapterIndexAt(chapters,59),1);
 assert.equal(lessonChapterIndexAt(chapters,60),2);
});

test('lesson detail offers the complete read-only recap and returns students to the journal',async()=>{
 const source=await readFile(new URL('../../app/lesson-video/[id]/LessonVideoView.tsx',import.meta.url),'utf8');
 assert.match(source,/Read lesson notes/);
 assert.match(source,/lessonReaderSections\(edit\)/);
 assert.match(source,/const back=detail\?\.isOwner[^\n]+:\s*['"]\/journal['"]/);
 assert.doesNotMatch(source,/First chapter/);
});

test('lesson playback exposes an underlined chapter index that uses shared seek rules',async()=>{
 const source=await readFile(new URL('../../app/lesson-video/[id]/LessonPlayback.tsx',import.meta.url),'utf8');
 assert.match(source,/Open chapter index/);
 assert.match(source,/underline/);
 assert.match(source,/lessonChapterStart\(edit\.chapters,index\)/);
 assert.match(source,/aria-current=\{chapter===index\?'true':undefined\}/);
});

test('one status word, and shared is not the same as ready', () => {
 const video = (status: string, student_id: string | null, stage: string | null = null) => ({ status, student_id, stage });
 assert.equal(lessonStatusLabel(video('review', 's1'), false), 'Ready to review');
 assert.equal(lessonStatusLabel(video('ready', 's1'), true), 'Shared');
 // Taken back from the student page: the row is still ready, the student cannot see it.
 assert.equal(lessonStatusLabel(video('ready', 's1'), false), 'Ready to share');
 assert.equal(lessonStatusLabel(video('ready', null), false), 'Saved');
 assert.equal(lessonStatusLabel(video('failed', 's1'), false), 'Needs attention');
 assert.equal(lessonStatusLabel(video('processing', 's1', 'Transcribing section 2 of 9'), false), 'Transcribing section 2 of 9');
 assert.equal(lessonStatusLabel(video('processing', 's1'), false), 'Preparing recap');
 assert.equal(lessonStatusLabel(video('queued', 's1'), false), 'Waiting to process');
});

test('chapter lengths and recap minutes read from the clips', () => {
 assert.equal(formatClipLength(0), '0:00');
 assert.equal(formatClipLength(65), '1:05');
 assert.equal(formatClipLength(119.6), '2:00');
 assert.equal(formatClipLength(Number.NaN), '0:00');
 const edit = { title: 'T', themes: [], chapters: [
  { title: 'a', cues: [], start_s: 0, end_s: 90 },
  { title: 'b', cues: [], start_s: 100, end_s: 190 },
  { title: 'c', cues: [], start_s: 200, end_s: 260 },
 ] };
 assert.equal(lessonRecapMinutes(edit), 4);
});

test('the share button comes back when the coach took the entry away', () => {
 assert.equal(lessonCanShare({ status: 'review', student_id: 's1' }, true, false), true);
 assert.equal(lessonCanShare({ status: 'review', student_id: null }, true, false), true, 'a private lesson is saved the same way');
 assert.equal(lessonCanShare({ status: 'ready', student_id: 's1' }, true, true), false, 'already shared');
 assert.equal(lessonCanShare({ status: 'ready', student_id: 's1' }, true, false), true, 'taken back, so offer it again');
 assert.equal(lessonCanShare({ status: 'ready', student_id: null }, true, false), false, 'nothing to share a private lesson with');
 assert.equal(lessonCanShare({ status: 'review', student_id: 's1' }, false, false), false, 'never for the student');
 assert.equal(lessonCanShare({ status: 'processing', student_id: 's1' }, true, false), false);
});
