import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {LessonVideoView} from './LessonVideoView';
export const metadata={title:'Lesson recap',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login?next='+encodeURIComponent('/lesson-video/'+id));return <LessonVideoView id={id}/>;}
