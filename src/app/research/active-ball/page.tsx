import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ActiveBallReview } from './ActiveBallReview';
import type { BallSample } from '@/lib/research/activeBall';

export const dynamic = 'force-dynamic';
export const metadata = {title:'Active ball research',robots:{index:false,follow:false}};
export default async function Page() {
  const db = await createClient();
  const {data:{user}} = await db.auth.getUser();
  if (!user) redirect('/login?next=/research/active-ball');
  if ((await db.rpc('is_admin')).data !== true) notFound();
  const {data,error} = await db.from('active_ball_samples').select('id,match_id,venue,split,frame,time_s,width,height,frame_keys,corners,label,prediction,model_run,revision').order('created_at',{ascending:false}).order('id').limit(500);
  if (error) throw new Error('Could not load active ball samples.');
  return <ActiveBallReview initial={(data ?? []) as BallSample[]} />;
}
