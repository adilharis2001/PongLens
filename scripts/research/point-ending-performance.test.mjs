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

for(const videoFrames of [false,true])test(`playback leaves labels alone and stops idle drawing (${videoFrames?'video frames':'RAF fallback'})`,async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
 const old={};
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
  old[key]=globalThis[key];globalThis[key]=value;
 }
 let serial=0,draws=0,reads=0;
 const frames=new Map();
 if(videoFrames){
  dom.window.HTMLVideoElement.prototype.requestVideoFrameCallback=callback=>{frames.set(++serial,callback);return serial;};
  dom.window.HTMLVideoElement.prototype.cancelVideoFrameCallback=id=>frames.delete(id);
 }
 const previousRAF=globalThis.requestAnimationFrame,previousCancel=globalThis.cancelAnimationFrame,previousFetch=globalThis.fetch;
 globalThis.requestAnimationFrame=callback=>{frames.set(++serial,callback);return serial;};
 globalThis.cancelAnimationFrame=id=>frames.delete(id);
 Object.defineProperties(dom.window.HTMLMediaElement.prototype,{readyState:{get:()=>2},paused:{get(){return !this.dataset.playing;}},videoWidth:{get:()=>1920},videoHeight:{get:()=>1080}});
 dom.window.HTMLMediaElement.prototype.pause=function(){delete this.dataset.playing;this.dispatchEvent(new dom.window.Event('pause'));};
 dom.window.HTMLMediaElement.prototype.play=function(){this.dataset.playing='yes';this.dispatchEvent(new dom.window.Event('play'));return Promise.resolve();};
 dom.window.HTMLCanvasElement.prototype.getContext=()=>({setTransform(){},clearRect(){draws++;}});
 Object.defineProperties(dom.window.HTMLVideoElement.prototype,{clientWidth:{get:()=>361},clientHeight:{get:()=>203}});
 globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('/media')?{url:'http://localhost/test.mp4'}:{id:'p0',evidence:{width:1920,height:1080,rawOffset:0,track:[],bounces:[],lineage:'Test'}}});
 const rows=Array.from({length:479},(_,i)=>({id:`p${i}`,match_id:`m${i%6}`,sequence:i,revision:0,source:{matchName:`Match ${i%6}`,slug:'test',number:i+1,game:1,scoreBefore:[0,0],winner:'Near',server:'Near',start:0,end:20,tap:18,fps:30,rawOffset:0,sourceHash:'test',imported:false},label:{get reason(){reads++;return null;},custom:'',note:''}}));
 const root=createRoot(document.getElementById('root'));
 try{
  await act(async()=>{root.render(React.createElement(PointEndingReview,{initialRows:rows,initialCustom:[]}));});
  const video=document.querySelector('video');assert.ok(video);
  const beforeDraws=draws;
  for(let i=0;i<60;i++)await act(async()=>{const pending=[...frames];frames.clear();for(const [,callback]of pending)callback(i*16.7);});
  const idleDraws=draws-beforeDraws;
  reads=0;
  for(let i=0;i<10;i++)await act(async()=>{video.currentTime=2+i/10;video.dispatchEvent(new dom.window.Event('timeupdate'));});
  console.log(JSON.stringify({idleFrames:60,idleDraws,playbackUpdates:10,labelReads:reads}));
  assert.equal(idleDraws,0,'a paused video must not repaint continuously');
  assert.equal(reads,0,'updating the playback clock must not inspect any point labels');
  assert.match(document.body.textContent,/Point 0:02.90/);
  await act(async()=>{document.querySelector('[aria-label="Forward one frame"]').click();});
  assert.ok(video.currentTime>2.9,'frame step reads actual current video time');
  await act(async()=>video.dispatchEvent(new dom.window.Event('seeking')));
  assert.equal(Number(document.querySelector('[aria-label="Point playback"]').value),video.currentTime,'clock follows a seek before the target frame finishes loading');
  const flushFrame=async()=>act(async()=>{const pending=[...frames];frames.clear();for(const [,callback]of pending)callback(1000);});
  await act(async()=>{video.dispatchEvent(new dom.window.Event('seeked'));});
  assert.equal(frames.size,0,'paused frame stepping schedules no loop');
  await act(async()=>{await video.play();});
  assert.equal(frames.size,1,'playing schedules exactly one callback');
  const playingDraws=draws;
  await flushFrame();assert.equal(draws,playingDraws,'stalled video does not repaint identical frames');
  video.currentTime+=1/30;await flushFrame();assert.equal(draws,playingDraws+1,'new video frame paints');
  Object.defineProperty(document,'hidden',{value:true,configurable:true});
  await act(async()=>document.dispatchEvent(new dom.window.Event('visibilitychange')));
  assert.equal(frames.size,0,'hidden tab cancels drawing');
  const hiddenDraws=draws;
  await act(async()=>video.dispatchEvent(new dom.window.Event('seeked')));
  assert.equal(draws,hiddenDraws,'hidden seeks do not draw');
  Object.defineProperty(document,'hidden',{value:false,configurable:true});
  await act(async()=>document.dispatchEvent(new dom.window.Event('visibilitychange')));
  assert.equal(frames.size,1,'visible playback resumes drawing');
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
  await act(async()=>{button('Ball trail').click();button('Detected bounces').click();});
  assert.equal(frames.size,0,'disabled overlays do not schedule work');
  await act(async()=>button('Ball trail').click());
  assert.equal(frames.size,1,'enabling an overlay resumes work');
  await act(async()=>video.pause());
  assert.equal(frames.size,0,'pausing cancels pending work');
  const pausedDraws=draws;
  await act(async()=>window.dispatchEvent(new dom.window.Event('resize')));
  assert.equal(draws,pausedDraws+1,'paused overlay redraws when the player resizes');
 }finally{
  await act(async()=>root.unmount());assert.equal(frames.size,0,'unmount cancels all work');dom.window.close();
  Object.assign(globalThis,old);globalThis.requestAnimationFrame=previousRAF;globalThis.cancelAnimationFrame=previousCancel;globalThis.fetch=previousFetch;
 }
});
