import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {presignGet,RAW_BUCKET} from '@/lib/r2';
export const runtime='nodejs';
export async function GET(request:Request) {
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user || (await db.rpc('is_admin')).data!==true) return NextResponse.json({error:'Not permitted'},{status:403});
 const id=new URL(request.url).searchParams.get('id');
 if(!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({error:'Invalid point'},{status:400});
 const {data,error}=await db.from('point_ending_research').select('media_path').eq('id',id).eq('batch','out-ball-479-v1').maybeSingle();
 if(error || !data) return NextResponse.json({error:'Video unavailable'},{status:error?500:404});
 // Immutable, service-seeded paths only. No client-supplied arbitrary storage keys.
 const match=/^r2:\/\/ponglens-raw\/([0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:mov|mp4))$/.exec(data.media_path);
 if(!match) return NextResponse.json({error:'Video unavailable'},{status:500});
 try {return NextResponse.json({url:await presignGet(RAW_BUCKET,match[1],{expiresSeconds:3600,disposition:'inline'})},{headers:{'Cache-Control':'private, no-store'}});}
 catch {return NextResponse.json({error:'Could not load video. Try again.'},{status:500});}
}
