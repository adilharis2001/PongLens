import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/AppNav";
import type { Match, Note, Point } from "@/lib/types";
import { MatchView } from "./MatchView";

export const metadata: Metadata = {
  title: "Match",
  robots: { index: false, follow: false },
};

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // RLS scopes all three queries to has_match_access(): the owner plus any
  // accepted coach (all-matches scope or this match specifically).
  const [matchRes, pointsRes, notesRes] = await Promise.all([
    supabase.from("matches").select("*").eq("id", id).single(),
    supabase
      .from("points")
      .select("*")
      .eq("match_id", id)
      .order("idx", { ascending: true }),
    supabase
      .from("notes")
      .select("*")
      .eq("match_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (matchRes.error || !matchRes.data) {
    notFound();
  }

  // Cut strictness of the source job: the clip-edit UI needs it to map the
  // clip playhead back onto the source-video timeline (clips carry pre/post
  // context padding). Coaches can't read the owner's job row under RLS —
  // they fall back to "normal", and clip editing is owner-only anyway.
  let strictness = "normal";
  if (matchRes.data.job_id) {
    const { data: job } = await supabase
      .from("jobs")
      .select("options")
      .eq("id", matchRes.data.job_id)
      .maybeSingle();
    const s = (job?.options as { strictness?: string } | null)?.strictness;
    if (s) strictness = s;
  }

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  // Same chrome as the rest of the signed-in app (bottom bar on mobile).
  // MatchView keeps its own wider content column, so we use AppNav directly
  // instead of AppShell; bottom padding clears the fixed mobile bar.
  return (
    <>
      <AppNav avatarUrl={avatarUrl} />
      <main className="bg-arena flex-1 pb-28 md:pb-16">
        <MatchView
          match={matchRes.data as Match}
          initialPoints={(pointsRes.data ?? []) as Point[]}
          initialNotes={(notesRes.data ?? []) as Note[]}
          userId={user.id}
          strictness={strictness}
        />
      </main>
    </>
  );
}
