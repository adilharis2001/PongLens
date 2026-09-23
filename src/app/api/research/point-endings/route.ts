import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validEndingLabel, normalizeEndingLabel, sameEndingLabel, bounceReviewInPoint } from '@/lib/research/pointEndings';
import {suggestionKeys,validSuggestion,type EndingSuggestion} from '@/lib/research/endingSuggestions';
import {validRallyPrediction} from '@/lib/research/rallyPredictions';
export const runtime='nodejs';
export async function POST(request:Request) {
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user || (await db.rpc('is_admin')).data!==true) return NextResponse.json({error:'Not permitted'},{status:403});
  let body;
  try {body=await request.json();} catch {return NextResponse.json({error:'Invalid request'},{status:400});}
  if(!body || !/^[0-9a-f-]{36}$/i.test(body.id??'') || !Number.isSafeInteger(body.revision) || body.revision<0 || !validEndingLabel(body.label))
    return NextResponse.json({error:'Choose a reason or enter a custom reason.'},{status:400});
  const {data:current,error:readError}=await db.from('point_ending_research').select('id,label,revision,source').eq('id',body.id).eq('batch','out-ball-479-v1').maybeSingle();
  if(readError)return NextResponse.json({error:'Could not load the saved answer. Try again.'},{status:500});
  if(!current)return NextResponse.json({error:'Point not found.'},{status:404});
  // Preserve optional bounce/contact answers omitted by older open tabs.
  const label=normalizeEndingLabel(body.label,current.label);
  if(label.bounceReview){
    const {data:evidence,error:evidenceError}=await db.from('point_ending_evidence').select('payload').eq('point_id',body.id).maybeSingle();
    if(evidenceError||!evidence)return NextResponse.json({error:'Could not load bounce references. Try again.'},{status:503});
    if(!bounceReviewInPoint(label.bounceReview,current.source,evidence.payload.bounces.length))return NextResponse.json({error:'Choose a bounce or frame within this point.'},{status:400});
  }
  if(label.suggestionReview){
    const {data:suggestion,error:suggestionError}=await db.from('point_ending_suggestions').select('payload').eq('point_id',body.id).eq('run_id',label.suggestionReview.runId).maybeSingle();
    if(suggestionError)return NextResponse.json({error:'Could not load the original suggestion. Try again.'},{status:503});
    if(!suggestion||!validSuggestion(suggestion.payload,10000)||!label.suggestionReview.fields.every(k=>suggestionKeys(suggestion.payload as EndingSuggestion).includes(k)))return NextResponse.json({error:'This suggestion is no longer available. Reload before reviewing it.'},{status:400});
  }
  if(label.rallyReview){
    const [{data:prediction,error:predictionError},{data:evidence,error:evidenceError}]=await Promise.all([
      db.from('point_ending_suggestions').select('payload').eq('point_id',body.id).eq('run_id',label.rallyReview.runId).maybeSingle(),
      db.from('point_ending_evidence').select('payload').eq('point_id',body.id).maybeSingle()
    ]);
    if(predictionError||evidenceError)return NextResponse.json({error:'Could not load the experiment. Try again.'},{status:503});
    if(!prediction||!evidence||!validRallyPrediction(prediction.payload,evidence.payload.bounces.length,current.source))return NextResponse.json({error:'This experiment is unavailable. Reload before reviewing it.'},{status:400});
  }
  const {data,error}=await db.from('point_ending_research').update({label,revision:body.revision+1}).eq('id',body.id).eq('batch','out-ball-479-v1').eq('revision',body.revision).select('id,label,revision').maybeSingle();
  if(error) return NextResponse.json({error:'Could not save. Your answer is still on this page.'},{status:500});
  if(!data) {
    const {data:existing}=await db.from('point_ending_research').select('id,label,revision').eq('id',body.id).eq('batch','out-ball-479-v1').maybeSingle();
    if(existing && existing.revision===body.revision+1 && sameEndingLabel(existing.label,label))
      return NextResponse.json({saved:existing},{headers:{'Cache-Control':'private, no-store'}});
  }
  if(!data) return NextResponse.json({error:'This point changed in another window. Reload to see the saved answer before editing again.'},{status:409});
  return NextResponse.json({saved:data},{headers:{'Cache-Control':'private, no-store'}});
}
