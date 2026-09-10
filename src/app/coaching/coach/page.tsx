import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { CoachRoster } from "@/components/CoachRoster";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your coaches",
  robots: { index: false, follow: false },
};

/**
 * Every coach in one list, and the one place a new one is added.
 *
 * The Coaching tab is a feed of what happened, narrowed by coach; this is
 * the roster behind it, and the permanent "Your coaches" row on that tab is
 * how it is reached. Until 2026-09-10 the only link to this page was inside
 * the tab's empty state, so writing down one coach orphaned it.
 *
 * It renders CoachRoster rather than SharingSection's list, because that
 * list was built on coach_links and a coach the player had only written
 * down has none — so the coach who most needs to be here was the one who
 * could not appear.
 */
export default async function YourCoachesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching/coach");

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <Link
        href="/coaching"
        className="text-sm text-zinc-400 transition-colors hover:text-white"
      >
        ← Coaching
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
        Your coaches
      </h1>
      <div className="mt-6">
        <CoachRoster userId={user.id} />
      </div>
    </AppShell>
  );
}
