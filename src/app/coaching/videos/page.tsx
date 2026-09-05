import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LessonVideos } from './LessonVideos';
export const metadata={title:'Lesson videos',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{studentId?:string}>}){const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login?next=/coaching/videos');const {data:students}=await db.from('coach_students').select('id,display_name').is('archived_at',null).order('display_name');return <LessonVideos students={students??[]} userId={user.id} initialStudent={(await searchParams).studentId??''}/>;}
