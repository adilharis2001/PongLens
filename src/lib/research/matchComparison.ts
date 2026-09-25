/** Frozen comparison inputs and separate, optional admin review answers. */
export const COMPARISON_BATCH='broader-pilot-20260925-v1';
export type ComparisonWindow={start:number;end:number};
export type ComparisonSide='near'|'far'|null;
export type ComparisonSource={
 schema:'match-comparison-v1';runId:typeof COMPARISON_BATCH;matchName:string;number:number;game:number|null;
 fps:number;duration:number;preview:ComparisonWindow;original:ComparisonWindow|null;proposed:ComparisonWindow|null;
 players:{near:string;far:string};
 /** Producer-supplied score for the selected winner; null for rules or abstentions without an applicable score. */
 predictedWinner:{side:ComparisonSide;name:string|null;decisionScore:number|null;threshold:number|null;branch:string|null};
 savedWinner:{side:ComparisonSide;name:string|null;basis:string};flags:string[];referencePointIds:string[];machinePointIds:string[];lineage:string;
};
export type TimingVerdict='current'|'proposed'|'both'|'neither'|'unsure'|null;
export type WinnerVerdict='prediction'|'saved'|'neither'|'unsure'|null;
export type ComparisonReview={version:1;runId:typeof COMPARISON_BATCH;start:TimingVerdict;end:TimingVerdict;winner:WinnerVerdict;note:string};
export type ComparisonRow={id:string;match_id:string;sequence:number;source:ComparisonSource;label:Record<string,unknown>;revision:number};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validComparisonId=(x:unknown):x is string=>typeof x==='string'&&uuid.test(x);
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const text=(x:unknown,max=200):x is string=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const side=(x:unknown)=>x===null||x==='near'||x==='far';
const score=(x:unknown)=>x===null||(finite(x)&&x>=0&&x<=1);
const nullableText=(x:unknown)=>x===null||text(x);
function windowIn(x:unknown,duration:number):x is ComparisonWindow {return object(x)&&finite(x.start)&&finite(x.end)&&x.start>=0&&x.end>x.start&&x.end<=duration;}
export function validComparisonSource(value:unknown):value is ComparisonSource {
 if(!object(value))return false;const x=value;
 if(x.schema!=='match-comparison-v1'||x.runId!==COMPARISON_BATCH||!text(x.matchName)||!Number.isSafeInteger(x.number)||(x.number as number)<1||!(x.game===null||(Number.isSafeInteger(x.game)&&(x.game as number)>0))||!finite(x.fps)||x.fps<=0||x.fps>240||!finite(x.duration)||x.duration<=0||!windowIn(x.preview,x.duration))return false;
 if(x.original===null&&x.proposed===null)return false;
 for(const window of [x.original,x.proposed])if(window!==null&&(!windowIn(window,x.duration)||window.start<x.preview.start||window.end>x.preview.end))return false;
 if(!object(x.players)||!text(x.players.near)||!text(x.players.far))return false;
 const p=x.predictedWinner,s=x.savedWinner;
 if(!object(p)||!side(p.side)||!nullableText(p.name)||!score(p.decisionScore)||!score(p.threshold)||!nullableText(p.branch))return false;
 if(!object(s)||!side(s.side)||!nullableText(s.name)||!text(s.basis,1000))return false;
 if(p.side!==null&&p.name!==x.players[p.side as string])return false;
 if(s.side!==null&&s.name!==x.players[s.side as string])return false;
 if(p.side===null&&(p.name!==null||p.decisionScore!==null))return false;
 return Array.isArray(x.flags)&&x.flags.length<=30&&x.flags.every(f=>text(f,500))&&Array.isArray(x.referencePointIds)&&x.referencePointIds.length<=100&&x.referencePointIds.every(validComparisonId)&&new Set(x.referencePointIds).size===x.referencePointIds.length&&Array.isArray(x.machinePointIds)&&x.machinePointIds.length<=100&&x.machinePointIds.every(id=>text(id,100))&&new Set(x.machinePointIds).size===x.machinePointIds.length&&text(x.lineage,2000);
}
export function emptyComparisonReview():ComparisonReview {return {version:1,runId:COMPARISON_BATCH,start:null,end:null,winner:null,note:''};}
export function validComparisonReview(value:unknown):value is ComparisonReview {
 if(!object(value)||Object.keys(value).some(k=>!['version','runId','start','end','winner','note'].includes(k)))return false;
 return value.version===1&&value.runId===COMPARISON_BATCH&&[null,'current','proposed','both','neither','unsure'].includes(value.start as TimingVerdict)&&[null,'current','proposed','both','neither','unsure'].includes(value.end as TimingVerdict)&&[null,'prediction','saved','neither','unsure'].includes(value.winner as WinnerVerdict)&&typeof value.note==='string'&&value.note.length<=4000;
}
/** Project only known review fields; future stored keys are preserved when saving. */
export function comparisonReview(label:Record<string,unknown>):ComparisonReview {
 const r=label.comparisonReview;if(!object(r))return emptyComparisonReview();
 const known={version:r.version,runId:r.runId,start:r.start,end:r.end,winner:r.winner,note:r.note};
 return validComparisonReview(known)?known:emptyComparisonReview();
}
export function mergeComparisonReview(label:Record<string,unknown>,review:ComparisonReview):Record<string,unknown>&{comparisonReview:ComparisonReview&Record<string,unknown>} {
 if(!validComparisonReview(review))throw new Error('Invalid comparison review');
 return {...label,comparisonReview:{...(object(label.comparisonReview)?label.comparisonReview:{}),...review}};
}
export function sameComparisonReview(a:ComparisonReview,b:ComparisonReview) {return a.version===b.version&&a.runId===b.runId&&a.start===b.start&&a.end===b.end&&a.winner===b.winner&&a.note===b.note;}
export function comparisonReviewAllowed(review:ComparisonReview,source:ComparisonSource) {
 return validComparisonReview(review)&&[review.start,review.end].every(v=>(v!=='current'||source.original!==null)&&(v!=='proposed'||source.proposed!==null)&&(v!=='both'||(source.original!==null&&source.proposed!==null)))&&(review.winner!=='prediction'||source.predictedWinner.side!==null)&&(review.winner!=='saved'||source.savedWinner.name!==null);
}
export function comparisonPlaybackWindow(source:ComparisonSource,choice:'current'|'proposed') {const window=choice==='current'?source.original:source.proposed;return window?{...window}:null;}
export function comparisonMediaKey(value:unknown):string|null {
 if(typeof value!=='string')return null;const match=/^r2:\/\/ponglens-raw\/([^/]+)\/([^/]+)\.(mov|mp4)$/.exec(value);
 return match&&validComparisonId(match[1])&&validComparisonId(match[2])?`${match[1]}/${match[2]}.${match[3]}`:null;
}
export function parseComparisonRow(value:unknown):ComparisonRow {
 if(!object(value)||!validComparisonId(value.id)||!validComparisonId(value.match_id)||!Number.isSafeInteger(value.sequence)||(value.sequence as number)<1||!Number.isSafeInteger(value.revision)||(value.revision as number)<0||!validComparisonSource(value.source)||!object(value.label))throw new Error('Comparison data is unavailable.');
 return {id:value.id,match_id:value.match_id,sequence:value.sequence as number,revision:value.revision as number,source:value.source,label:value.label};
}
