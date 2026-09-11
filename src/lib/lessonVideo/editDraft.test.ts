import assert from 'node:assert/strict';
import test from 'node:test';

import {canAddCue, canAddLine, canRemoveCue, draftBlocker, draftFromEdit, draftSnapshot, editFromDraft, MAX_DRAFT_CUES} from './editDraft.ts';
import {MAX_GOALS, MAX_WORK_ON, validateEdit, type LessonEdit} from './model.ts';

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

test('a lesson that stated no goals keeps none through the editor',()=>{
 const draft=draftFromEdit(edit);
 assert.deepEqual(draft.goals,[]);
 assert.deepEqual(draft.work_on,[]);
 const saved=editFromDraft(draft);
 assert.equal('goals' in saved,false);
 assert.equal('work_on' in saved,false);
});

test('goals and follow-ups round-trip, and an emptied list loses its key',()=>{
 const bracketed:LessonEdit={...edit,goals:['Serve short.'],work_on:['Third ball.','Footwork drill.']};
 const draft=draftFromEdit(bracketed);
 assert.equal(draft.goals.length,1);
 assert.equal(draft.work_on.length,2);
 assert.deepEqual(editFromDraft(draft),bracketed);
 // Every line has its own key, so two blank ones can sit on screen at once.
 const ids=[...draft.goals.map((g)=>g.id),...draft.work_on.map((w)=>w.id)];
 assert.equal(new Set(ids).size,ids.length);
 // Deleting the last goal is a real answer, not a blocked state.
 draft.goals=[];
 draft.work_on=[{id:'a',text:'  '}];
 const saved=editFromDraft(draft);
 assert.equal('goals' in saved,false);
 assert.equal('work_on' in saved,false);
 assert.equal(draftBlocker(draft),null);
 assert.ok(validateEdit(saved,200));
});

test('the two lists stop at their own limits',()=>{
 const draft=draftFromEdit({...edit,goals:Array.from({length:MAX_GOALS},(_x,i)=>`Goal ${i}`),work_on:['One thing.']});
 assert.equal(canAddLine(draft.goals,MAX_GOALS),false);
 assert.equal(canAddLine(draft.work_on,MAX_WORK_ON),true);
 draft.goals=draft.goals.slice(0,1);
 assert.equal(canAddLine(draft.goals,MAX_GOALS),true);
 draft.work_on=Array.from({length:MAX_WORK_ON},(_x,i)=>({id:`w${i}`,text:`Work ${i}`}));
 assert.equal(canAddLine(draft.work_on,MAX_WORK_ON),false);
});

test('an added-then-abandoned blank goal is not a change',()=>{
 const before=draftSnapshot(draftFromEdit(edit));
 const draft=draftFromEdit(edit);
 draft.goals.push({id:'g',text:''});
 assert.equal(draftSnapshot(draft),before);
 draft.goals[0].text='Serve short.';
 assert.notEqual(draftSnapshot(draft),before);
});
