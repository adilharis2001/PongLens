import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

// Mount the real page. Count label reads, not elapsed milliseconds: the
// regression must hold on slow phones and fast CI machines alike.
const require=createRequire(import.meta.url);
const {build}=require("esbuild");
const {JSDOM}=require("jsdom");
const temp=mkdtempSync(path.join(tmpdir(),'ending-performance-'));
const bundle=path.join(temp,'review.cjs');
await build({entryPoints:['src/app/research/point-endings/PointEndingReview.tsx'],bundle:true,platform:'node',format:'cjs',outfile:bundle,jsx:'automatic',alias:{'@':path.resolve('src')},plugins:[{name:'test-link',setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export default "a"',loader:'js'}));b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:require.resolve(args.path),external:true}));}}]});
const {PointEndingReview}=require(bundle);
rmSync(temp,{recursive:true});

test('review suggestions are explicit, isolated saves and survive remount',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
 const old={};for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){old[key]=globalThis[key];globalThis[key]=value;}
 dom.window.HTMLMediaElement.prototype.pause=function(){};
 const previousFetch=globalThis.fetch;
 const suggestion={version:1,runId:'contact-review-20260922-v1',reason:{value:'long',confidence:'tentative',detail:'Ending candidate'},lastRallyContact:{value:'far',confidence:'tentative',detail:'Contact candidate'},lastBounce:{value:'detected:0',confidence:'tentative',detail:'Last candidate'},events:[{id:'detected:0',kind:'table',side:'near',confidence:'tentative',detail:'Table candidate'},{id:'detected:1',kind:'floor',side:null,confidence:'tentative',detail:'Floor candidate'}]};
 const source={matchName:'Test match',slug:'test',number:1,game:1,scoreBefore:[0,0],winner:'Near',server:'Near',start:0,end:20,tap:18,fps:30,rawOffset:0,sourceHash:'test',imported:false};
 const rows=[{id:'p0',match_id:'m0',sequence:0,revision:0,source,label:{reason:null,custom:'',note:''},suggestion},{id:'p1',match_id:'m0',sequence:1,revision:0,source:{...source,number:2},label:{reason:'net',custom:'',note:''},suggestion}];
 const sent=[];
 globalThis.fetch=async(url,init)=>{
  if(init?.method==='POST'){const b=JSON.parse(init.body);sent.push(b);const r=rows.find(r=>r.id===b.id);r.label=b.label;r.revision++;return {ok:true,json:async()=>({saved:{id:r.id,label:r.label,revision:r.revision}})};}
  if(String(url).includes('/media'))return {ok:false,json:async()=>({error:'No video in form test'})};
  return {ok:true,json:async()=>({id:'p0',evidence:{width:1920,height:1080,rawOffset:0,track:[],bounces:[{t:5,x:.5,y:.5},{t:10,x:.6,y:.7}],lineage:'Test'}})};
 };
 let root=createRoot(document.getElementById('root'));
 const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
 const select=async(el,value)=>act(async()=>{el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 try {
  await act(async()=>root.render(React.createElement(PointEndingReview,{initialRows:structuredClone(rows),initialCustom:[]})));
  assert.equal(sent.length,0);assert.equal(document.querySelector('#ending-reason').value,'long');assert.match(document.body.textContent,/1 labeled of 2/);
  await select(document.querySelector('#ending-reason'),'net');
  assert.equal(sent.at(-1).label.reason,'net');assert.equal(sent.at(-1).label.lastRallyContact,undefined);assert.equal(sent.at(-1).label.bounceReview,undefined);assert.deepEqual(sent.at(-1).label.suggestionReview.fields,['reason']);
  await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Bounce details')).click();});
  const bounceSelect=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='detected:0'));
  await select(bounceSelect,'detected:0');
  const typeSelect=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='floor'));
  assert.equal(typeSelect.value,'table');await select(typeSelect,'paddle');
  assert.deepEqual(sent.at(-1).label.bounceReview.events,[{id:'detected:0',kind:'paddle',side:'near'}]);assert.equal(sent.at(-1).label.bounceReview.lastBounce,null);
  await act(async()=>button('Confirm this point’s suggestions').click());
  const saved=sent.at(-1).label;assert.equal(saved.reason,'net');assert.equal(saved.lastRallyContact,'far');assert.equal(saved.bounceReview.events.find(e=>e.id==='detected:0').kind,'paddle');assert.equal(saved.bounceReview.events.find(e=>e.id==='detected:1').kind,'floor');assert.equal(saved.bounceReview.lastBounce,null);
  assert.equal(suggestion.events[0].kind,'table');assert.equal(suggestion.reason.value,'long');
  await act(async()=>button('Next point to review').click());assert.match(document.querySelector('h2').textContent,/Point 2/);
  await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));
  const before=sent.length;await act(async()=>root.render(React.createElement(PointEndingReview,{initialRows:structuredClone(rows),initialCustom:[]})));assert.equal(sent.length,before);assert.match(document.querySelector('h2').textContent,/Point 2/);await act(async()=>button('Previous point').click());assert.match(document.body.textContent,/Your correction/);
 }finally{await act(async()=>root.unmount());dom.window.close();Object.assign(globalThis,old);globalThis.fetch=previousFetch;}
});

test('new trajectory review confirms only its last bounce and preserves human answers',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
 const old={};for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){old[key]=globalThis[key];globalThis[key]=value;}
 dom.window.HTMLMediaElement.prototype.pause=function(){};
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 const previousFetch=globalThis.fetch;
 const source={matchName:'Test match',slug:'test',number:1,game:1,scoreBefore:[0,0],winner:'Near',server:'Near',start:0,end:20,tap:18,fps:30,rawOffset:0,sourceHash:'test',imported:false};
 const legacy={version:1,runId:'contact-review-20260922-v1',reason:{value:null,confidence:'uncertain',detail:''},lastRallyContact:{value:null,confidence:'uncertain',detail:''},lastBounce:{value:null,confidence:'uncertain',detail:''},events:[{id:'detected:0',kind:'floor',side:null,confidence:'tentative',detail:'Old floor suggestion'}]};
 const rallyPrediction={version:2,ranking:{method:'ball_pose',margin:.3,poseCoverage:.8,candidateCount:2,reason:'available'},runId:'pose-last-bounce-20260924-v1',lastBounce:{id:'detected:0',rawTime:5,side:'far',origin:'detected',agreement:.6},winner:{side:'near',score:.85,threshold:.8},baselineWinner:null};
 const check={version:1,runId:'winner-check-20260926-v1',group:'development',players:{near:'Adil',far:'Lester'},savedSide:'far',predicted:{side:'near',basis:'model',score:.85}};
 const rows=[{id:'p0',match_id:'m0',sequence:0,revision:0,source,label:{reason:null,custom:'',note:'preserve me'},rallyPrediction,suggestion:legacy,check},{id:'p1',match_id:'m0',sequence:1,revision:0,source:{...source,number:2},label:{reason:'net',custom:'',note:'human',bounceReview:{version:1,events:[],lastBounce:'detected:1'}},rallyPrediction}];
 const sent=[];
 globalThis.fetch=async(url,init)=>{
  if(init?.method==='POST'){const b=JSON.parse(init.body);sent.push(b);const r=rows.find(r=>r.id===b.id);r.label=b.label;r.revision++;return {ok:true,json:async()=>({saved:{id:r.id,label:r.label,revision:r.revision}})};}
  if(String(url).includes('/media'))return {ok:false,json:async()=>({error:'No video in form test'})};
  return {ok:true,json:async()=>({id:new URL(url,'http://localhost').searchParams.get('id'),evidence:{width:1920,height:1080,rawOffset:0,track:[],bounces:[{t:5,x:.5,y:.5},{t:10,x:.6,y:.7}],lineage:'Test'}})};
 };
 const root=createRoot(document.getElementById('root'));const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
 try{
  await act(async()=>root.render(React.createElement(PointEndingReview,{initialRows:structuredClone(rows),initialCustom:[]})));
  assert.equal(sent.length,0);assert.match(document.body.textContent,/Model’s winner: Adil/);assert.match(document.body.textContent,/Model score 85 \/ 100/);assert.match(document.body.textContent,/Does not match your saved winner/);assert.match(document.body.textContent,/Model got the winner wrong · 1/);assert.match(document.body.textContent,/Suggested last bounce: Bounce 1/);
  await act(async()=>button('Confirm last bounce').click());
  assert.equal(sent.at(-1).label.bounceReview.lastBounce,'detected:0');assert.equal(sent.at(-1).label.reason,null);assert.equal(sent.at(-1).label.note,'preserve me');assert.equal(sent.at(-1).label.rallyReview.runId,'pose-last-bounce-20260924-v1');
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Bounce details')).click());
  const bounceSelect=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='detected:0'));
  await act(async()=>{bounceSelect.value='detected:0';bounceSelect.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.equal(button('Confirm'),undefined);assert.ok(!document.body.textContent.includes('Old floor suggestion'));
  await act(async()=>button('Next point to review').click());assert.match(document.querySelector('h2').textContent,/Point 2/);assert.equal(button('Confirm last bounce'),undefined);
  await act(async()=>button('Keep my last-bounce mark').click());assert.equal(sent.at(-1).label.bounceReview.lastBounce,'detected:1');assert.equal(sent.at(-1).label.reason,'net');assert.equal(sent.at(-1).label.note,'human');
  await act(async()=>button('Previous point').click());assert.match(document.body.textContent,/Confirmed suggestion/);
  await act(async()=>button('Clear my mark: no live table bounce').click());assert.equal(sent.at(-1).label.bounceReview.lastBounce,null);assert.equal(sent.at(-1).label.rallyReview.outcome,'no_live_bounce');assert.equal(sent.at(-1).label.note,'preserve me');assert.match(document.body.textContent,/Reviewed: no live table bounce/);
  await act(async()=>button('Cannot tell from this footage').click());assert.equal(sent.at(-1).label.rallyReview.outcome,'uncertain');assert.match(document.body.textContent,/Reviewed: cannot tell/);
  await act(async()=>button('No live table bounce occurred').click());assert.equal(sent.at(-1).label.rallyReview.outcome,'no_live_bounce');

 }finally{await act(async()=>root.unmount());dom.window.close();Object.assign(globalThis,old);globalThis.fetch=previousFetch;}
});
