import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImport, validateEdit, canReadVideo, publicVideo } from './model.ts';
test('90 minute and two hour lessons fit with 20GiB headroom',()=>{
 assert.equal(validateImport(9*1024**3,5400),null); assert.equal(validateImport(20*1024**3,10800),null);
 assert.ok(validateImport(20*1024**3+1,5400)); assert.ok(validateImport(100,10801));
 assert.ok(validateImport(NaN,5400)); assert.ok(validateImport(100,0));
});
test('edits never reach outside source or exceed seven minutes',()=>{
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
