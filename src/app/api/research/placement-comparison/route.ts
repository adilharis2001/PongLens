import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  PlacementCalibrationHumanLabel,
  PlacementCalibrationProposal,
} from "@/lib/research/placementCalibration";

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

  const { data: assignment } = await supabase
    .from("research_assignments")
    .select("source_id,human_label")
    .eq("id", assignmentId)
    .maybeSingle();
  const label =
    assignment?.human_label as PlacementCalibrationHumanLabel | null;
  if (!assignment || !label?.revealed_at || !label.blind_snapshot) {
    return NextResponse.json(
      { error: "Save a blind answer before revealing predictions" },
      { status: 409 },
    );
  }

  const { data: source } = await supabase
    .from("research_sources")
    .select("proposal")
    .eq("id", assignment.source_id)
    .maybeSingle();
  if (!source) {
    return NextResponse.json({ error: "Research source not found" }, { status: 404 });
  }
  const proposal = source.proposal as unknown as PlacementCalibrationProposal;
  return NextResponse.json({ predictions: proposal.predictions });
}
