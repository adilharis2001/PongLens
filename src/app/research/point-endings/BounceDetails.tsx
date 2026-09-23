'use client';

import {useState} from 'react';
import {displayLabel,suggestionState,type EndingSuggestion} from '@/lib/research/endingSuggestions';
import {SuggestionHint} from './SuggestionHint';
import {EMPTY_LABEL,type SuggestionReview,BOUNCE_KINDS,EMPTY_BOUNCE_REVIEW,bounceFrameTime,clock,isRallyBounce,removeBounce,updateBounce,type BounceAnnotation,type BounceReview} from '@/lib/research/pointEndings';
import type {EndingEvidence} from '@/lib/research/endingEvidence';

const field='mt-2 w-full min-w-0 min-h-11 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-glow focus:outline-none';
const button='min-h-11 w-full rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40 sm:w-auto';
export function bounceName(id:string,review:BounceReview,start:number) {
 if(id.startsWith('detected:'))return `Bounce ${Number(id.slice(9))+1}`;
 const event=review.events.find(e=>e.id===id);
 return event?.rawTime!==undefined?`Added · ${clock(event.rawTime-start)}`:'Added bounce';
}

export function BounceDetails({value,suggestion,suggestionReview,onReviewSuggestion,evidence,start,end,ready,selected,onSelect,onChange,onSeek,currentTime}:{
 value?:BounceReview;suggestion?:EndingSuggestion;suggestionReview?:SuggestionReview;onReviewSuggestion?:(keys:string[],dismiss?:boolean)=>void;evidence:EndingEvidence|null;start:number;end:number;ready:boolean;selected:string;
 onSelect:(id:string)=>void;onChange:(review:BounceReview)=>void;onSeek:(time:number)=>void;currentTime:()=>number;
}) {
 const [open,setOpen]=useState(false);
 const review=value??EMPTY_BOUNCE_REVIEW;
 const actual={...EMPTY_LABEL,bounceReview:review,suggestionReview};
 const displayed=displayLabel(actual,suggestion).bounceReview??review;
 const detected=evidence?.bounces.map((b,i)=>({id:`detected:${i}`,rawTime:b.t+evidence.rawOffset}))??[];
 const added=review.events.filter(e=>e.id.startsWith('added:'));
 const choices=[...detected,...added];
 const choice=choices.find(e=>e.id===selected);
 const annotation=displayed.events.find(e=>e.id===selected);
 const kind=annotation?.kind??'table';
 const eventSuggestion=suggestion?.events.find(e=>e.id===selected);
 const eventState=suggestion?suggestionState(actual,suggestion,`event:${selected}`):'human';
 const lastState=suggestion?suggestionState(actual,suggestion,'lastBounce'):'human';
 function edit(patch:Partial<BounceAnnotation>){
  if(!choice)return;
  const event:BounceAnnotation={id:choice.id,kind,side:annotation?.side??null,...(choice.id.startsWith('added:')?{rawTime:choice.rawTime}:{}),...patch};
  onChange(updateBounce(review,event));
 }
 return <div className="mt-4 border-t border-edge pt-3">
  <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm text-zinc-300" aria-expanded={open} aria-controls="bounce-details" onClick={()=>setOpen(v=>!v)}>
   <span>Bounce details <span className="text-zinc-500">(optional)</span></span><span aria-hidden>{open?'−':'+'}</span>
  </button>
  {!open&&(review.events.length>0||review.lastBounce)&&<p className="text-xs text-zinc-500">{review.events.length} annotation{review.events.length===1?'':'s'}{review.lastBounce?` · Last rally bounce: ${bounceName(review.lastBounce,review,start)}`:''}</p>}
  {open&&<div id="bounce-details" className="space-y-3 pt-2">
   <p className="text-xs text-zinc-400">Skip any of these. Changes save automatically. To add a missed bounce, pause at the bounce frame.</p>
   <button type="button" className={button} disabled={!ready||!evidence||review.events.length>=200} onClick={()=>{
    const rawTime=bounceFrameTime(currentTime(),start,end);onSeek(rawTime);
    const event:BounceAnnotation={id:`added:${crypto.randomUUID()}`,rawTime,kind:'table',side:null};
    onChange(updateBounce(review,event));onSelect(event.id);
   }}>Add missed bounce at this frame</button>
   <label className="block text-sm text-zinc-300">Bounce to annotate
    <select className={field} value={choice?.id??''} onChange={e=>{const id=e.target.value;onSelect(id);const event=choices.find(c=>c.id===id);if(event?.rawTime!==undefined)onSeek(event.rawTime);}}>
     <option value="">Choose a bounce</option>
     {choices.map(e=><option key={e.id} value={e.id}>{bounceName(e.id,review,start)}{e.id.startsWith('detected:')?` · ${clock(e.rawTime!-start)}`:''}{displayed.lastBounce===e.id?' · Last rally bounce':''}</option>)}
    </select>
   </label>
   {choice&&<>
    <div className="grid gap-3 sm:grid-cols-2">
     <label className="block min-w-0 text-sm text-zinc-300">Event type
      <select className={`${field} ${eventState==='pending'?'border-amber-400/50 text-amber-100':''}`} value={annotation?.kind??''} onChange={e=>{if(e.target.value)edit({kind:e.target.value as BounceAnnotation['kind']});else if(eventState==='pending'){onReviewSuggestion?.([`event:${selected}`],true);}else {onChange(removeBounce(review,selected));}}}>
       {!choice.id.startsWith('added:')&&<option value="">Not annotated</option>}
       {BOUNCE_KINDS.filter(([key])=>(key!=='non_playing'&&key!=='rally')||key===kind).map(([key,text])=><option key={key} value={key}>{text}</option>)}
      </select>
     </label>
     <label className="block min-w-0 text-sm text-zinc-300">Side <span className="text-zinc-500">(optional)</span>
      <select className={`${field} ${eventState==='pending'?'border-amber-400/50 text-amber-100':''}`} value={annotation?.side??''} onChange={e=>edit({side:(e.target.value||null) as BounceAnnotation['side']})}>
       <option value="">Not specified</option><option value="near">Near the camera</option><option value="far">Far from the camera</option>
      </select>
     </label>
    </div>
    {eventSuggestion&&<SuggestionHint state={eventState} detail={eventSuggestion.detail} onConfirm={()=>onReviewSuggestion?.([`event:${selected}`])}/>}
    {kind==='table'&&<p className="text-xs text-zinc-400">Use Table bounce for a real bounce on the playing table during the point, including the serve. Serve bounce is optional detail.</p>}
    {kind==='serve'&&<p className="text-xs text-zinc-400">Either actual table bounce of the serve: first on the server’s side, then on the receiver’s side. These may not be the first two detected markers.</p>}
    {kind==='rally'&&<p className="text-xs text-zinc-400">A table bounce during play after the serve. You can use Table bounce for this; there is no need to relabel older answers.</p>}
    {kind==='net_clip'&&<p className="text-xs text-zinc-400">Contact with the net itself, not a table bounce. Play may continue after a clip.</p>}
    {kind==='net_bounce'&&<p className="text-xs text-zinc-400">A table bounce after a failed net shot has ended play. If play continues after a net clip, use Table bounce instead.</p>}
    {kind==='non_rally'&&<p className="text-xs text-zinc-400">On the playing table before the serve or after the point, including preparation, retrieving or passing the ball.</p>}
    {kind==='other_table'&&<p className="text-xs text-zinc-400">On a different table, outside this match.</p>}
    {kind==='ball_handling'&&<p className="text-xs text-zinc-400">A player’s handling motion was detected as a bounce, without an actual table bounce.</p>}
    {kind==='ceiling'&&<p className="text-xs text-zinc-400">The ball contacted the ceiling or an overhead object. Later table bounces are non-rally bounces.</p>}
    {kind==='other_non_bounce'&&<p className="text-xs text-zinc-400">A false bounce detection that does not fit another category. Add details in the optional note if helpful.</p>}
    {kind==='non_playing'&&<p className="text-xs text-zinc-400">Earlier label. Choose a more specific event type when you can identify what happened.</p>}
    <label className={`flex min-h-11 items-center gap-3 text-sm ${isRallyBounce(kind)?'text-zinc-300':'text-zinc-500'}`}>
     <input type="checkbox" className="h-5 w-5 shrink-0 accent-cyan-400" checked={displayed.lastBounce===selected} disabled={!isRallyBounce(kind)} onChange={e=>{if(!e.target.checked&&lastState==='pending'){onReviewSuggestion?.(['lastBounce'],true);return;}onChange({...review,lastBounce:e.target.checked?selected:null});}}/>
     Last bounce of the rally
    </label>
    {suggestion?.lastBounce.value===selected&&<SuggestionHint state={lastState} detail={suggestion.lastBounce.detail} onConfirm={()=>onReviewSuggestion?.(['lastBounce'])}/>}
    {!isRallyBounce(kind)&&<p className="text-xs text-zinc-500">Only a serve or rally table bounce can be the last rally bounce.</p>}
    {review.lastBounce&&<p className="text-xs text-cyan-100">Last rally bounce: {bounceName(review.lastBounce,review,start)}</p>}
    <div className="flex flex-col gap-2 sm:flex-row">
     <button type="button" className={button} disabled={!ready} onClick={()=>onSeek(choice.rawTime!)}>Go to this bounce</button>
     <button type="button" className={button} onClick={()=>{if(eventState==='pending')onReviewSuggestion?.([`event:${selected}`],true);else onChange(removeBounce(review,selected));if(selected.startsWith('added:'))onSelect('');}}>{selected.startsWith('added:')?'Remove added bounce':eventState==='pending'?'Clear this suggestion':'Clear this annotation'}</button>
    </div>
   </>}
  </div>}
 </div>;
}
