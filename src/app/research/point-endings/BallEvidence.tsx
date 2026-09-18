'use client';

import {useEffect,useRef,type RefObject} from 'react';
import {containedFrame,evidenceAt,type EndingEvidence} from '@/lib/research/endingEvidence';

/** Same fading tail and timed rings as Serve accuracy, fitted to the video's
 * contained frame. Drawing never re-renders the 479-point labeling list. */
export function BallEvidence({video,evidence,trail,bounces}:{video:RefObject<HTMLVideoElement|null>;evidence:EndingEvidence|null;trail:boolean;bounces:boolean}) {
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const v=video.current,c=canvas.current;if(!v||!c)return;
  let raf=0;
  const draw=()=>{
   const w=v.clientWidth,h=v.clientHeight;if(!w||!h)return;
   const density=window.devicePixelRatio||1;
   if(c.width!==Math.round(w*density)||c.height!==Math.round(h*density)){c.width=Math.round(w*density);c.height=Math.round(h*density);}
   const ctx=c.getContext('2d');if(!ctx)return;
   ctx.setTransform(density,0,0,density,0,0);ctx.clearRect(0,0,w,h);
   if(!evidence||v.readyState<2)return;
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
   }
   ctx.globalAlpha=1;
  };
  const loop=()=>{draw();raf=requestAnimationFrame(loop);};loop();
  // Paused seeks and metadata changes also redraw immediately.
  const events=['seeked','timeupdate','loadeddata'];events.forEach(e=>v.addEventListener(e,draw));
  return()=>{cancelAnimationFrame(raf);events.forEach(e=>v.removeEventListener(e,draw));c.getContext('2d')?.clearRect(0,0,c.width,c.height);};
 },[video,evidence,trail,bounces]);
 return <canvas ref={canvas} aria-label="Ball trail and detected bounce overlay" className="pointer-events-none absolute inset-0 h-full w-full"/>;
}
