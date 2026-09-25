import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {COMPARISON_BATCH,comparisonReview,comparisonReviewAllowed,mergeComparisonReview,parseComparisonRow,sameComparisonReview,validComparisonId,validComparisonReview,validComparisonSource} from '@/lib/research/matchComparison';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request) {
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user||(await db.rpc('is_admin')).data!==true)return NextResponse.json({error:'Not permitted'},{status:403,headers});
 const id=new URL(request.url).searchParams.get('id');
 if(!validComparisonId(id))return NextResponse.json({error:'Invalid comparison.'},{status:400,headers});
 const {data,error}=await db.from('point_ending_research').select('id,match_id,sequence,source,label,revision').eq('batch',COMPARISON_BATCH).eq('id',id).maybeSingle();
 if(error||!data)return NextResponse.json({error:'Comparison unavailable.'},{status:error?500:404,headers});
 try{return NextResponse.json({row:parseComparisonRow(data)},{headers});}
 catch{return NextResponse.json({error:'Comparison data is unavailable.'},{status:500,headers});}
}
export async function POST(request:Request) {
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user||(await db.rpc('is_admin')).data!==true)return NextResponse.json({error:'Not permitted'},{status:403,headers});
 let body;try{body=await request.json();}catch{return NextResponse.json({error:'Invalid request.'},{status:400,headers});}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['id','revision','review'].includes(k))||!validComparisonId(body.id)||!Number.isSafeInteger(body.revision)||body.revision<0||!validComparisonReview(body.review))return NextResponse.json({error:'Invalid comparison review.'},{status:400,headers});
 const {data:current,error:readError}=await db.from('point_ending_research').select('id,source,label,revision').eq('batch',COMPARISON_BATCH).eq('id',body.id).maybeSingle();
 if(readError)return NextResponse.json({error:'Could not load the saved review. Try again.'},{status:500,headers});
 if(!current)return NextResponse.json({error:'Comparison not found.'},{status:404,headers});
 if(!validComparisonSource(current.source)||!comparisonReviewAllowed(body.review,current.source))return NextResponse.json({error:'This answer does not match the available comparison.'},{status:400,headers});
 const conflict=()=>NextResponse.json({error:'This review changed in another window. Your draft is still here. Load the saved review before editing again.'},{status:409,headers});
 const saved=(row:{id:string;label:Record<string,unknown>;revision:number})=>NextResponse.json({saved:{id:row.id,label:row.label,revision:row.revision}},{headers});
 // A repeated request may acknowledge its own successful write, but never replace a newer review.
 if(current.revision!==body.revision)return current.revision===body.revision+1&&sameComparisonReview(comparisonReview(current.label),body.review)?saved(current):conflict();
 const label=mergeComparisonReview(current.label,body.review);
 // The existing table trigger records the authenticated reviewer and full label history atomically.
 const {data,error}=await db.from('point_ending_research').update({label,revision:body.revision+1}).eq('batch',COMPARISON_BATCH).eq('id',body.id).eq('revision',body.revision).select('id,label,revision').maybeSingle();
 if(error)return NextResponse.json({error:'Could not save. Your draft is still here.'},{status:500,headers});
 if(data)return saved(data);
 const {data:latest}=await db.from('point_ending_research').select('id,label,revision').eq('batch',COMPARISON_BATCH).eq('id',body.id).maybeSingle();
 return latest&&latest.revision===body.revision+1&&sameComparisonReview(comparisonReview(latest.label),body.review)?saved(latest):conflict();
}
