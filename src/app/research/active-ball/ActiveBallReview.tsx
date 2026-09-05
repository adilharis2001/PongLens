'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sourcePoint, type BallLabel, type BallSample } from '@/lib/research/activeBall';

const secondary = 'min-h-11 rounded-full border border-edge px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-40';
const primary = 'min-h-11 w-full rounded-full border border-cyan-400/60 bg-cyan-500/15 px-5 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40';
const states = [
  {state:'hidden',title:'Ball is hidden',detail:'In play, but behind a player or another object.'},
  {state:'absent',title:'No active ball',detail:'Between points, held in a hand, or out of play.'},
  {state:'unsure',title:'Can’t tell',detail:'There isn’t enough evidence. No need to guess.'},
] as const;

export function ActiveBallReview({initial}:{initial:BallSample[]}) {
  const [rows,setRows] = useState(initial);
  const [index,setIndex] = useState(0);
  const [filter,setFilter] = useState('todo');
  const [venue,setVenue] = useState('all');
  const [blocked,setBlocked] = useState(false);
  const [notice,setNotice] = useState('');
  const revealNext = useRef(false);
  const shown = rows.filter(r=>(venue==='all'||r.venue===venue) && (filter==='all'||(filter==='todo'?!r.label:!!r.label)));
  const at = Math.min(index,Math.max(0,shown.length-1));
  const sample = shown[at];
  const reviewed = rows.filter(r=>r.label).length;
  useEffect(()=>{
    if(revealNext.current){window.scrollTo({top:0,behavior:'instant'});revealNext.current=false;}
  },[sample?.id]);
  function navigate(next:number) {
    if(blocked){setNotice('Save your label or discard the change before moving on.');return;}
    revealNext.current=true;setNotice('');setIndex(Math.max(0,Math.min(shown.length-1,next)));
  }
  useEffect(()=>{
    if(!blocked)return;
    const warn=(event:BeforeUnloadEvent)=>event.preventDefault();
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[blocked]);
  return <main className="min-h-dvh bg-arena text-zinc-100">
    <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-edge px-4 py-3 sm:px-6">
      <Link href="/research" className={secondary} onClick={e=>{if(blocked){e.preventDefault();setNotice('Save your label or discard the change before leaving.');}}}>← Research</Link>
      <h1 className="text-xl font-semibold tracking-tight">Active ball</h1>
      <span className="ml-auto text-sm text-zinc-400">{reviewed} / {rows.length} reviewed</span>
    </header>
    <div className="h-0.5 bg-zinc-900"><div className="h-full bg-cyan-400 transition-all" style={{width:`${rows.length?reviewed/rows.length*100:0}%`}}/></div>
    <div className="mx-auto max-w-[1600px] p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select aria-label="Review status" disabled={blocked} value={filter} onChange={e=>{setFilter(e.target.value);setIndex(0);setNotice('');}} className="min-h-11 rounded-full border border-edge bg-ink px-4 text-sm">
          <option value="todo">Not reviewed</option><option value="all">All examples</option><option value="done">Reviewed</option>
        </select>
        <select aria-label="Venue" disabled={blocked} value={venue} onChange={e=>{setVenue(e.target.value);setIndex(0);setNotice('');}} className="min-h-11 rounded-full border border-edge bg-ink px-4 text-sm">
          <option value="all">All venues</option>{[...new Set(rows.map(r=>r.venue))].map(v=><option key={v}>{v}</option>)}
        </select>
        <span className="ml-auto text-sm tabular-nums text-zinc-400">{sample?at+1:0} of {shown.length}</span>
      </div>
      {notice && <p role="status" className="mb-3 text-sm text-cyan-100">{notice}</p>}
      {sample ? <SampleEditor key={sample.id} sample={sample} onBlocked={setBlocked} onSaved={saved=>{
        revealNext.current=true;setBlocked(false);setRows(old=>old.map(r=>r.id===saved.id?{...r,...saved}:r));
        setIndex(filter==='todo'?at:Math.min(at+1,shown.length-1));setNotice('Label saved.');
      }} navigation={<div className="flex items-center gap-2">
        <button className={secondary} disabled={blocked||at===0} onClick={()=>navigate(at-1)} aria-label="Previous example">←</button>
        <button className={`${secondary} flex-1`} disabled={blocked||at===shown.length-1} onClick={()=>navigate(at+1)}>Skip for now →</button>
      </div>}/> : <div className="py-12"><p className="text-zinc-300">{filter==='todo'?'No unreviewed examples in this selection.':'No examples in this selection.'}</p><button className={`${secondary} mt-4 w-full sm:w-auto`} onClick={()=>{setFilter('all');setVenue('all');setIndex(0);}}>View all examples</button></div>}
    </div>
  </main>;
}

function SampleEditor({sample,onBlocked,onSaved,navigation}:{sample:BallSample;onBlocked:(v:boolean)=>void;onSaved:(v:Pick<BallSample,'id'|'label'|'revision'>)=>void;navigation:React.ReactNode}) {
  const [media,setMedia] = useState<{urls:string[];clipUrl:string}|null>(null);
  const [retry,setRetry] = useState(0);
  const [label,setLabel] = useState<BallLabel|null>(sample.label);
  const [busy,setBusy] = useState(false);
  const saving = useRef(false);
  const [error,setError] = useState('');
  const [loaded,setLoaded] = useState(false);
  const [watching,setWatching] = useState(false);
  const [clipError,setClipError] = useState(false);
  const [speed,setSpeed] = useState(.5);
  const [loop,setLoop] = useState(false);
  const [zoom,setZoom] = useState(1);
  const [prediction,setPrediction] = useState(false);
  const [table,setTable] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const dirty = JSON.stringify(label)!==JSON.stringify(sample.label);
  useEffect(()=>onBlocked(dirty||busy),[dirty,busy,onBlocked]);
  useEffect(()=>{
    const controller=new AbortController();setMedia(null);setLoaded(false);setClipError(false);setError('');
    fetch(`/api/research/active-ball?id=${sample.id}`,{signal:controller.signal}).then(async r=>{
      const d=await r.json();if(!r.ok)throw new Error('Could not load this example.');setMedia(d);
    }).catch(e=>{if(e.name!=='AbortError')setError('Could not load this example. Use Reload media to retry.');});
    return()=>controller.abort();
  },[sample.id,retry]);
  useEffect(()=>{
    const v=video.current;return()=>v?.pause();
  },[media]);
  useEffect(()=>{
    const el=box.current;if(!el)return;
    const x=sample.corners.reduce((s,p)=>s+p[0],0)/4/sample.width;
    const y=sample.corners.reduce((s,p)=>s+p[1],0)/4/sample.height;
    el.scrollLeft=x*el.scrollWidth-el.clientWidth/2;el.scrollTop=y*el.scrollHeight-el.clientHeight/2;
  },[zoom,sample]);
  const mark = useCallback(()=>{video.current?.pause();setWatching(false);},[]);
  const replay = useCallback(()=>{
    const v=video.current;if(!v||!media?.clipUrl)return;
    setClipError(false);v.currentTime=0;v.playbackRate=speed;setWatching(true);
    void v.play().catch(()=>{setWatching(false);setClipError(true);});
  },[media,speed]);
  const save = useCallback(async()=>{
    if(!label||saving.current)return;
    saving.current=true;setBusy(true);setError('');
    try {
      const r=await fetch('/api/research/active-ball',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:sample.id,revision:sample.revision,label})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not save. Try again.');
      mark();onBlocked(false);onSaved(d.saved);
    }catch(e){setError(e instanceof Error?e.message:'Could not save. Try again.');}
    finally{saving.current=false;setBusy(false);}
  },[label,sample.id,sample.revision,mark,onBlocked,onSaved]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(e.ctrlKey||e.metaKey||e.altKey||e.repeat||/^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test((e.target as HTMLElement)?.tagName))return;
      if(e.key===' '){e.preventDefault();if(watching)mark();else replay();}
      if(e.key==='Enter'&&!watching){e.preventDefault();void save();}
      if(e.key==='Escape')mark();
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[watching,mark,replay,save]);
  const selected = label?.state==='visible'?'Ball marked':states.find(s=>s.state===label?.state)?.title;
  return <div data-sample-id={sample.id} className="grid grid-cols-1 gap-4 lg:grid-cols-4 lg:items-start">
    <section className="min-w-0 lg:col-span-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span className="font-medium">{sample.venue}</span><span className="tabular-nums text-zinc-400">{sample.time_s.toFixed(3)}s</span><span className="text-zinc-500">{sample.split==='train'?'Training match':'Unseen venue'}</span></div>
      <div className="relative overflow-hidden rounded-xl border border-edge bg-black">
        <div ref={box} className={watching?'hidden':'w-full overflow-auto'} style={{aspectRatio:`${sample.width}/${sample.height}`}}>
          <div className="relative" style={{width:`${zoom*100}%`,aspectRatio:`${sample.width}/${sample.height}`}}>
            {media?.urls[1] ? <img src={media.urls[1]} alt="Frame to label" draggable={false} className="absolute inset-0 h-full w-full cursor-crosshair" onLoad={()=>setLoaded(true)} onError={()=>{setLoaded(false);setError('Frame unavailable. Use Reload media to retry.');}} onClick={e=>{
              if(!loaded||busy||watching||!e.currentTarget.complete||!e.currentTarget.naturalWidth)return;
              const b=e.currentTarget.getBoundingClientRect();const [x,y]=sourcePoint(e.clientX-b.left,e.clientY-b.top,b.width,b.height,sample.width,sample.height);
              setLabel({state:'visible',x,y});setError('');
            }}/> : <div className="absolute inset-0 grid place-items-center text-sm text-zinc-400">Loading frame…</div>}
            {table && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${sample.width} ${sample.height}`}><polygon points={sample.corners.map(p=>p.join(',')).join(' ')} fill="none" stroke="rgba(34,211,238,.6)" strokeWidth="2"/></svg>}
            {label?.state==='visible' && <span aria-label="Your ball mark" className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300" style={{left:`${label.x!/sample.width*100}%`,top:`${label.y!/sample.height*100}%`}}/>}
            {prediction && sample.prediction?.state==='visible' && <span className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 border-2 border-pink-400" style={{left:`${sample.prediction.x!/sample.width*100}%`,top:`${sample.prediction.y!/sample.height*100}%`}}/>}
          </div>
        </div>
        <div className={watching?'relative w-full':'hidden'} style={{aspectRatio:`${sample.width}/${sample.height}`}}>
          {media?.clipUrl && <video ref={video} src={media.clipUrl} playsInline muted loop={loop} controls={watching} preload="metadata" onEnded={mark} onError={()=>{setClipError(true);mark();}} className="absolute inset-0 h-full w-full"/>}
        </div>
        {!watching && <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/75 px-3 py-1 text-xs text-cyan-100">Frame to label</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={`${secondary} w-full sm:w-auto`} disabled={!media?.clipUrl||busy} onClick={watching?mark:replay}>{watching?'Mark this frame':'Replay clip'}</button>
        <select aria-label="Replay speed" className="min-h-11 rounded-full border border-edge bg-ink px-3 text-sm" value={speed} onChange={e=>{const n=Number(e.target.value);setSpeed(n);if(video.current)video.current.playbackRate=n;}}><option value={.25}>¼ speed</option><option value={.5}>½ speed</option><option value={1}>Normal speed</option></select>
        <label className="flex min-h-11 items-center gap-2 px-2 text-sm text-zinc-400"><input type="checkbox" checked={loop} onChange={e=>setLoop(e.target.checked)}/>Loop</label>
        <button className={`${secondary} ml-auto`} disabled={watching} onClick={()=>setZoom(z=>z===4?1:z*2)}>Zoom {zoom}×</button>
      </div>
      {clipError && <p className="mt-2 text-sm text-amber-200">Replay unavailable. You can still mark the frame or reload the media.</p>}
    </section>
    <aside className="w-full lg:row-span-2">
      <div className="lg:pt-0">
        <h2 className="text-lg font-semibold">Where is the active ball?</h2>
        <p className="mt-4 hidden text-sm leading-relaxed text-zinc-400 lg:block">Watch the replay if you need context, then click the centre of the ball in the labeled still. Only mark the ball playing on the outlined table.</p>
        <p className="mt-2 text-sm text-zinc-400 lg:hidden">Click the ball in the still, or choose an option.</p>
        <div className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-1">{states.map(s=><button key={s.state} disabled={busy||watching} aria-pressed={label?.state===s.state} className={`min-h-11 w-full rounded-xl border px-2 py-3 text-center lg:px-4 lg:text-left transition-colors disabled:opacity-40 ${label?.state===s.state?'border-cyan-400/60 bg-cyan-500/10':'border-edge hover:border-zinc-500'}`} onClick={()=>{setLabel({state:s.state,x:null,y:null});setError('');}}><span className="block text-sm text-zinc-100"><span className="lg:hidden">{s.state==='hidden'?'Hidden':s.state==='absent'?'No ball':'Can’t tell'}</span><span className="hidden lg:inline">{s.title}</span></span><span className="mt-1 hidden text-xs leading-relaxed text-zinc-400 lg:block">{s.detail}</span></button>)}</div>
        {label && label.state!=='visible' && <p className="mt-2 text-xs leading-relaxed text-zinc-400 lg:hidden">{states.find(s=>s.state===label.state)?.detail}</p>}
        <p className="my-3 text-sm text-cyan-100">{watching?'Watching context. Return to the still to label.':selected?`${selected}${dirty?' · not saved yet':' · saved'}`:''}</p>
        {error && <p role="status" className="mb-3 text-sm text-amber-200">{error}</p>}
        <button className={primary} disabled={!label||busy||watching} onClick={()=>void save()}>{busy?'Saving…':'Save and next'}</button>
        {dirty && <button className={`${secondary} mt-2 w-full`} disabled={busy} onClick={()=>{setLabel(sample.label);setError('');}}>Discard change</button>}
        <div className="mt-4">{navigation}</div>
        <p className="mt-4 hidden text-xs leading-relaxed text-zinc-500 lg:block">Space replays the clip. Enter saves and moves on. Skipping leaves the example unreviewed.</p>
      </div>
    </aside>
    <div className="min-w-0 lg:col-span-3">
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-zinc-400">
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={table} onChange={e=>setTable(e.target.checked)}/>Selected table</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={prediction} onChange={e=>setPrediction(e.target.checked)}/>Show model prediction</label>
      </div>
      {prediction && <p className="mt-1 text-sm text-zinc-400">{sample.prediction?.state==='visible'?'Pink square: model prediction.':sample.prediction?.state==='unsure'?'The model could not choose between candidates.':'The model did not locate a visible ball.'} Cyan circle: your mark. Accuracy has not been measured.</p>}
      <details className="mt-3 text-sm text-zinc-500"><summary className="cursor-pointer py-2">Example details</summary><p className="mt-2">{sample.model_run?`Run ${sample.model_run}.`:'No model run.'} Frame {sample.frame}. {sample.width} × {sample.height}.</p><button className={`${secondary} mt-3 w-full sm:w-auto`} disabled={busy} onClick={()=>{mark();setRetry(n=>n+1);}}>Reload media</button></details>
    </div>
  </div>;
}
