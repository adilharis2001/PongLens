import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import type {
  ReviewAttachmentRow,
  ReviewFindingRow,
  ReviewMessageRow,
  ReviewOrderDetail,
} from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/server";
import { OrderView } from "./OrderView";

export const metadata: Metadata = {
  title: "Your review",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The student's one screen per order: what state it is in, what happens
 * next, and — from delivery on — the review itself. The coach's twin of
 * this page is /coaching/orders/<id>; a coach landing here is sent there.
 */
export default async function OrderPage({
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
  if (!user) redirect(`/login?next=/orders/${id}`);

  const { data } = await supabase.rpc("review_order_detail", {
    p_order_id: id,
  });
  const detail = data as ReviewOrderDetail | null;
  if (!detail) notFound();
  if (detail.coach_id === user.id) redirect(`/coaching/orders/${id}`);

  const delivered =
    detail.status === "delivered" || detail.status === "completed";

  // The read receipt: first view of the delivered review marks it watched
  // (no-op on repeats; the RPC only sets a null column).
  if (delivered) {
    void supabase.rpc("mark_review_viewed", { p_order_id: id });
  }

  const [
    { data: messages },
    { data: doc },
    { data: findings },
    { data: attachments },
    { data: matches },
    { data: match },
    { data: orderRow },
  ] = await Promise.all([
    supabase
      .from("review_messages")
      .select("*")
      .eq("order_id", id)
      .order("created_at"),
    delivered
      ? supabase
          .from("review_documents")
          .select("sections")
          .eq("order_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    delivered
      ? supabase
          .from("review_findings")
          .select("*")
          .eq("order_id", id)
          .order("sort")
          .order("created_at")
      : Promise.resolve({ data: null }),
    delivered
      ? supabase
          .from("review_attachments")
          .select("*")
          .eq("order_id", id)
          .order("created_at")
      : Promise.resolve({ data: null }),
    detail.status === "awaiting_submission"
      ? supabase
          .from("matches")
          .select("id, opponent_name, venue, played_at, status, match_type")
          .eq("user_id", user.id)
          .in("status", ["ready", "processing"])
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: null }),
    detail.match_id
      ? supabase
          .from("matches")
          .select("id, opponent_name, venue, played_at, status")
          .eq("id", detail.match_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("review_orders")
      .select("billing_mode")
      .eq("id", id)
      .maybeSingle(),
  ]);

  // Point display numbers for finding chips — ranked among the match's
  // non-deleted points so they match the match page's own numbering.
  const findingRows = (findings ?? []) as ReviewFindingRow[];
  let findingPoints: Record<string, { point_id: string; idx: number }[]> = {};
  if (findingRows.length > 0) {
    const { data: links } = await supabase
      .from("review_finding_points")
      .select("finding_id, point_id")
      .in(
        "finding_id",
        findingRows.map((f) => f.id),
      );
    const rankById = new Map<string, number>();
    if (detail.match_id) {
      const { data: allPoints } = await supabase
        .from("points")
        .select("id, idx, deleted")
        .eq("match_id", detail.match_id)
        .order("idx");
      (allPoints ?? [])
        .filter((pt) => !pt.deleted)
        .forEach((pt, i) => rankById.set(pt.id, i));
    }
    findingPoints = {};
    for (const l of links ?? []) {
      (findingPoints[l.finding_id] ??= []).push({
        point_id: l.point_id,
        idx: rankById.get(l.point_id) ?? 0,
      });
    }
    for (const list of Object.values(findingPoints)) {
      list.sort((a, b) => a.idx - b.idx);
    }
  }

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <OrderView
        detail={detail}
        messages={(messages ?? []) as ReviewMessageRow[]}
        docSections={
          (doc?.sections ?? []) as { key: string; label: string; body: string }[]
        }
        findings={findingRows}
        findingPoints={findingPoints}
        attachments={(attachments ?? []) as ReviewAttachmentRow[]}
        candidateMatches={matches ?? []}
        match={match ?? null}
        userId={user.id}
        test={orderRow?.billing_mode === "test"}
      />
    </AppShell>
  );
}
