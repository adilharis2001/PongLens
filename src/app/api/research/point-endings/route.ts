import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validEndingLabel } from '@/lib/research/pointEndings';
export const runtime='nodejs';
export async function POST(request:Request) {
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user || (await db.rpc('is_admin')).data!==true) return NextResponse.json({error:'Not permitted'},{status:403});
  let body;
  try {body=await request.json();} catch {return NextResponse.json({error:'Invalid request'},{status:400});}
  if(!body || !/^[0-9a-f-]{36}$/i.test(body.id??'') || !Number.isSafeInteger(body.revision) || body.revision<0 || !validEndingLabel(body.label))
    return NextResponse.json({error:'Choose a reason or enter a custom reason.'},{status:400});
  const label={...body.label,custom:body.label.custom.trim()};
  const {data,error}=await db.from('point_ending_research').update({label,revision:body.revision+1}).eq('id',body.id).eq('batch','out-ball-479-v1').eq('revision',body.revision).select('id,label,revision').maybeSingle();
  if(error) return NextResponse.json({error:'Could not save. Your answer is still on this page.'},{status:500});
  if(!data) {
    const {data:existing}=await db.from('point_ending_research').select('id,label,revision').eq('id',body.id).eq('batch','out-ball-479-v1').maybeSingle();
    if(existing && existing.revision===body.revision+1 && existing.label.reason===label.reason && existing.label.custom===label.custom && existing.label.note===label.note)
      return NextResponse.json({saved:existing},{headers:{'Cache-Control':'private, no-store'}});
  }
  if(!data) return NextResponse.json({error:'This point changed in another window. Reload to see the saved answer before editing again.'},{status:409});
  return NextResponse.json({saved:data},{headers:{'Cache-Control':'private, no-store'}});
}
