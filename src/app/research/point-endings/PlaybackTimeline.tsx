'use client';

import {useEffect,useState,type RefObject} from 'react';
import {clock} from '@/lib/research/pointEndings';

/** Playback ticks update this small control, never the full labeling page. */
export function PlaybackTimeline({video,start,end,fps,rawOffset,ready,onSeek}:{video:RefObject<HTMLVideoElement|null>;start:number;end:number;fps:number;rawOffset:number;ready:boolean;onSeek:(time:number)=>void}) {
 const [time,setTime]=useState(start);
 useEffect(()=>{
  const v=video.current;if(!v)return;
  const update=()=>setTime(v.currentTime);
  const events=['seeking','timeupdate','seeked','loadedmetadata'];
  events.forEach(event=>v.addEventListener(event,update));update();
  return()=>events.forEach(event=>v.removeEventListener(event,update));
 },[video,start,end,ready]);
 return <>
  <label className="mt-3 block text-xs text-zinc-400">Point playback<input aria-label="Point playback" className="mt-2 block w-full accent-cyan-400" type="range" min={start} max={end} step={1/fps} value={Math.max(start,Math.min(end,time))} onChange={e=>{const at=Number(e.target.value);setTime(at);onSeek(at);}} disabled={!ready}/></label>
  <div className="mt-2 flex items-center justify-between text-xs tabular-nums text-zinc-500"><span>Point {clock(Math.max(0,time-start))} / {clock(end-start)}</span><span>Match {clock(Math.max(0,time-rawOffset))}</span></div>
 </>;
}
