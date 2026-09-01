import { NextResponse } from "next/server";
import {
  visibleAudioImpactRounds,
  type AudioImpactStudyPhase,
} from "@/lib/research/audioImpactStudy";
import { researchExportFilename } from "@/lib/research/export";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type JoinedSource = {
  source_match_id: string;
  source_point_id: string;
  source_point_idx: number;
  match_label: string;
  venue_label: string | null;
  media_sha256: string;
  manifest_sha256: string;
  proposal: Record<string, unknown>;
  prefill: Record<string, unknown>;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let batchId = "";
  try {
    batchId = String((await request.json()).batchId ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { data: batch } = await supabase
    .from("research_batches")
    .select("id,slug,title,status,schema_version")
    .eq("id", batchId)
    .eq("slug", "audio-impact-labeling-recent-v1")
    .maybeSingle();
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const { data: studyState } = await supabase
    .from("audio_impact_research_state")
    .select(
      "phase,cohort_manifest_sha256,detector_manifest_sha256,development_export_sha256,development_model_sha256,development_threshold_sha256,development_training_data_sha256,feature_definition_sha256,split_definition_sha256,unlocked_at,sealed_report_sha256,scored_at",
    )
    .eq("batch_id", batchId)
    .maybeSingle();
  if (!studyState) {
    return NextResponse.json({ error: "Study state is unavailable" }, { status: 423 });
  }
  const visibleRounds = visibleAudioImpactRounds(
    studyState.phase as AudioImpactStudyPhase,
  );
  const { data: rows, error } = await supabase
    .from("research_assignments")
    .select(
      "id,source_id,reviewer_id,sequence,duplicate_group,is_repeat,status,human_label,review_metrics,started_at,submitted_at,updated_at,research_sources!inner(source_match_id,source_point_id,source_point_idx,match_label,venue_label,media_sha256,manifest_sha256,proposal,prefill)",
    )
    .eq("batch_id", batchId)
    .in("research_sources.prefill->>round", visibleRounds)
    .order("reviewer_id", { ascending: true })
    .order("sequence", { ascending: true });
  if (error) {
    console.error("audio-impact export failed", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }

  const assignments = (rows ?? []).map((row) => {
    const joined = row.research_sources as unknown as JoinedSource | JoinedSource[];
    const source = Array.isArray(joined) ? joined[0] : joined;
    return {
      assignment_id: row.id,
      source_id: row.source_id,
      source_match_id: source.source_match_id,
      source_point_id: source.source_point_id,
      source_point_idx: source.source_point_idx,
      match_label: source.match_label,
      venue_label: source.venue_label,
      media_sha256: source.media_sha256,
      detector_manifest_sha256: source.manifest_sha256,
      proposal: source.proposal,
      prefill: source.prefill,
      reviewer_id: row.reviewer_id,
      sequence: row.sequence,
      duplicate_group: row.duplicate_group,
      is_repeat: row.is_repeat,
      status: row.status,
      human_label: row.human_label,
      review_metrics: row.review_metrics,
      started_at: row.started_at,
      submitted_at: row.submitted_at,
      updated_at: row.updated_at,
    };
  });
  const payload = {
    schema_version: batch.schema_version,
    batch: {
      id: batch.id,
      slug: batch.slug,
      title: batch.title,
      status: batch.status,
    },
    study_state: studyState,
    exported_rounds: visibleRounds,
    exported_at: new Date().toISOString(),
    assignments,
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${researchExportFilename(payload)}"`,
      "Cache-Control": "no-store",
    },
  });
}
