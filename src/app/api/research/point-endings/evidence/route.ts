import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
export async function GET(request:Request) {
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user || (await db.rpc('is_admin')).data!==true) return NextResponse.json({error:'Not permitted'},{status:403});
 const id=new URL(request.url).searchParams.get('id');
 if(!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({error:'Invalid point'},{status:400});
 const {data,error}=await db.from('point_ending_evidence').select('payload').eq('point_id',id).maybeSingle();
 if(error || !data) return NextResponse.json({error:'Ball evidence unavailable. Try again.'},{status:error?500:404});
 return NextResponse.json({id,evidence:data.payload},{headers:{'Cache-Control':'private, no-store'}});
}
