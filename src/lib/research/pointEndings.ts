export const ENDING_REASONS = [
  ['long','Ball went long without a table bounce'],
  ['wide','Ball went wide without a table bounce'],
  ['net','Ball hit the net and did not continue'],
  ['missed_return','Legal bounce, then missed return or winner'],
  ['double_bounce','Ball bounced twice'],
  ['serve_fault','Serve fault'],
  ['edge','Edge or side of the table'],
  ['continuing','Rally is still continuing'],
  ['unsure','Cannot tell from this footage'],
  ['custom','Other / custom reason'],
] as const;
export type EndingReason = typeof ENDING_REASONS[number][0];
export type EndingLabel = { reason: EndingReason | null; custom: string; note: string };
export type EndingSource = {
  matchName: string; slug: string; number: number; game: number; scoreBefore: number[];
  winner: string; server: string | null; start: number; end: number; tap: number | null;
  fps: number; rawOffset: number; sourceHash: string; imported: boolean;
};
export type EndingRow = {id:string; match_id:string; sequence:number; source:EndingSource; label:EndingLabel; revision:number};
export const EMPTY_LABEL: EndingLabel = {reason:null, custom:'', note:''};
export function validEndingLabel(value: unknown): value is EndingLabel {
  if(!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const x=value as Record<string,unknown>;
  return (x.reason === null || ENDING_REASONS.some(([key])=>key===x.reason)) &&
    typeof x.custom==='string' && x.custom.length<=120 &&
    (x.reason!=='custom' || x.custom.trim().length>0) &&
    typeof x.note==='string' && x.note.length<=4000;
}
export function savedLabel(label:EndingLabel) { return label.reason!==null; }
export function reasonText(label:EndingLabel) {
  return label.reason==='custom' ? label.custom : ENDING_REASONS.find(([key])=>key===label.reason)?.[1] ?? 'Not labeled';
}
export function nextUnlabeled(rows:EndingRow[], current?:string) {
  const i=rows.findIndex(r=>r.id===current);
  return [...rows.slice(i+1),...rows.slice(0,i+1)].find(r=>!savedLabel(r.label));
}
export function frameStep(time:number,delta:number,fps:number,start:number,end:number) {
  const frame=Math.floor(time*fps+0.00001);
  return Math.min(end,Math.max(start,(frame+delta+0.5)/fps));
}
export function clock(time:number) {
  return `${Math.floor(time/60)}:${(time%60).toFixed(2).padStart(5,'0')}`;
}
