'use client';

import {useEffect,useRef,type RefObject} from 'react';
import {BOUNCE_KINDS,type BounceReview} from '@/lib/research/pointEndings';
import {containedFrame,evidenceAt,type EndingEvidence} from '@/lib/research/endingEvidence';

/** Same fading tail and timed rings as Serve accuracy, fitted to the video's
 * contained frame. Drawing never re-renders the 479-point labeling list. */
export function BallEvidence({video,evidence,trail,bounces,review}:{video:RefObject<HTMLVideoElement|null>;evidence:EndingEvidence|null;trail:boolean;bounces:boolean;review?:BounceReview}) {
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const v=video.current,c=canvas.current;if(!v||!c)return;
  let raf:number|null=null,videoFrame:number|null=null;
  let lastTime=-1;
  const draw=()=>{
   const w=v.clientWidth,h=v.clientHeight;if(!w||!h)return;
   const density=window.devicePixelRatio||1;
   if(c.width!==Math.round(w*density)||c.height!==Math.round(h*density)){c.width=Math.round(w*density);c.height=Math.round(h*density);}
   const ctx=c.getContext('2d');if(!ctx)return;
   ctx.setTransform(density,0,0,density,0,0);ctx.clearRect(0,0,w,h);
   if(!evidence||(!trail&&!bounces)||v.readyState<2)return;
   const box=containedFrame(w,h,v.videoWidth||evidence.width,v.videoHeight||evidence.height);
   const state=evidenceAt(evidence,v.currentTime);
   if(trail)state.trail.forEach((p,i)=>{
    const x=box.x+p.x*box.width,y=box.y+p.y*box.height;
    ctx.strokeStyle='#facc15';ctx.fillStyle='#facc15';ctx.lineWidth=2;
    if(p.connect){const prev=state.trail[i-1];ctx.globalAlpha=0.15+0.5*p.fade;ctx.beginPath();ctx.moveTo(box.x+prev.x*box.width,box.y+prev.y*box.height);ctx.lineTo(x,y);ctx.stroke();}
    ctx.globalAlpha=0.3+0.7*p.fade;ctx.beginPath();ctx.arc(x,y,p.fade>0.88?4:2,0,Math.PI*2);ctx.fill();
   });
   if(bounces)for(const b of state.bounces){
    const x=box.x+b.x*box.width,y=box.y+b.y*box.height;
    ctx.globalAlpha=0.25+0.75*b.fade;ctx.strokeStyle='#f59e0b';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(x,y,5+7*(1-b.fade),0,Math.PI*2);ctx.stroke();
    ctx.globalAlpha=1;ctx.font='bold 12px sans-serif';ctx.lineWidth=3;ctx.strokeStyle='#09090b';ctx.strokeText(String(b.index),x+12,y-8);ctx.fillStyle='#fbbf24';ctx.fillText(String(b.index),x+12,y-8);
    const annotation=review?.events.find(e=>e.id===`detected:${b.index-1}`);
    const description=[annotation?BOUNCE_KINDS.find(([kind])=>kind===annotation.kind)?.[1]:null,review?.lastBounce===`detected:${b.index-1}`?'Last rally bounce':null].filter(Boolean).join(' · ');
    if(description){ctx.font='11px sans-serif';ctx.strokeText(description,Math.min(w-ctx.measureText(description).width-8,Math.max(8,x+12)),Math.min(h-8,y+12));ctx.fillText(description,Math.min(w-ctx.measureText(description).width-8,Math.max(8,x+12)),Math.min(h-8,y+12));}
   }
   ctx.globalAlpha=1;
   const added=review?.events.find(e=>e.rawTime!==undefined&&Math.abs(e.rawTime-v.currentTime)<=0.34);
   if(bounces&&added){ctx.fillStyle='#09090b';ctx.fillRect(6,6,Math.min(w-12,260),24);ctx.font='12px sans-serif';ctx.fillStyle='#a5f3fc';ctx.fillText(`Added: ${BOUNCE_KINDS.find(([k])=>k===added.kind)?.[1]}${review?.lastBounce===added.id?' · Last':''}`,12,22);}
  };
  const stop=()=>{
   if(raf!==null){cancelAnimationFrame(raf);raf=null;}
   if(videoFrame!==null){v.cancelVideoFrameCallback(videoFrame);videoFrame=null;}
  };
  const active=()=>!!evidence&&(trail||bounces)&&!document.hidden;
  const paint=()=>{if(!document.hidden){draw();lastTime=v.currentTime;}};
  const tick=()=>{
   raf=null;videoFrame=null;
   if(!active()||v.paused||v.ended)return;
   if(v.currentTime!==lastTime)paint();
   schedule();
  };
  const schedule=()=>{
   if(!active()||v.paused||v.ended||raf!==null||videoFrame!==null)return;
   // Match actual video frames rather than the phone's 60/120 Hz display.
   if(typeof v.requestVideoFrameCallback==='function')videoFrame=v.requestVideoFrameCallback(tick);
   else raf=requestAnimationFrame(tick);
  };
  const refresh=()=>{stop();paint();schedule();};
  const timeUpdate=()=>{if(v.paused&&active())paint();};
  const visibility=()=>{if(document.hidden)stop();else refresh();};
  const events=['seeked','loadeddata','play','pause','ended'];
  events.forEach(e=>v.addEventListener(e,refresh));
  v.addEventListener('timeupdate',timeUpdate);
  document.addEventListener('visibilitychange',visibility);
  const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(paint);
  resize?.observe(v);
  window.addEventListener('resize',paint);
  refresh();
  return()=>{
   stop();resize?.disconnect();window.removeEventListener('resize',paint);
   events.forEach(e=>v.removeEventListener(e,refresh));
   v.removeEventListener('timeupdate',timeUpdate);document.removeEventListener('visibilitychange',visibility);
   c.getContext('2d')?.clearRect(0,0,c.width,c.height);
  };
 },[video,evidence,trail,bounces,review]);
 return <canvas ref={canvas} aria-label="Ball trail and detected bounce overlay" className="pointer-events-none absolute inset-0 h-full w-full"/>;
}
