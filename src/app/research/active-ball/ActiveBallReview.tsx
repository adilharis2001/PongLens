'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { sourcePoint, type BallLabel, type BallSample } from '@/lib/research/activeBall';

export function ActiveBallReview({initial}:{initial:BallSample[]}) {
  const [rows,setRows] = useState(initial);
  const [index,setIndex] = useState(0);
  const [urls,setUrls] = useState<string[]>([]);
  const [frame,setFrame] = useState(1);
  const [label,setLabel] = useState<BallLabel|null>(initial[0]?.label ?? null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [showPrediction,setShowPrediction] = useState(false);
  const [zoom,setZoom] = useState(1);
  const [loadedImage,setLoadedImage] = useState('');
  const media = useRef<HTMLDivElement>(null);
  const sample = rows[index];
  const dirty = JSON.stringify(label) !== JSON.stringify(sample?.label ?? null);
  useEffect(()=>{
    const box=media.current;
    if(!box || !sample)return;
    const x=sample.corners.reduce((s,p)=>s+p[0],0)/4/sample.width;
    const y=sample.corners.reduce((s,p)=>s+p[1],0)/4/sample.height;
    box.scrollLeft=x*box.scrollWidth-box.clientWidth/2;
    box.scrollTop=y*box.scrollHeight-box.clientHeight/2;
  },[zoom,sample]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  useEffect(()=>{
    if (!sample) return;
    const controller = new AbortController();
    setUrls([]); setFrame(1); setLabel(sample.label); setMessage('');
    fetch(`/api/research/active-ball?id=${sample.id}`,{signal:controller.signal}).then(async r=>{
      const data = await r.json(); if (!r.ok) throw new Error(data.error); setUrls(data.urls);
    }).catch(e=>{if (e.name !== 'AbortError') setMessage('Could not load frames. Reload to try again.');});
    return ()=>controller.abort();
  // Label updates after saving should not reload the frames.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sample?.id]);
  async function save() {
    if (!label || !sample) return;
    setBusy(true); setMessage('');
    try {
      const r = await fetch('/api/research/active-ball',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:sample.id,revision:sample.revision,label})});
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setRows(old=>old.map(s=>s.id === sample.id ? {...s,...data.saved} : s)); setMessage('Saved.');
    } catch(e) {setMessage(e instanceof Error ? e.message : 'Could not save.');}
    finally {setBusy(false);}
  }
  const button = 'rounded-full border border-zinc-700 px-4 py-2 text-sm disabled:opacity-40';
  return <main className="mx-auto max-w-6xl p-4 text-zinc-100">
    <Link href="/research" className={button} aria-disabled={dirty || busy} onClick={e=>{if(dirty || busy){e.preventDefault();setMessage('Save or discard your label before leaving.');}}}>Research</Link>
    <h1 className="my-5 text-2xl font-semibold">Active ball</h1>
    {!sample ? <p>No samples yet.</p> : <>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm"><span>{index+1} of {rows.length}</span><span>{sample.venue}</span><span>{sample.time_s.toFixed(3)}s</span><span>{rows.filter(r=>r.label).length} reviewed</span></div>
      <div ref={media} className="mx-auto w-full overflow-auto bg-black" style={{aspectRatio:`${sample.width}/${sample.height}`}}>
      <div className="relative" style={{width:`${zoom*100}%`,aspectRatio:`${sample.width}/${sample.height}`}}>
        {urls[frame] ? <img key={`${sample.id}:${frame}`} src={urls[frame]} alt={frame === 1 ? 'Mark the active ball in this frame' : 'Neighbouring frame for context'} className="absolute inset-0 h-full w-full" draggable={false} onLoad={()=>setLoadedImage(`${sample.id}:${frame}`)} onError={()=>{setLoadedImage('');setMessage('Could not load this frame. Reload to try again.');}} onClick={e=>{
          if(frame !== 1 || busy || loadedImage !== `${sample.id}:${frame}` || !e.currentTarget.complete || !e.currentTarget.naturalWidth) return;
          const box = e.currentTarget.getBoundingClientRect();
          const [x,y] = sourcePoint(e.clientX-box.left,e.clientY-box.top,box.width,box.height,sample.width,sample.height);
          setLabel({state:'visible',x,y});setMessage('');
        }}/> : <div className="absolute inset-0 grid place-items-center">Loading frames…</div>}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${sample.width} ${sample.height}`}><polygon points={sample.corners.map(p=>p.join(',')).join(' ')} fill="none" stroke="rgba(34,211,238,.55)" strokeWidth="2"/></svg>
        {frame === 1 && label?.state === 'visible' && <span className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-400" style={{left:`${label.x!/sample.width*100}%`,top:`${label.y!/sample.height*100}%`}}/>}
        {frame === 1 && showPrediction && sample.prediction?.state === 'visible' && <span className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 border-2 border-pink-400" style={{left:`${sample.prediction.x!/sample.width*100}%`,top:`${sample.prediction.y!/sample.height*100}%`}}/>}
      </div>
      </div>
      <div className="my-3 flex flex-wrap gap-2">{['Previous frame','Label this frame','Next frame'].map((name,i)=><button key={name} className={`${button} ${frame===i?'border-cyan-400':''}`} onClick={()=>setFrame(i)}>{name}</button>)}<button className={button} onClick={()=>setZoom(z=>z===4?1:z*2)}>Zoom {zoom}×</button></div>
      <p className="my-3 text-sm">Tap the ball playing on the selected table in the middle frame. Use the neighbouring frames to check which ball it is.</p>
      <div className="flex flex-wrap gap-2">{(['hidden','absent','unsure'] as const).map(state=><button disabled={busy} key={state} className={`${button} ${label?.state===state?'border-cyan-400':''}`} onClick={()=>{setLabel({state,x:null,y:null});setMessage('');}}>{({hidden:'Hidden',absent:'No active ball',unsure:'Unsure'})[state]}</button>)}<button className={`${button} bg-cyan-950`} disabled={!label || busy} onClick={save}>{busy?'Saving…':'Save label'}</button></div>
      <p role="status" className="my-3 min-h-5 text-sm">{message}</p>
      {dirty && <div className="my-3 flex items-center gap-2 text-sm"><span>Unsaved label</span><button className={button} disabled={busy} onClick={()=>setLabel(sample.label)}>Discard change</button></div>}
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || dirty || index===0} onClick={()=>setIndex(i=>i-1)}>Previous sample</button><button className={button} disabled={busy || dirty || index===rows.length-1} onClick={()=>setIndex(i=>i+1)}>Next sample</button></div>
      <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" checked={showPrediction} onChange={e=>setShowPrediction(e.target.checked)}/>Show model prediction</label>
      {showPrediction && <p className="mt-2 text-sm text-zinc-400">{sample.model_run ? `Run ${sample.model_run}. Pink square: prediction. Cyan circle: your label.` : 'No prediction for this sample yet.'}</p>}
    </>}
  </main>;
}
