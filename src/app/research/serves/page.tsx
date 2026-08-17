import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ServeReview, type ServeNote } from "./ServeReview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Serve calls",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ServesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/serves");

  // Admin only, like every other research page. This one has a second reason:
  // the notes are a corpus, and a corpus mixing the owner's judgement with
  // anyone else's is worse than no corpus.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const { data: notes } = await supabase
    .from("serve_review_notes")
    .select("case_id,verdict,note");

  return <ServeReview initialNotes={(notes ?? []) as ServeNote[]} />;
}
