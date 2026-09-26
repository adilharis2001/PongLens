import type {EndingEvidence} from './endingEvidence';
/** Strict bounds keep corrupt snapshots from drawing outside the source frame. */
export function isComparisonEvidence(value:unknown):value is EndingEvidence {
 if(!value||typeof value!=='object')return false;
 const v=value as Record<string,unknown>;
 const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
 const unit=(n:unknown)=>finite(n)&&n>=0&&n<=1;
 const time=(n:unknown)=>finite(n)&&n>=0;
 if(!finite(v.width)||v.width<=0||!finite(v.height)||v.height<=0||v.rawOffset!==0||typeof v.lineage!=='string')return false;
 if(!Array.isArray(v.track)||v.track.length>30000||!v.track.every(p=>Array.isArray(p)&&p.length===3&&time(p[0])&&unit(p[1])&&unit(p[2])))return false;
 if(!v.track.every((p,i,a)=>i===0||p[0]>a[i-1][0]))return false;
 if(!Array.isArray(v.bounces)||v.bounces.length>3000||!v.bounces.every(b=>b&&time(b.t)&&unit(b.x)&&unit(b.y)))return false;
 if(!v.bounces.every((b,i,a)=>i===0||b.t>=a[i-1].t))return false;
 return Array.isArray(v.tableCorners)&&v.tableCorners.length===4&&v.tableCorners.every(p=>Array.isArray(p)&&p.length===2&&p.every(unit));
}
