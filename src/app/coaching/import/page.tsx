import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { LessonVideoBriefFirstRun } from "@/components/LessonVideoBriefFirstRun";
import { createClient } from "@/lib/supabase/server";
import { LessonVideos } from "../videos/LessonVideos";

export const metadata: Metadata = {
  title: "Lesson videos",
  robots: { index: false, follow: false },
};

/**
 * A player importing a lesson they had, rather than a coach importing one
 * they gave. Player territory, deliberately: /coaching/videos belongs to
 * the coaching side, and standing on it would flip a dual-role account
 * into coach mode — the bug 157 fixed once already, from the other side.
 */
export default async function PlayerImportPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login?next=/coaching/import");

  const { data: coaches } = await db.rpc("player_coaches_list");

  // Their own imports only. A dual-role account's coach-side imports must
  // not stand in for this, or a coach importing their first lesson AS A
  // PLAYER is never told that this one keeps itself.
  const { count: importCount } = await db
    .from("lesson_videos")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .not("coach_ref_id", "is", null);

  return (
    <AppShell
      avatarUrl={(user.user_metadata?.avatar_url as string | undefined) ?? null}
    >
      <LessonVideoBriefFirstRun
        audience="player"
        userId={user.id}
        seenFromAccount={user.user_metadata?.lesson_video_player_brief_seen}
        hasAnyLessonVideo={(importCount ?? 0) > 0}
      />
      <LessonVideos
        audience="player"
        students={[]}
        coaches={(
          (coaches ?? []) as { id: string; display_name: string }[]
        ).map((c) => ({ id: c.id, display_name: c.display_name }))}
        userId={user.id}
        initialStudent=""
      />
    </AppShell>
  );
}
