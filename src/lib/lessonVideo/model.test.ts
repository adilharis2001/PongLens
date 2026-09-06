import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImport, validateEdit, canReadVideo, publicVideo } from './model.ts';
test('90 minute and two hour lessons fit with 20GiB headroom',()=>{
 assert.equal(validateImport(9*1024**3,5400),null); assert.equal(validateImport(20*1024**3,10800),null);
 assert.ok(validateImport(20*1024**3+1,5400)); assert.ok(validateImport(100,10801));
 assert.ok(validateImport(NaN,5400)); assert.ok(validateImport(100,0));
});
test('edits never reach outside source or use a clip longer than two minutes',()=>{
 const e={title:'Backhand',chapters:[{title:'Balance',cues:['Stay balanced.'],start_s:5390,end_s:5400}],themes:[]};
 assert.ok(validateEdit(e,5400)); assert.equal(validateEdit(e,5300),null);
 assert.equal(validateEdit({...e,chapters:[{...e.chapters[0],start_s:0,end_s:421}]},5400),null);
 assert.equal(validateEdit({...e,chapters:[{...e.chapters[0],start_s:-1}]},5400),null);
});
test('only owner or explicitly granted student sees ready recap; source stays private',()=>{
 assert.equal(canReadVideo('owner','owner','processing',false),true);
 assert.equal(canReadVideo('student','owner','review',true),false);
 assert.equal(canReadVideo('student','owner','ready',true),true);
 assert.equal(canReadVideo('other','owner','ready',false),false);
 const row={id:'a',source_key:'secret',upload_id:'secret',transcript:[{text:'private'}],edit:{title:'Lesson'},status:'ready'};
 const out=publicVideo(row,false); assert.equal('source_key' in out,false); assert.equal('transcript' in out,false); assert.equal('upload_id' in out,false);
});
test('expanded lesson preserves twelve chapters and accepts up to fifteen minutes',()=>{
 const chapters=Array.from({length:12},(_,i)=>({title:`Topic ${i}`,cues:['When the ball changes, adjust.'],start_s:i*100,end_s:i*100+60}));
 const result=validateEdit({title:'Lesson',chapters,themes:[]},5400);
 assert.equal(result?.chapters.length,12);
 assert.equal(result?.chapters[11].start_s,1100);
 assert.equal(validateEdit({title:'Lesson',chapters:Array.from({length:17},(_,i)=>({...chapters[0],start_s:i*20,end_s:i*20+10}))},5400),null);
 assert.equal(validateEdit({title:'Lesson',chapters:chapters.slice(0,10).map(c=>({...c,end_s:c.start_s+100}))},5400),null);
});
