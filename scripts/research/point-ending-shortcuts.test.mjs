import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

// Mount the real page and label a point with the keyboard only. Every key must
// store exactly what the dropdowns would, and nothing while a field has focus.
const require=createRequire(import.meta.url);
const {build}=require('esbuild');
const {JSDOM}=require('jsdom');
const temp=mkdtempSync(path.join(tmpdir(),'ending-shortcuts-'));
const bundle=path.join(temp,'review.cjs');
await build({entryPoints:['src/app/research/point-endings/PointEndingReview.tsx'],bundle:true,platform:'node',format:'cjs',outfile:bundle,jsx:'automatic',alias:{'@':path.resolve('src')},plugins:[{name:'test-link',setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export default "a"',loader:'js'}));b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:require.resolve(args.path),external:true}));}}]});
const {PointEndingReview}=require(bundle);
rmSync(temp,{recursive:true});

test('a point can be labeled from the keyboard alone',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
 const old={};for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){old[key]=globalThis[key];globalThis[key]=value;}
 dom.window.HTMLMediaElement.prototype.pause=function(){};
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 const previousFetch=globalThis.fetch;
 const source={matchName:'Test match',slug:'test',number:1,game:1,scoreBefore:[0,0],winner:'Near',server:'Near',start:0,end:20,tap:18,fps:30,rawOffset:0,sourceHash:'test',imported:false};
 const rows=[{id:'p0',match_id:'m0',sequence:0,revision:0,source,label:{reason:null,custom:'',note:''}},{id:'p1',match_id:'m0',sequence:1,revision:0,source:{...source,number:2},label:{reason:null,custom:'',note:''}}];
 const sent=[];
 globalThis.fetch=async(url,init)=>{
  if(init?.method==='POST'){const b=JSON.parse(init.body);sent.push(b);const r=rows.find(r=>r.id===b.id);r.label=b.label;r.revision++;return {ok:true,json:async()=>({saved:{id:r.id,label:r.label,revision:r.revision}})};}
  if(String(url).includes('/media'))return {ok:false,json:async()=>({error:'No video in keyboard test'})};
  return {ok:true,json:async()=>({id:new URL(url,'http://localhost').searchParams.get('id'),evidence:{width:1920,height:1080,rawOffset:0,track:[],bounces:[{t:5,x:.5,y:.5},{t:10,x:.6,y:.7}],lineage:'Test'}})};
 };
 const root=createRoot(document.getElementById('root'));
 const press=async(key,opts={},target=document.body)=>act(async()=>{target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...opts}));});
 const current=()=>document.querySelector('[data-bounce][aria-current="true"]')?.getAttribute('data-bounce')??'';
 const last=()=>sent.at(-1)?.label;
 try{
  await act(async()=>root.render(React.createElement(PointEndingReview,{initialRows:structuredClone(rows),initialCustom:[]})));
  assert.equal(current(),'');
  await press('Tab');assert.equal(current(),'detected:0','Tab picks the first bounce');
  assert.ok([...document.querySelectorAll('option')].some(o=>o.textContent==='Floor bounce (F)'),'bounce details open with key hints');
  await press('F');
  assert.deepEqual(last().bounceReview.events,[{id:'detected:0',kind:'floor',side:null}]);
  assert.equal(current(),'detected:1','a type key moves on to the next bounce');
  await press('t');
  assert.deepEqual(last().bounceReview.events.find(e=>e.id==='detected:1'),{id:'detected:1',kind:'table',side:null});
  assert.equal(current(),'detected:1','the last bounce stays selected');
  await press('l');assert.equal(last().bounceReview.lastBounce,'detected:1');
  await press('Tab',{shiftKey:true});assert.equal(current(),'detected:0');
  const before=sent.length;await press('l');
  assert.equal(sent.length,before,'a floor bounce cannot become the last bounce');
  assert.match(document.body.textContent,/Only a table or serve bounce can be the last playable bounce/);
  await press('3');assert.equal(last().reason,'net');assert.equal(document.querySelector('#ending-reason').value,'net');
  await press('ArrowDown',{shiftKey:true});assert.equal(last().lastRallyContact,'near');
  await press('Delete');assert.equal(last().bounceReview.events.some(e=>e.id==='detected:0'),false);
  assert.equal(last().bounceReview.lastBounce,'detected:1');
  // Keys typed into a text field are typing, not shortcuts; Esc leaves the field. A plain field
  // outside React keeps jsdom off React's old-IE input fallback, which real browsers never use.
  const note=document.createElement('textarea');document.body.appendChild(note);let blurred=false;note.blur=()=>{blurred=true;};
  const typed=sent.length;await press('t',{},note);await press('3',{},note);
  assert.equal(sent.length,typed,'keys typed into the note are not shortcuts');
  await press('Escape',{},note);assert.equal(blurred,true,'Esc leaves the field');
  await press('Enter');assert.match(document.querySelector('h2').textContent,/Point 2/);
  await press('Enter',{shiftKey:true});assert.match(document.querySelector('h2').textContent,/Point 1/);
  await press('?');assert.match(document.body.textContent,/Mark or unmark the last playable bounce/);
  await press('f',{metaKey:true});assert.equal(last().bounceReview.events.some(e=>e.id==='detected:0'),false,'browser shortcuts pass through');
 }finally{await act(async()=>root.unmount());dom.window.close();Object.assign(globalThis,old);globalThis.fetch=previousFetch;}
});
