import type { BallLabel } from './activeBall';
export type BallEvaluation = {run_id:string;sample_id:string;model:string;prediction:(BallLabel & {reason?:string})|null;reference_label:BallLabel;reference_revision:number};
export function ballDisagreement(reference:BallLabel,prediction:BallLabel|null):boolean {
  if(!prediction || reference.state!==prediction.state)return true;
  return reference.state==='visible' && Math.hypot(reference.x!-prediction.x!,reference.y!-prediction.y!)>20;
}
export function comparisonSummary(rows:Pick<BallEvaluation,'reference_label'|'prediction'>[]) {
  const result={total:rows.length,visible:0,located:0,nonvisible:0,falseDetections:0,stateAgreement:0,disagreements:0,unanswered:0};
  for(const {reference_label:r,prediction:p} of rows) {
    result.stateAgreement+=Number(r.state===p?.state);
    result.unanswered+=Number(!p);
    result.disagreements+=Number(ballDisagreement(r,p));
    if(r.state==='visible'){result.visible++;if(!ballDisagreement(r,p))result.located++;}
    else {result.nonvisible++;if(p?.state==='visible')result.falseDetections++;}
  }
  return result;
}
