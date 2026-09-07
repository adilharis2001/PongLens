import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
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

  return (
    <AppShell
      avatarUrl={(user.user_metadata?.avatar_url as string | undefined) ?? null}
    >
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
