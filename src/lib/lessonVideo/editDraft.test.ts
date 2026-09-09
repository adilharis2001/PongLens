import assert from 'node:assert/strict';
import test from 'node:test';

import {canAddCue, canRemoveCue, draftBlocker, draftFromEdit, draftSnapshot, editFromDraft, MAX_DRAFT_CUES} from './editDraft.ts';
import {validateEdit, type LessonEdit} from './model.ts';

const edit:LessonEdit={
 title:'Backhand lesson',
 chapters:[
  {title:'Balance',cues:['Stay low.','Weight forward.'],start_s:10,end_s:40,summary_start_s:0},
  {title:'Contact',cues:['Brush the ball.'],start_s:100,end_s:130},
 ],
 themes:[{name:'Footwork',points:['Small steps.']}],
 warning:'One clip was cut short.',
};

test('a draft round-trips to the same edit, with themes and the warning untouched',()=>{
 const draft=draftFromEdit(edit);
 assert.equal(draft.chapters.length,2);
 assert.equal(draft.chapters[0].cues.length,2);
 assert.deepEqual(editFromDraft(draft),edit);
});

test('every chapter and cue gets its own key',()=>{
 const draft=draftFromEdit(edit);
 const ids=[...draft.chapters.map((c)=>c.id),...draft.chapters.flatMap((c)=>c.cues.map((cue)=>cue.id))];
 assert.equal(new Set(ids).size,ids.length);
});

test('saving trims text and drops blank lines',()=>{
 const draft=draftFromEdit(edit);
 draft.title='  Backhand lesson ';
 draft.chapters[0].title=' Balance ';
 draft.chapters[0].cues=[{id:'a',text:'  Stay low. '},{id:'b',text:'   '},{id:'c',text:''}];
 const saved=editFromDraft(draft);
 assert.equal(saved.title,'Backhand lesson');
 assert.equal(saved.chapters[0].title,'Balance');
 assert.deepEqual(saved.chapters[0].cues,['Stay low.']);
 assert.equal('id' in saved.chapters[0],false);
 // And the server agrees with what the page sends.
 assert.ok(validateEdit(saved,200));
});

test('an added-then-abandoned blank line is not a change',()=>{
 const before=draftSnapshot(draftFromEdit(edit));
 const draft=draftFromEdit(edit);
 draft.chapters[1].cues.push({id:'x',text:''});
 assert.equal(draftSnapshot(draft),before);
 draft.chapters[1].cues[1].text='Follow through.';
 assert.notEqual(draftSnapshot(draft),before);
});

test('save is shut, with a reason, until the recap can be rebuilt',()=>{
 const draft=draftFromEdit(edit);
 assert.equal(draftBlocker(draft),null);
 draft.title='  ';
 assert.equal(draftBlocker(draft),'The recap needs a title.');
 draft.title='Backhand lesson';
 draft.chapters[1].title=' ';
 assert.equal(draftBlocker(draft),'Every chapter needs a title.');
 draft.chapters[1].title='Contact';
 draft.chapters[1].cues=[{id:'a',text:'  '}];
 assert.equal(draftBlocker(draft),'Every chapter needs at least one point.');
 draft.chapters[1].cues[0].text='Brush the ball.';
 assert.equal(draftBlocker(draft),null);
});

test('a chapter keeps its last line and stops at three',()=>{
 const draft=draftFromEdit(edit);
 assert.equal(canRemoveCue(draft.chapters[1]),false);
 assert.equal(canRemoveCue(draft.chapters[0]),true);
 assert.equal(canAddCue(draft.chapters[0]),true);
 draft.chapters[0].cues.push({id:'x',text:''});
 assert.equal(draft.chapters[0].cues.length,MAX_DRAFT_CUES);
 assert.equal(canAddCue(draft.chapters[0]),false);
});
