import type {Metadata} from 'next';
import {notFound,redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {SUGGESTION_RUN_ID,type EndingSuggestion} from '@/lib/research/endingSuggestions';
import {RALLY_RUN_ID,type RallyPrediction} from '@/lib/research/rallyPredictions';
import type {EndingRow} from '@/lib/research/pointEndings';
import {PointEndingReview} from './PointEndingReview';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Point-ending labels',robots:{index:false,follow:false,nocache:true}};
export default async function PointEndingPage() {
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user) redirect('/login?next=/research/point-endings');
 if((await db.rpc('is_admin')).data!==true) notFound();
 const [{data:rows,error},{data:custom,error:customError},{data:suggestions,error:suggestionError}]=await Promise.all([
   db.from('point_ending_research').select('id,match_id,sequence,source,label,revision').eq('batch','out-ball-479-v1').order('sequence').limit(1000),
   db.from('point_ending_custom_reasons').select('name').order('name'),
   db.from('point_ending_suggestions').select('point_id,payload').in('run_id',[SUGGESTION_RUN_ID,RALLY_RUN_ID]).limit(1000)
 ]);
 if(error||customError||suggestionError) throw new Error('Could not load point-ending research');
 const byId=new Map((suggestions??[]).filter(r=>r.payload.runId===SUGGESTION_RUN_ID).map(r=>[r.point_id,r.payload as EndingSuggestion]));
 const rallyById=new Map((suggestions??[]).filter(r=>r.payload.runId===RALLY_RUN_ID).map(r=>[r.point_id,r.payload as RallyPrediction]));
 return <PointEndingReview initialRows={(rows??[]).map(r=>({...r,suggestion:byId.get(r.id),rallyPrediction:rallyById.get(r.id)})) as EndingRow[]} initialCustom={(custom??[]).map(r=>r.name as string)} />;
}
