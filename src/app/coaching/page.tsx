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
import type { CoachFirstStepsState } from "./CoachFirstSteps";
import { tutorialWasStarted } from "../learn/tutorialProgress";
import { rememberedWorkspace } from "@/lib/workspaceServer";

export const metadata: Metadata = {
  title: "Coaching",
  robots: { index: false, follow: false },
};

/**
 * The coaching home. On the coaching side: today's work — a short read of
 * the order queue, the roster and the latest entries — with the
 * marketplace one tab over at /coaching/orders. On the playing side: your
 * coaches and the reviews you've bought. The public storefront stays at
 * /coach/<handle>.
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

  const [
    queueRes,
    statsRes,
    offeringsRes,
    studentRes,
    notesRes,
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
  ]);

  const { workspace } = await rememberedWorkspace();

  // The coach's first-steps checklist, derived from product state (the
  // same way the dashboard's is). Only asked for on the coaching side.
  let firstSteps: CoachFirstStepsState | null = null;
  if (workspace === "coach") {
    const [studentsRes, invitesRes, entriesRes, sharedRes] = await Promise.all([
      supabase
        .from("coach_students")
        .select("id, player_id")
        .eq("coach_id", user.id)
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(50),
      supabase.from("coach_student_invites").select("id").limit(1),
      supabase
        .from("coach_entries")
        .select("shared_at")
        .eq("coach_id", user.id)
        .limit(100),
      supabase.from("matches").select("id").neq("user_id", user.id).limit(1),
    ]);
    const students = (studentsRes.data ?? []) as {
      id: string;
      player_id: string | null;
    }[];
    const entries = (entriesRes.data ?? []) as { shared_at: string | null }[];
    firstSteps = {
      dismissed: user.user_metadata?.coach_first_steps_dismissed === true,
      studentCount: students.length,
      firstStudentId: students[0]?.id ?? null,
      invited:
        (invitesRes.data?.length ?? 0) > 0 ||
        students.some((s) => s.player_id !== null),
      entryCount: entries.length,
      anyShared: entries.some((e) => e.shared_at !== null),
      sharedMatchId: (sharedRes.data?.[0] as { id: string } | undefined)?.id ?? null,
      hasPage: !!profile,
      watched: tutorialWasStarted(user.user_metadata, "coach"),
    };
  }

  return (
    <AppShell avatarUrl={avatarUrl}>
      <CoachHub
        workspace={workspace}
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
        userId={user.id}
        firstSteps={firstSteps}
      />
    </AppShell>
  );
}
