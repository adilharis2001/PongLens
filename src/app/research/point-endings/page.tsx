import type {Metadata} from 'next';
import {notFound,redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {SUGGESTION_RUN_ID,type EndingSuggestion} from '@/lib/research/endingSuggestions';
import {RALLY_RUN_ID,type RallyPrediction} from '@/lib/research/rallyPredictions';
import {START_REVIEW_CASES} from '@/lib/research/startReviewCases';
import {RESEARCH_BATCHES,WINNER_CHECK_RUN_ID,validWinnerCheck,type WinnerCheck} from '@/lib/research/winnerCheck';
import type {EndingRow} from '@/lib/research/pointEndings';
import {PointEndingReview} from './PointEndingReview';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Point-ending labels',robots:{index:false,follow:false,nocache:true}};
// PostgREST caps a single response, so every list is read in pages.
const PAGE=1000;
async function all<T>(read:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>):Promise<T[]> {
 const out:T[]=[];
 for(let from=0;;from+=PAGE){
  const {data,error}=await read(from,from+PAGE-1);
  if(error)throw new Error('Could not load point-ending research');
  out.push(...(data??[]));
  if(!data||data.length<PAGE)return out;
 }
}
type RowRecord=Omit<EndingRow,'suggestion'|'rallyPrediction'|'check'>&{batch:string};
export default async function PointEndingPage({searchParams}:{searchParams:Promise<{review?:string}>}) {
 const requestedReview=(await searchParams).review;
 const cutReview=requestedReview==='cuts';
 const startReview=requestedReview==='starts';
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user) redirect(`/login?next=${encodeURIComponent('/research/point-endings'+(cutReview?'?review=cuts':startReview?'?review=starts':''))}`);
 if((await db.rpc('is_admin')).data!==true) notFound();
 const [rows,{data:custom,error:customError},suggestions]=await Promise.all([
   all<RowRecord>((from,to)=>db.from('point_ending_research').select('id,batch,match_id,sequence,source,label,revision').in('batch',[...RESEARCH_BATCHES]).order('batch').order('sequence').range(from,to)),
   db.from('point_ending_custom_reasons').select('name').order('name'),
   all<{point_id:string;run_id:string;payload:unknown}>((from,to)=>db.from('point_ending_suggestions').select('point_id,run_id,payload').in('run_id',[SUGGESTION_RUN_ID,RALLY_RUN_ID,WINNER_CHECK_RUN_ID]).order('run_id').order('point_id').range(from,to))
 ]);
 if(customError) throw new Error('Could not load point-ending research');
 const byRun=(run:string)=>new Map(suggestions.filter(r=>r.run_id===run).map(r=>[r.point_id,r.payload]));
 const endings=byRun(SUGGESTION_RUN_ID),rally=byRun(RALLY_RUN_ID),checks=byRun(WINNER_CHECK_RUN_ID);
 // Original study first, then later batches, each in its own order.
 const batchOrder=(b:string)=>RESEARCH_BATCHES.indexOf(b as typeof RESEARCH_BATCHES[number]);
 const ordered=[...rows].sort((a,b)=>batchOrder(a.batch)-batchOrder(b.batch)||a.sequence-b.sequence);
 const initialRows:EndingRow[]=ordered.map(r=>{
   const check=checks.get(r.id);
   return {id:r.id,match_id:r.match_id,sequence:r.sequence,source:r.source,label:r.label,revision:r.revision,suggestion:endings.get(r.id) as EndingSuggestion|undefined,rallyPrediction:rally.get(r.id) as RallyPrediction|undefined,check:validWinnerCheck(check)?check as WinnerCheck:undefined};
 });
 return <PointEndingReview initialStartReview={startReview} startCases={START_REVIEW_CASES} initialCutReview={cutReview} initialRows={initialRows} initialCustom={(custom??[]).map(r=>r.name as string)} />;
}
