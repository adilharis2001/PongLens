import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

import {formatClipLength, lessonCanSetCoach, lessonCanShare, lessonChapterIndexAt, lessonChapterStart, lessonReaderSections, lessonRecapMinutes, lessonStatusLabel} from './presentation.ts';
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

test('lesson detail offers the complete read-only recap and returns a reader to coaching',async()=>{
 const source=await readFile(new URL('../../app/lesson-video/[id]/LessonVideoView.tsx',import.meta.url),'utf8');
 assert.match(source,/Read lesson notes/);
 assert.match(source,/lessonReaderSections\(edit\)/);
 // Somebody who did not make the recap goes back to Coaching, not to the
 // Journal. A recap now travels in both directions — a coach shares one
 // with a student, a student shares one with their coach — and Coaching
 // is the room both of them read it in.
 assert.match(source,/const back=detail\?\.isOwner[^\n]+:\s*['"]\/coaching['"]/);
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

test('a player recording their own lesson gets the same words as a coach', () => {
 const withCoach = (status: string) => ({ status, student_id: null, coach_ref_id: 'pc1', stage: null });
 assert.equal(lessonStatusLabel(withCoach('review'), false), 'Ready to review');
 assert.equal(lessonStatusLabel(withCoach('ready'), false), 'Ready to share');
 assert.equal(lessonStatusLabel(withCoach('ready'), true), 'Shared');
 // Neither side named: nobody to send it to, so it is only saved.
 assert.equal(lessonStatusLabel({ status: 'ready', student_id: null, coach_ref_id: null, stage: null }, false), 'Saved');
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

test('a player can send their own recap to their coach, and only theirs', () => {
 assert.equal(lessonCanShare({ status: 'ready', coach_ref_id: 'pc1' }, true, false), true, 'kept it back, now wants to send it');
 assert.equal(lessonCanShare({ status: 'ready', coach_ref_id: 'pc1' }, true, true), false, 'already shared');
 assert.equal(lessonCanShare({ status: 'ready', coach_ref_id: 'pc1' }, false, false), false, 'never for the coach reading it');
 assert.equal(lessonCanShare({ status: 'ready', student_id: null, coach_ref_id: null }, true, false), false, 'a private lesson has nobody to send it to');
});

// Who taught the lesson, answered after the import.
//
// The importer asks, but nobody is a real answer and an unanswered picker
// looks exactly like one, so a recap arrived naming nobody with no way
// back: nothing set the coach afterwards, and a recap with nobody on it
// can never be shared, which left the page reading "Saved" beside no
// controls at all.
const unattributed={status:'review',student_id:null};

test('a finished recap that names nobody can still be attributed',()=>{
 assert.equal(lessonCanSetCoach(unattributed,true),true);
 assert.equal(lessonCanSetCoach({...unattributed,status:'ready'},true),true);
});

test('a recap that needs another try can be attributed too',()=>{
 // The lesson happened either way, and a failed render is the moment
 // somebody is most likely to be looking at the page.
 assert.equal(lessonCanSetCoach({...unattributed,status:'failed'},true),true);
});

test('an upload filed against nobody can be fixed while it is still uploading',()=>{
 // Who taught it does not depend on whether the recap exists yet.
 for(const status of ['uploading','queued','processing'])
  assert.equal(lessonCanSetCoach({...unattributed,status},true),true,status);
});

test('a coach\u2019s own import is never reattributed',()=>{
 // It names the student it was made for, and the database refuses both
 // at once. Moving a delivered lesson to a different student is not a
 // correction, it is a different lesson.
 assert.equal(lessonCanSetCoach({status:'ready',student_id:'student-1'},true),false);
});

test('somebody a recap was shared with cannot reattribute it',()=>{
 assert.equal(lessonCanSetCoach(unattributed,false),false);
});

test('a recap being deleted is left alone',()=>{
 assert.equal(lessonCanSetCoach({...unattributed,stage:'Deleting',status:'failed'},true),false);
});

// Correcting a word is not reprocessing the lesson.
//
// A rebuild walked the same stages a first import does, starting at
// "Downloading the lesson", over a page whose finished recap had just
// been cleared, so fixing a typo read as the whole ninety minutes going
// through again.
test('a rebuild over an existing recap says it is updating',()=>{
 const rebuilding={status:'queued',stage:'Updating recap',coach_ref_id:'c1'};
 assert.equal(lessonStatusLabel(rebuilding,false,true),'Updating your recap');
 assert.equal(lessonStatusLabel({...rebuilding,status:'processing',stage:'Downloading the lesson'},false,true),'Updating your recap');
});

test('a first import still reports what it is doing',()=>{
 // Nothing to watch yet, so the stages are the only news there is.
 assert.equal(lessonStatusLabel({status:'queued',stage:'Waiting to process'},false,false),'Waiting to process');
 assert.equal(lessonStatusLabel({status:'processing',stage:'Transcribing section 1 of 9'},false,false),'Transcribing section 1 of 9');
});

test('a finished recap is unaffected by having something to watch',()=>{
 assert.equal(lessonStatusLabel({status:'review'},false,true),'Ready to review');
 assert.equal(lessonStatusLabel({status:'ready',coach_ref_id:'c1'},true,true),'Shared');
});

