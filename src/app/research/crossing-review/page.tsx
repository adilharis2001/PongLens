import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CrossingReview } from "./CrossingReview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Crossing review",
  robots: { index: false, follow: false, nocache: true },
};

export default async function CrossingReviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/crossing-review");

  // Admin only, unlike the reviewer pages: every clip on this page signs
  // through /api/media-url under the match owner's RLS, so a reviewer who
  // is not the owner would see a wall of dead cards.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const { data: notes } = await supabase
    .from("crossing_review_notes")
    .select("point_id,verdict,note");

  return <CrossingReview initialNotes={notes ?? []} />;
}
