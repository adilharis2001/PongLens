import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AudioImpactLabeler } from "./AudioImpactLabeler";
import type { AudioImpactResearchAssignment } from "./types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Audio impact research",
  robots: { index: false, follow: false, nocache: true },
};

const BATCH_SLUG = "audio-impact-labeling-recent-v1";

interface RawAssignment
  extends Omit<AudioImpactResearchAssignment, "source"> {
  research_sources:
    | AudioImpactResearchAssignment["source"]
    | AudioImpactResearchAssignment["source"][];
  research_batches: { slug: string } | { slug: string }[];
}

export default async function AudioImpactResearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/audio-impacts");

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const { data, error } = await supabase
    .from("research_assignments")
    .select(
      "id,batch_id,source_id,sequence,status,human_label,review_metrics,started_at,submitted_at,research_sources!inner(id,source_point_idx,match_label,venue_label,duration_s,proposal,prefill),research_batches!inner(slug)",
    )
    .eq("reviewer_id", user.id)
    .eq("research_batches.slug", BATCH_SLUG)
    .order("sequence", { ascending: true });
  if (error) {
    console.error("audio impact assignment query failed", error);
    throw new Error("Could not load audio-impact research assignments.");
  }

  const assignments = ((data ?? []) as unknown as RawAssignment[]).map(
    (row): AudioImpactResearchAssignment => ({
      id: row.id,
      batch_id: row.batch_id,
      source_id: row.source_id,
      sequence: row.sequence,
      status: row.status,
      human_label: row.human_label,
      review_metrics: row.review_metrics,
      started_at: row.started_at,
      submitted_at: row.submitted_at,
      source: Array.isArray(row.research_sources)
        ? row.research_sources[0]
        : row.research_sources,
    }),
  );

  return (
    <AudioImpactLabeler
      initialAssignments={assignments}
      isAdmin={Boolean(isAdmin)}
    />
  );
}
