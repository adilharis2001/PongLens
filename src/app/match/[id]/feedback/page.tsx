import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { UpLink } from "@/components/UpLink";
import { createClient } from "@/lib/supabase/server";
import { rememberedWorkspace } from "@/lib/workspaceServer";
import { deriveMatchTitleParts } from "@/lib/matchTitle";
import { presignGet } from "@/lib/r2";
import type { Match } from "@/lib/types";
import type { MatchIssueState } from "@/lib/matchIssues/types";
import { MatchFeedback } from "./MatchFeedback";

export const metadata: Metadata = { title: "Processing", robots: { index: false, follow: false } };

export default async function MatchFeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Match RLS and the state RPC both check current owner/coach access.
  const [{ data, error }, stateResult, { workspace }] = await Promise.all([
    supabase.from("matches").select("*").eq("id", id).single(),
    supabase.rpc("match_issue_state", { p_match_id: id }),
    rememberedWorkspace(),
  ]);
  if (error || !data) notFound();
  const match = data as Match;
  const title = deriveMatchTitleParts({ opponentName: match.opponent_name, venue: match.venue, playedAt: match.played_at, matchType: match.match_type });
  let thumbnail: string | null = null;
  if (match.thumb_path?.startsWith("r2://ponglens-media/")) {
    try { thumbnail = await presignGet("ponglens-media", match.thumb_path.slice("r2://ponglens-media/".length), { expiresSeconds: 3600, disposition: "inline" }); }
    catch { /* A missing preview must not prevent a private report. */ }
  }
  const avatarUrl = (user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null) as string | null;
  return <>
    <AppNav avatarUrl={avatarUrl} remembered={workspace} />
    <main className="bg-arena flex-1 px-4 pb-28 pt-5 sm:px-6 md:pb-16">
      <div className="mx-auto max-w-xl">
        <UpLink href={`/match/${id}`} label="Match" />
        <MatchFeedback matchId={id} initialState={(stateResult.data as MatchIssueState | null) ?? null} isOwner={match.user_id === user.id} matchStatus={match.status}
          title={title.primary} detail={title.secondary} thumbnail={thumbnail} />
      </div>
    </main>
  </>;
}
