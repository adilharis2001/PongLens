/** Frozen detector evidence. Times are processed-match seconds; coordinates are
 * fractions of the full source frame. These are observations, never human labels. */
export type EndingEvidence = {
 width:number; height:number; rawOffset:number;
 track:[number,number,number][];
 bounces:{t:number;x:number;y:number}[];
 lineage:string;
};
export function containedFrame(w:number,h:number,sourceW:number,sourceH:number) {
 const scale=Math.min(w/sourceW,h/sourceH),width=sourceW*scale,height=sourceH*scale;
 return {x:(w-width)/2,y:(h-height)/2,width,height};
}
export function evidenceAt(evidence:EndingEvidence,rawTime:number) {
 const now=rawTime-evidence.rawOffset;
 const observations=evidence.track.filter(([t])=>now-t>=-0.00001&&now-t<=0.5);
 const trail=observations.map(([t,x,y],i)=>{
  const previous=observations[i-1];
  return {x,y,fade:Math.max(0,1-(now-t)/0.5),connect:!!previous&&t-previous[0]<=0.12&&Math.hypot(x-previous[1],y-previous[2])<=0.25};
 });
 const bounces=evidence.bounces.flatMap((b,i)=>Math.abs(now-b.t)<=0.34?[{...b,index:i+1,fade:1-Math.abs(now-b.t)/0.34}]:[]);
 return {trail,bounces};
}
