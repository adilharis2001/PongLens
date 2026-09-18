import type {Metadata} from 'next';
import {notFound,redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import type {EndingRow} from '@/lib/research/pointEndings';
import {PointEndingReview} from './PointEndingReview';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Point-ending labels',robots:{index:false,follow:false,nocache:true}};
export default async function PointEndingPage() {
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user) redirect('/login?next=/research/point-endings');
 if((await db.rpc('is_admin')).data!==true) notFound();
 const [{data:rows,error},{data:custom,error:customError}]=await Promise.all([
   db.from('point_ending_research').select('id,match_id,sequence,source,label,revision').eq('batch','out-ball-479-v1').order('sequence').limit(1000),
   db.from('point_ending_custom_reasons').select('name').order('name')
 ]);
 if(error||customError) throw new Error('Could not load point-ending research');
 return <PointEndingReview initialRows={(rows??[]) as EndingRow[]} initialCustom={(custom??[]).map(r=>r.name as string)} />;
}
