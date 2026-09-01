import { NextResponse } from "next/server";
import {
  isAudioImpactRoundUnlocked,
  type AudioImpactStudyPhase,
  type AudioImpactStudyRound,
} from "@/lib/research/audioImpactStudy";
import { isResearchMediaKey } from "@/lib/research/labeling";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let assignmentId = "";
  try {
    assignmentId = String((await request.json()).assignmentId ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!assignmentId) {
    return NextResponse.json({ error: "Missing assignmentId" }, { status: 400 });
  }

  // Both reads are RLS-protected. A reviewer can see only their assignment
  // and only the source attached to that assignment; admins retain QA access.
  const { data: assignment } = await supabase
    .from("research_assignments")
    .select("source_id,batch_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }
  const { data: source } = await supabase
    .from("research_sources")
    .select("media_key,prefill")
    .eq("id", assignment.source_id)
    .maybeSingle();
  if (!source || !isResearchMediaKey(source.media_key)) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }
  if (source.media_key.startsWith("research/audio-impacts/")) {
    const { data: studyState } = await supabase
      .from("audio_impact_research_state")
      .select("phase")
      .eq("batch_id", assignment.batch_id)
      .maybeSingle();
    const round = String((source.prefill as { round?: string } | null)?.round ?? "");
    if (
      !studyState ||
      !isAudioImpactRoundUnlocked(
        studyState.phase as AudioImpactStudyPhase,
        round as AudioImpactStudyRound,
      )
    ) {
      return NextResponse.json({ error: "Research round is sealed" }, { status: 423 });
    }
  }

  try {
    const url = await presignGet(MEDIA_BUCKET, source.media_key, {
      expiresSeconds: 3600,
      disposition: "inline",
    });
    return NextResponse.json({ url });
  } catch (error) {
    console.error("research media signing failed", error);
    return NextResponse.json({ error: "Could not load media" }, { status: 500 });
  }
}
