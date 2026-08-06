import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import type {
  CoachProfileRow,
  StudentOrderItem,
} from "@/lib/reviews/types";
import { CoachHub } from "./CoachHub";

export const metadata: Metadata = {
  title: "Coaching",
  robots: { index: false, follow: false },
};

/**
 * The Coaching tab: the whole coaching world in one place. Coaches get
 * their workspace; everyone gets their coaches and the reviews they've
 * bought. The public storefront stays at /coach/<handle>.
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
  const defaultName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    "";

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const [queueRes, statsRes, offeringsRes, studentRes] = await Promise.all([
    profile ? supabase.rpc("coach_queue") : Promise.resolve({ data: [] }),
    profile
      ? supabase.rpc("coach_review_stats")
      : Promise.resolve({ data: null }),
    profile
      ? supabase
          .from("offerings")
          .select("id", { count: "exact", head: true })
          .eq("coach_id", user.id)
      : Promise.resolve({ count: 0 }),
    supabase.rpc("student_review_orders"),
  ]);

  return (
    <AppShell avatarUrl={avatarUrl}>
      <CoachHub
        profile={(profile as CoachProfileRow | null) ?? null}
        initialQueue={queueRes.data ?? []}
        stats={
          statsRes.data ?? {
            active_count: 0,
            completed_count: 0,
            earned_cents: 0,
          }
        }
        offeringCount={
          (offeringsRes as { count: number | null }).count ?? 0
        }
        studentOrders={(studentRes.data ?? []) as StudentOrderItem[]}
        userId={user.id}
        defaultName={defaultName}
      />
    </AppShell>
  );
}
