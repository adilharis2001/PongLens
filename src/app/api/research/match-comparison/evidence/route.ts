import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {COMPARISON_BATCH,validComparisonId} from '@/lib/research/matchComparison';
import {isComparisonEvidence} from '@/lib/research/comparisonEvidence';
export async function GET(request:Request) {
 const headers={'Cache-Control':'private, no-store'};
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user||(await db.rpc('is_admin')).data!==true)return NextResponse.json({error:'Not permitted'},{status:403,headers});
 const id=new URL(request.url).searchParams.get('id');
 if(!validComparisonId(id))return NextResponse.json({error:'Invalid comparison.'},{status:400,headers});
 const row=await db.from('point_ending_research').select('id').eq('id',id).eq('batch',COMPARISON_BATCH).maybeSingle();
 if(row.error||!row.data)return NextResponse.json({error:'Comparison unavailable.'},{status:row.error?500:404,headers});
 const {data,error}=await db.from('point_ending_evidence').select('payload').eq('point_id',id).maybeSingle();
 if(error||!data)return NextResponse.json({error:'Ball evidence unavailable. Try again.'},{status:error?500:404,headers});
 if(!isComparisonEvidence(data.payload))return NextResponse.json({error:'Ball evidence could not be read.'},{status:500,headers});
 return NextResponse.json({id,evidence:data.payload},{headers});
}
