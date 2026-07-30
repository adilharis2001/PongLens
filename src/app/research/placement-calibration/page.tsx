import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PlacementCalibrationLabeler } from "./PlacementCalibrationLabeler";
import type { PlacementResearchAssignment } from "./types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Placement calibration research",
  robots: { index: false, follow: false, nocache: true },
};

interface RawAssignment
  extends Omit<PlacementResearchAssignment, "source"> {
  research_sources:
    | PlacementResearchAssignment["source"]
    | PlacementResearchAssignment["source"][];
  research_batches: { slug: string } | { slug: string }[];
}

const BATCH_SLUG = "placement-calibration-cross-venue-v1";

export default async function PlacementCalibrationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/placement-calibration");

  const [{ data: isAdmin }, reviewerResult] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase
      .from("research_reviewers")
      .select("active, role")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (!isAdmin && !reviewerResult.data?.active) notFound();

  const { data, error } = await supabase
    .from("research_assignments")
    .select(
      "id,batch_id,source_id,sequence,status,human_label,review_metrics,started_at,submitted_at,research_sources!inner(id,source_point_idx,match_label,player_near_name,player_far_name,venue_label,duration_s,proposal),research_batches!inner(slug)",
    )
    .eq("reviewer_id", user.id)
    .eq("research_batches.slug", BATCH_SLUG)
    .order("sequence", { ascending: true });
  if (error) {
    console.error("placement research assignment query failed", error);
    throw new Error("Could not load placement research assignments.");
  }

  const assignments = ((data ?? []) as unknown as RawAssignment[]).map(
    (row): PlacementResearchAssignment => {
      const source = Array.isArray(row.research_sources)
        ? row.research_sources[0]
        : row.research_sources;
      const revealed = Boolean(row.human_label?.revealed_at);
      return {
        id: row.id,
        batch_id: row.batch_id,
        source_id: row.source_id,
        sequence: row.sequence,
        status: row.status,
        human_label: row.human_label,
        review_metrics: row.review_metrics,
        started_at: row.started_at,
        submitted_at: row.submitted_at,
        source: {
          ...source,
          proposal: {
            ...source.proposal,
            predictions: revealed
              ? source.proposal.predictions
              : {
                  legacy_current: null,
                  canonical_current: null,
                  openai: null,
                },
          },
        },
      };
    },
  );

  return (
    <PlacementCalibrationLabeler
      initialAssignments={assignments}
      isAdmin={Boolean(isAdmin)}
    />
  );
}
