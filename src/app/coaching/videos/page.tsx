import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import { LessonVideos } from './LessonVideos';
import { LessonVideoBriefFirstRun } from '@/components/LessonVideoBriefFirstRun';
export const metadata={title:'Lesson videos',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{studentId?:string}>}){const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login?next=/coaching/videos');if(user.user_metadata?.is_coach!==true)redirect('/coaching');const {data:students}=await db.from('coach_students').select('id,display_name').eq('owner_id',user.id).is('archived_at',null).order('display_name');const {count:videoCount}=await db.from('lesson_videos').select('id',{count:'exact',head:true}).eq('owner_id',user.id).not('student_id','is',null);return <AppShell avatarUrl={(user.user_metadata?.avatar_url as string|undefined)??null}><LessonVideoBriefFirstRun audience="coach" userId={user.id} seenFromAccount={user.user_metadata?.lesson_video_brief_seen} hasAnyLessonVideo={(videoCount??0)>0}/><LessonVideos students={students??[]} userId={user.id} initialStudent={(await searchParams).studentId??''}/></AppShell>;}
