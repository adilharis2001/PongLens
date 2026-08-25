import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import type {
  ReviewAttachmentRow,
  ReviewFindingRow,
  ReviewMessageRow,
  ReviewOrderDetail,
  ReviewSectionContent,
} from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/server";
import { clipPad } from "@/app/match/[id]/clipEdit";
import { skipSpans } from "@/app/match/[id]/playhead";
import { sortPoints } from "@/app/match/[id]/gameScore";
import { getTapEndPlayback } from "@/lib/config";
import type { Point } from "@/lib/types";
import { CoachOrder, type WorkspacePoint } from "./CoachOrder";

export const metadata: Metadata = {
  title: "Review order",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The coach's side of one order: accept it, build the review in the
 * workspace, deliver it, answer follow-ups. Match access rides on the
 * active order (has_match_access order arm) and ends at completion; the
 * finding-cited clips stay reachable through /api/review-media after.
 */
export default async function CoachOrderPage({
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
  if (!user) redirect(`/login?next=/coaching/orders/${id}`);

  const { data } = await supabase.rpc("review_order_detail", {
    p_order_id: id,
  });
  const detail = data as ReviewOrderDetail | null;
  if (!detail) notFound();
  if (detail.student_id === user.id) redirect(`/orders/${id}`);

  const working =
    detail.status === "in_review" || detail.status === "clarification";
  const delivered =
    detail.status === "delivered" || detail.status === "completed";

  const [
    { data: messages },
    { data: doc },
    { data: findings },
    { data: attachments },
    { data: match },
    { data: points },
  ] = await Promise.all([
    supabase
      .from("review_messages")
      .select("*")
      .eq("order_id", id)
      .order("created_at"),
    working || delivered
      ? supabase
          .from("review_documents")
          .select("sections, status")
          .eq("order_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    working || delivered
      ? supabase
          .from("review_findings")
          .select("*")
          .eq("order_id", id)
          .order("sort")
          .order("created_at")
      : Promise.resolve({ data: null }),
    working || delivered
      ? supabase
          .from("review_attachments")
          .select("*")
          .eq("order_id", id)
          .order("created_at")
      : Promise.resolve({ data: null }),
    detail.match_id
      ? supabase
          .from("matches")
          .select(
            "id, opponent_name, venue, played_at, status, user_side, clip_pads",
          )
          .eq("id", detail.match_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    detail.match_id
      ? supabase
          .from("points")
          .select(
            "id, idx, confirmed_winner, starred, is_let, deleted, cut_t0, t0, t1, tight_start, tight_end, edited, scored_at_cut_s, game_end_override, game_winner_override",
          )
          .eq("match_id", detail.match_id)
          .order("idx")
      : Promise.resolve({ data: null }),
  ]);

  const findingRows = (findings ?? []) as ReviewFindingRow[];
  let links: { finding_id: string; point_id: string }[] = [];
  if (findingRows.length > 0) {
    const { data: linkRows } = await supabase
      .from("review_finding_points")
      .select("finding_id, point_id")
      .in(
        "finding_id",
        findingRows.map((f) => f.id),
      );
    links = linkRows ?? [];
  }

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  // Dead footage the workspace player jumps: deleted cards, and — with
  // tap_end_playback on (138) — the tail after each winner tap. Computed
  // here because the client only ever sees the visible, re-numbered
  // points; the full rows with the deleted cards live on this side.
  const deadSpans = skipSpans(
    sortPoints((points ?? []) as unknown as Point[]),
    clipPad(
      null,
      (match as { clip_pads?: { pre: number; post: number } | null } | null)
        ?.clip_pads ?? null,
    ),
    await getTapEndPlayback(),
  );

  const { data: fundingRow } = await supabase
    .from("review_orders")
    .select("funding")
    .eq("id", id)
    .maybeSingle();

  return (
    <AppShell avatarUrl={avatarUrl} wide>
      <CoachOrder
        detail={detail}
        messages={(messages ?? []) as ReviewMessageRow[]}
        docSections={
          (doc?.sections ?? null) as ReviewSectionContent[] | null
        }
        findings={findingRows}
        links={links}
        attachments={(attachments ?? []) as ReviewAttachmentRow[]}
        match={match ?? null}
        points={((points ?? []) as WorkspacePoint[])
          .filter((p) => !p.deleted)
          // Ranked display numbers, matching the match page (idx skips
          // deleted points there too).
          .map((p, i) => ({ ...p, idx: i }))}
        skipSpans={deadSpans}
        userId={user.id}
        sponsored={fundingRow?.funding === "sponsored"}
      />
    </AppShell>
  );
}
