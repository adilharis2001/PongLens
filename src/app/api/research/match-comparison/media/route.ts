import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {presignGet,RAW_BUCKET} from '@/lib/r2';
import {COMPARISON_BATCH,comparisonMediaKey,validComparisonId} from '@/lib/research/matchComparison';
export const runtime='nodejs';
export async function GET(request:Request) {
 const headers={'Cache-Control':'private, no-store'};const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user||(await db.rpc('is_admin')).data!==true)return NextResponse.json({error:'Not permitted'},{status:403,headers});
 const id=new URL(request.url).searchParams.get('id');
 if(!validComparisonId(id))return NextResponse.json({error:'Invalid comparison.'},{status:400,headers});
 const {data,error}=await db.from('point_ending_research').select('media_path').eq('id',id).eq('batch',COMPARISON_BATCH).maybeSingle();
 if(error||!data)return NextResponse.json({error:'Video unavailable.'},{status:error?500:404,headers});
 // Storage keys come only from immutable service-seeded rows, never request parameters.
 const key=comparisonMediaKey(data.media_path);
 if(!key)return NextResponse.json({error:'Video unavailable.'},{status:500,headers});
 try{return NextResponse.json({url:await presignGet(RAW_BUCKET,key,{expiresSeconds:3600,disposition:'inline'})},{headers});}
 catch{return NextResponse.json({error:'Could not load video. Try again.'},{status:500,headers});}
}
