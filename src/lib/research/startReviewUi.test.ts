import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {act,createElement,type ComponentType} from 'react';
import {createRoot} from 'react-dom/client';
import ts from 'typescript';
import * as pointEndings from './pointEndings.ts';
import * as cutReview from './cutReview.ts';
import * as startReview from './startReview.ts';

const require=createRequire(import.meta.url);
const {JSDOM}=require('jsdom');
const file=new URL('../../app/research/point-endings/CutReview.tsx',import.meta.url);
const compiled=ts.transpileModule(readFileSync(file,'utf8'),{fileName:fileURLToPath(file),compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
const loaded={exports:{} as {CutReview:ComponentType<Record<string,unknown>>}};
const imports:Record<string,unknown>={'@/lib/research/pointEndings':pointEndings,'@/lib/research/cutReview':cutReview,'@/lib/research/startReview':startReview};
new Function('require','module','exports',compiled.outputText)((id:string)=>imports[id]??require(id),loaded,loaded.exports);

test('comparison seeks exact raw times and saves a verdict against the current mark without editing boundaries',async()=>{
 const dom=new JSDOM('<div id="root"></div>');
 const previous={window:globalThis.window,document:globalThis.document};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const container=document.getElementById('root')!;
 const root=createRoot(container);
 const seeks:number[]=[],verdicts:unknown[]=[],marks:unknown[]=[];
 const props={initialOpen:true,start:10,end:20,ready:true,currentTime:()=>12.5,value:{version:1,serveStart:12,pointEnd:19},startCase:{pointId:'case',runId:startReview.START_REVIEW_RUN_ID,proposedStart:13.125,recordedServeTap:11},onSeek:(time:number)=>seeks.push(time),onChange:(value:unknown)=>marks.push(value),onStartReview:(value:unknown)=>verdicts.push(value)};
 try {
  await act(async()=>root.render(createElement(loaded.exports.CutReview,props)));
  assert.match(container.textContent??'',/Saved serve mark/);
  assert.match(container.textContent??'',/\+1\.125 s/);
  for(const label of ['Go to saved serve mark','Go to proposed start'])await act(async()=>{Array.from(container.querySelectorAll('button')).find(b=>b.textContent===label)!.click();});
  assert.deepEqual(seeks,[12,13.125]);
  const select=container.querySelector('select')!;
  await act(async()=>{select.value='no';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.deepEqual(verdicts,[{runId:startReview.START_REVIEW_RUN_ID,outcome:'no',observedServeStart:12}]);
  assert.deepEqual(marks,[]);
  await act(async()=>root.render(createElement(loaded.exports.CutReview,{...props,value:{version:1,serveStart:14,pointEnd:19},startReview:verdicts[0]})));
  assert.equal(container.querySelector('select')!.value,'');
  assert.match(container.textContent??'',/serve mark changed/);
  assert.match(container.textContent??'',/−0\.875 s/);
  await act(async()=>root.render(createElement(loaded.exports.CutReview,{...props,value:undefined})));
  assert.match(container.textContent??'',/Recorded serve tap/);
  await act(async()=>{Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Go to recorded serve tap')!.click();});
  assert.equal(seeks.at(-1),11);
 } finally {
  await act(async()=>root.unmount());
  dom.window.close();Object.assign(globalThis,previous);
 }
});
