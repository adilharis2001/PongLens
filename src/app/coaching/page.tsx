import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import type { CoachProfileRow } from "@/lib/reviews/types";
import { CoachHub } from "./CoachHub";
import { CoachStart } from "./CoachStart";

export const metadata: Metadata = {
  title: "Coaching",
  robots: { index: false, follow: false },
};

/**
 * The coach's side of the house. Without a profile this is the front door
 * (claim a handle, then offerings and payouts); with one it is the queue.
 * The public storefront lives at /coach/<handle> — this page is private.
 */
export default async function CoachingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching");

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) {
    const defaultName =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      "";
    return (
      <AppShell avatarUrl={avatarUrl}>
        <CoachStart defaultName={defaultName} />
      </AppShell>
    );
  }

  const [{ data: queue }, { data: stats }, { count: offeringCount }] =
    await Promise.all([
      supabase.rpc("coach_queue"),
      supabase.rpc("coach_review_stats"),
      supabase
        .from("offerings")
        .select("id", { count: "exact", head: true })
        .eq("coach_id", user.id),
    ]);

  return (
    <AppShell avatarUrl={avatarUrl}>
      <CoachHub
        profile={profile as CoachProfileRow}
        initialQueue={queue ?? []}
        stats={
          stats ?? { active_count: 0, completed_count: 0, earned_cents: 0 }
        }
        offeringCount={offeringCount ?? 0}
      />
    </AppShell>
  );
}
