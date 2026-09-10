import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { CoachPage } from "./CoachPage";
import { RemovedCoach } from "./RemovedCoach";

export const metadata: Metadata = {
  title: "Coach",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One coach's page: what they can see, what you have shared, the lessons
 * you recorded with them, and the way out. The mirror of the coach's own
 * student page at /coaching/students/[id].
 *
 * The row is read here rather than in the client so the heading is the
 * coach's name on the first paint. RLS answers whose roster row this is —
 * a row the caller cannot read is a 404, never a hint that it exists.
 */
export default async function CoachDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/coaching/coach/${id}`);

  const { data: coach } = await supabase
    .from("player_coaches")
    .select("id, display_name, archived_at")
    .eq("id", id)
    .eq("player_id", user.id)
    .maybeSingle();
  if (!coach) notFound();
  /* A removed coach is archived, not gone, so their page must not 404.
     Back, a second tab and every bookmark all land here the moment somebody
     presses Remove, and a generic not-found page tells them nothing and
     offers no way to undo it. */
  const removed = !!coach.archived_at;

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      {removed ? (
        <RemovedCoach
          coachRefId={coach.id as string}
          displayName={coach.display_name as string}
        />
      ) : (
        <CoachPage
          userId={user.id}
          coachRefId={coach.id as string}
          displayName={coach.display_name as string}
        />
      )}
    </AppShell>
  );
}
