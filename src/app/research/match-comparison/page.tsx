import type {Metadata} from 'next';
import {notFound,redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {COMPARISON_BATCH,parseComparisonRow} from '@/lib/research/matchComparison';
import {MatchComparisonReview} from './MatchComparisonReview';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Match comparison',robots:{index:false,follow:false,nocache:true}};
export default async function MatchComparisonPage() {
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)redirect('/login?next=%2Fresearch%2Fmatch-comparison');
 if((await db.rpc('is_admin')).data!==true)notFound();
 const {data,error}=await db.from('point_ending_research').select('id,match_id,sequence,source,label,revision').eq('batch',COMPARISON_BATCH).order('sequence').limit(1000);
 if(error)throw new Error('Could not load match comparisons.');
 return <MatchComparisonReview initialRows={(data??[]).map(parseComparisonRow)}/>;
}
