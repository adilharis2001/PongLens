import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

import {lessonChapterIndexAt, lessonChapterStart, lessonReaderSections} from './presentation.ts';
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
