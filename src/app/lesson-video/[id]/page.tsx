import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { LessonVideoView, type LessonUp } from './LessonVideoView';

export const metadata: Metadata = { title: 'Lesson recap', robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The lesson page sits on the same shell as every other coach page: the
 * top navigation, the arena background, the wide column the match page
 * also uses. It used to render bare, with its own narrow column and a
 * "Back" pill, and read as a different product from the page that linked
 * to it.
 *
 * The way up is worked out here, on the server, so it can carry a name:
 * "Emily" rather than "Back". The view only knows ids.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?next=' + encodeURIComponent('/lesson-video/' + id));

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  let up: LessonUp | null = null;
  if (UUID.test(id)) {
    const admin = createAdminClient();
    const { data: row } = await admin
      .from('lesson_videos')
      .select('owner_id,student_id,coach_ref_id')
      .eq('id', id)
      .maybeSingle();
    if (row?.owner_id === user.id) {
      if (row.student_id) {
        const { data: student } = await admin
          .from('coach_students')
          .select('display_name')
          .eq('id', row.student_id)
          .maybeSingle();
        up = { href: '/coaching/students/' + row.student_id, label: student?.display_name ?? 'Student' };
      } else if (row.coach_ref_id) {
        // The player's own lesson. The name is the coach it was recorded
        // with, so the page can say "Share with Jonathan" rather than
        // "Share with your student", which is the wrong half of the
        // relationship for a recap somebody filmed of their own lesson.
        const { data: coach } = await admin
          .from('player_coaches')
          .select('display_name')
          .eq('id', row.coach_ref_id)
          .maybeSingle();
        up = {
          href: '/coaching/coach/' + row.coach_ref_id,
          label: coach?.display_name ?? 'Your coach',
        };
      } else {
        up = { href: '/coaching/videos', label: 'Lesson videos' };
      }
    }
  }

  return (
    <AppShell avatarUrl={avatarUrl} wide>
      <LessonVideoView id={id} up={up} />
    </AppShell>
  );
}
