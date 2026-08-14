import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ServeDetector, type ServeNote } from "./ServeDetector";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Updated serve detector",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ServeDetectorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/serve-detector");

  // Admin only, like crossing review: every video on this page signs
  // through /api/media-url under the match owner's RLS, so a reviewer who
  // is not the owner would see nothing but a dead player.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const { data: notes } = await supabase
    .from("serve_detector_notes")
    .select("point_id,verdict,causes,note");

  return <ServeDetector initialNotes={(notes ?? []) as ServeNote[]} />;
}
