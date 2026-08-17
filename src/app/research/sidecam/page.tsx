import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidecamReview, type SidecamNote } from "./SidecamReview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Side-on cameras",
  robots: { index: false, follow: false, nocache: true },
};

export default async function SidecamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/sidecam");

  // Admin only, like every other research page: the notes are a corpus,
  // and a corpus mixing the owner's judgement with anyone else's is worse
  // than no corpus.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const { data: notes } = await supabase
    .from("sidecam_review_notes")
    .select("case_id,verdict,note");

  return <SidecamReview initialNotes={(notes ?? []) as SidecamNote[]} />;
}
