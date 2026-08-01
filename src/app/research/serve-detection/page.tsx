import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ServeDetectionLabeler } from "./ServeDetectionLabeler";
import type {
  ServeResearchAssignment,
  TemporalServeResultAssignment,
} from "./types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Serve detection research",
  robots: { index: false, follow: false, nocache: true },
};

const BATCH_SLUG = "serve-detection-cross-match-v1";
const RESULT_BATCH_SLUG = "serve-detection-temporal-results-v1";

interface RawAssignment extends Omit<ServeResearchAssignment, "source"> {
  research_sources:
    | ServeResearchAssignment["source"]
    | ServeResearchAssignment["source"][];
  research_batches: { slug: string } | { slug: string }[];
}

interface RawResultAssignment
  extends Omit<TemporalServeResultAssignment, "source"> {
  research_sources:
    | TemporalServeResultAssignment["source"]
    | TemporalServeResultAssignment["source"][];
  research_batches: { slug: string } | { slug: string }[];
}

export default async function ServeDetectionResearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/serve-detection");

  const [{ data: isAdmin }, reviewerResult] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase
      .from("research_reviewers")
      .select("active,role")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (!isAdmin && !reviewerResult.data?.active) notFound();

  const [labelingResult, temporalResult] = await Promise.all([
    supabase
      .from("research_assignments")
      .select(
        "id,batch_id,source_id,sequence,status,human_label,review_metrics,started_at,submitted_at,research_sources!inner(id,source_point_idx,match_label,duration_s,proposal,prefill),research_batches!inner(slug)",
      )
      .eq("reviewer_id", user.id)
      .eq("research_batches.slug", BATCH_SLUG)
      .order("sequence", { ascending: true }),
    supabase
      .from("research_assignments")
      .select(
        "id,batch_id,source_id,sequence,status,human_label,review_metrics,started_at,submitted_at,research_sources!inner(id,source_point_idx,match_label,duration_s,proposal,prefill),research_batches!inner(slug)",
      )
      .eq("reviewer_id", user.id)
      .eq("research_batches.slug", RESULT_BATCH_SLUG)
      .order("sequence", { ascending: true }),
  ]);
  if (labelingResult.error || temporalResult.error) {
    console.error(
      "serve research assignment query failed",
      labelingResult.error ?? temporalResult.error,
    );
    throw new Error("Could not load serve research assignments.");
  }

  const assignments = ((labelingResult.data ?? []) as unknown as RawAssignment[]).map(
    (row): ServeResearchAssignment => ({
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
  const resultAssignments = (
    (temporalResult.data ?? []) as unknown as RawResultAssignment[]
  ).map(
    (row): TemporalServeResultAssignment => ({
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
    <ServeDetectionLabeler
      initialAssignments={assignments}
      initialResultAssignments={resultAssignments}
      isAdmin={Boolean(isAdmin)}
    />
  );
}
