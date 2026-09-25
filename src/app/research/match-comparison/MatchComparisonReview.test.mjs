import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const require=createRequire(import.meta.url);
const component=fileURLToPath(new URL('./MatchComparisonReview.tsx',import.meta.url));
const fixture=fileURLToPath(new URL('../../../lib/research/matchComparisonFixture.ts',import.meta.url));
const bundle=await build({stdin:{contents:`export {MatchComparisonReview} from ${JSON.stringify(component)};export {MATCH_COMPARISON_FIXTURE} from ${JSON.stringify(fixture)};`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',jsx:'automatic',write:false,plugins:[{name:'react-test-render',setup(b){
 b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`import React from 'react';export default function Link(props){return React.createElement('a',props,props.children)}`}));
}}]});
const {MatchComparisonReview,MATCH_COMPARISON_FIXTURE:row}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('actual empty component renders without reading media from null',()=>{
 const html=renderToStaticMarkup(React.createElement(MatchComparisonReview,{initialRows:[]}));
 assert.match(html,/No comparisons have been loaded yet/);assert.doesNotMatch(html,/<video/);
});
test('actual component displays the supplied winner score and explicit unavailable state',()=>{
 const scored=renderToStaticMarkup(React.createElement(MatchComparisonReview,{initialRows:[{...row,source:{...row.source,predictedWinner:{...row.source.predictedWinner,decisionScore:.95}}}]}));
 assert.match(scored,/95\.0 \/ 100/);
 const unavailable=renderToStaticMarkup(React.createElement(MatchComparisonReview,{initialRows:[{...row,source:{...row.source,predictedWinner:{...row.source.predictedWinner,decisionScore:null}}}]}));
 assert.match(unavailable,/Not available/);
});
test('actual edits survive unmount/remount and newer revisions retain drafts as blocked conflicts',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://local.test/research/match-comparison'});
 const names=['window','document','navigator','HTMLElement','IS_REACT_ACT_ENVIRONMENT','fetch'];
 const saved=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,fetch:async()=>({ok:true,json:async()=>({url:'data:video/mp4;base64,'})})}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 dom.window.HTMLMediaElement.prototype.pause=function(){};
 const {createRoot}=await import('react-dom/client');let root;
 const mount=async(value)=>{root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(MatchComparisonReview,{initialRows:[value]}));});};
 const start=()=>Array.from(document.querySelectorAll('label')).find(l=>l.textContent.startsWith('Point start')).querySelector('select');
 try{
  await mount(row);
  await act(async()=>{start().value='both';start().dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  const key=Object.keys(window.sessionStorage).find(k=>k.includes(row.id));assert.ok(key);assert.equal(JSON.parse(window.sessionStorage.getItem(key)).review.start,'both');
  await act(async()=>{root.unmount();});await mount(structuredClone(row));assert.equal(start().value,'both');assert.match(document.body.textContent,/Changes not saved/);
  await act(async()=>{root.unmount();});await mount({...structuredClone(row),revision:1});assert.equal(start().value,'both');assert.match(document.body.textContent,/saved review changed while you were away/);
  const save=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save review');assert.equal(save.disabled,true);assert.equal(JSON.parse(window.sessionStorage.getItem(key)).revision,0);
 }finally{
  if(root)await act(async()=>{root.unmount();});dom.window.close();for(const key of names){const descriptor=saved.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
