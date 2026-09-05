import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MEDIA_BUCKET, presignGetBatch } from '@/lib/r2';
import { validBallLabel } from '@/lib/research/activeBall';

export const runtime = 'nodejs';
async function context() {
  const db = await createClient();
  const {data:{user}} = await db.auth.getUser();
  if (!user || (await db.rpc('is_admin')).data !== true) return null;
  return {db,user};
}

export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({error:'Not permitted'}, {status:403});
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({error:'Invalid sample'}, {status:400});
  const {data,error} = await ctx.db.from('active_ball_samples').select('frame_keys').eq('id',id).maybeSingle();
  if (error) return NextResponse.json({error:'Could not load sample'}, {status:500});
  if (!data) return NextResponse.json({error:'Sample not found'}, {status:404});
  const keys: unknown = data.frame_keys;
  if (!Array.isArray(keys) || keys.length !== 3 || !keys.every(k => typeof k === 'string' && new RegExp(`^research/active-ball/v1/${id}/[012]\\.jpg$`).test(k)))
    return NextResponse.json({error:'Invalid frame manifest'}, {status:500});
  const signed = await presignGetBatch([...keys,`research/active-ball/v1/${id}/context.mp4`].map(key=>({bucket:MEDIA_BUCKET,key,opts:{expiresSeconds:3600,disposition:'inline'}})));
  return NextResponse.json({urls:signed.slice(0,3),clipUrl:signed[3]},{headers:{'Cache-Control':'private, no-store'}});
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({error:'Not permitted'}, {status:403});
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({error:'Invalid JSON'}, {status:400}); }
  if (!body || typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || !Number.isInteger(body.revision) || body.revision < 0)
    return NextResponse.json({error:'Invalid sample'}, {status:400});
  const {data:sample,error:readError} = await ctx.db.from('active_ball_samples').select('width,height').eq('id',body.id).maybeSingle();
  if (readError) return NextResponse.json({error:'Could not load sample'}, {status:500});
  if (!sample) return NextResponse.json({error:'Sample not found'}, {status:404});
  if (!validBallLabel(body.label,sample.width,sample.height)) return NextResponse.json({error:'Mark the ball or choose its visibility'}, {status:400});
  const {data,error} = await ctx.db.from('active_ball_samples').update({label:body.label,revision:body.revision+1,reviewed_by:ctx.user.id,reviewed_at:new Date().toISOString()}).eq('id',body.id).eq('revision',body.revision).select('id,label,revision').maybeSingle();
  if (error) return NextResponse.json({error:'Could not save your label'}, {status:500});
  if (!data) return NextResponse.json({error:'This sample changed in another window. Reload before saving.'}, {status:409});
  return NextResponse.json({saved:data});
}
