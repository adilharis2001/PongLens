import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RecallReview, type RecallNote } from "./RecallReview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Point recall",
  robots: { index: false, follow: false, nocache: true },
};

export default async function RecallPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/recall");

  // Admin only, like the serve detector and crossing review: every video
  // here signs through /api/media-url under the match owner's RLS, so a
  // reviewer who is not the owner would see a dead player.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const { data: notes } = await supabase
    .from("recall_review_notes")
    .select("region_id,match_id,verdict,causes,note");

  return <RecallReview initialNotes={(notes ?? []) as RecallNote[]} />;
}
