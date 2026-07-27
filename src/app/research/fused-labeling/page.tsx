import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ResearchLabeler } from "./ResearchLabeler";
import type {
  ResearchAssignment,
  ResearchSource,
} from "@/lib/research/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Fused labeling research",
  robots: { index: false, follow: false, nocache: true },
};

interface RawAssignment {
  id: string;
  batch_id: string;
  source_id: string;
  sequence: number;
  status: ResearchAssignment["status"];
  human_label: ResearchAssignment["human_label"];
  review_metrics: ResearchAssignment["review_metrics"];
  started_at: string | null;
  submitted_at: string | null;
  research_sources: ResearchSource | ResearchSource[];
}

export default async function FusedLabelingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/fused-labeling");

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
      "id,batch_id,source_id,sequence,status,human_label,review_metrics,started_at,submitted_at,research_sources!inner(id,source_point_idx,match_label,player_near_name,player_far_name,venue_label,duration_s,proposal,prefill)",
    )
    .eq("reviewer_id", user.id)
    .order("sequence", { ascending: true });
  if (error) {
    console.error("research assignment query failed", error);
    throw new Error("Could not load research assignments.");
  }

  const assignments = ((data ?? []) as unknown as RawAssignment[]).map(
    (row): ResearchAssignment => ({
      ...row,
      source: (Array.isArray(row.research_sources)
        ? row.research_sources[0]
        : row.research_sources) as ResearchSource,
    }),
  );

  let adminProgress: { submitted: number; total: number } | null = null;
  if (isAdmin && assignments[0]?.batch_id) {
    const { data: allRows } = await supabase
      .from("research_assignments")
      .select("status")
      .eq("batch_id", assignments[0].batch_id);
    adminProgress = {
      submitted: (allRows ?? []).filter((row) => row.status === "submitted").length,
      total: allRows?.length ?? 0,
    };
  }

  return (
    <ResearchLabeler
      initialAssignments={assignments}
      isAdmin={Boolean(isAdmin)}
      adminProgress={adminProgress}
    />
  );
}
