import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

import {lessonChapterStart, lessonReaderSections} from './presentation.ts';
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

test('lesson detail offers the complete read-only recap and returns students to the journal',async()=>{
 const source=await readFile(new URL('../../app/lesson-video/[id]/LessonVideoView.tsx',import.meta.url),'utf8');
 assert.match(source,/Read lesson notes/);
 assert.match(source,/lessonReaderSections\(edit\)/);
 assert.match(source,/const back=detail\?\.isOwner[^\n]+:\s*['"]\/journal['"]/);
 assert.doesNotMatch(source,/First chapter/);
});
