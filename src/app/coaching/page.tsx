import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import type {
  CoachProfileRow,
  StudentOrderItem,
} from "@/lib/reviews/types";
import type { NoteFeedRow } from "@/lib/types";
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

  const [
    queueRes,
    statsRes,
    offeringsRes,
    studentRes,
    notesRes,
    linksRes,
    opensRes,
    coachedRes,
  ] = await Promise.all([
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
    supabase.rpc("note_feed", { p_limit: 30 }),
    // Whether this user has coaches of their own — it decides if the tab
    // needs the coach/player view switch at all.
    supabase
      .from("coach_links")
      .select("id", { count: "exact", head: true })
      .eq("player_id", user.id)
      .neq("status", "revoked"),
    // Storefront opens this week (RLS scopes to own rows).
    profile
      ? supabase
          .from("coach_page_views")
          .select("id", { count: "exact", head: true })
          .gte(
            "viewed_at",
            new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
          )
      : Promise.resolve({ count: 0 }),
    // The free-to-paid signal: notes this user left on other players'
    // matches. Only worth asking when they have no coach page yet.
    !profile
      ? supabase
          .from("notes")
          .select("match_id, matches!inner(user_id)")
          .eq("author_id", user.id)
          .limit(300)
      : Promise.resolve({ data: [] }),
  ]);

  const coachedNoteOwners = (
    (coachedRes.data ?? []) as Array<{
      matches: { user_id: string } | { user_id: string }[];
    }>
  )
    .flatMap((r) => (Array.isArray(r.matches) ? r.matches : [r.matches]))
    .map((m) => m.user_id)
    .filter((id) => id !== user.id);
  const coachedOwners = new Set(coachedNoteOwners);

  return (
    <AppShell avatarUrl={avatarUrl} wide>
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
        coachNotes={((notesRes.data ?? []) as NoteFeedRow[]).filter(
          (n) => n.match_owner_id === user.id && n.author_id !== user.id,
        )}
        hasCoachLinks={(linksRes.count ?? 0) > 0}
        pageOpens7d={(opensRes as { count: number | null }).count ?? 0}
        nudgePlayerCount={coachedOwners.size}
        nudgeNoteCount={coachedNoteOwners.length}
        nudgeDismissed={
          user.user_metadata?.pl_coach_nudge_dismissed === true
        }
        userId={user.id}
        defaultName={defaultName}
      />
    </AppShell>
  );
}
