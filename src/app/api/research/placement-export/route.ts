import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BATCH_SLUG = "placement-calibration-cross-venue-v1";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

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
    .eq("slug", BATCH_SLUG)
    .maybeSingle();
  if (!batch) {
    return NextResponse.json({ error: "Placement batch not found" }, { status: 404 });
  }
  const { data, error } = await supabase
    .from("research_assignments")
    .select(
      "sequence,duplicate_group,is_repeat,status,human_label,review_metrics,started_at,submitted_at,research_sources!inner(source_point_idx,match_label,venue_label,proposal,prefill)",
    )
    .eq("batch_id", batchId)
    .order("sequence");
  if (error) {
    console.error("placement research export failed", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }

  const assignments = (data ?? []).map((row) => {
    const joined = row.research_sources as unknown;
    const source = (
      Array.isArray(joined) ? joined[0] : joined
    ) as {
      source_point_idx: number;
      match_label: string;
      venue_label: string | null;
      proposal: Record<string, unknown>;
      prefill: Record<string, unknown>;
    };
    return {
      sequence: row.sequence,
      duplicate_group: row.duplicate_group,
      is_repeat: row.is_repeat,
      status: row.status,
      human_label: row.human_label,
      review_metrics: row.review_metrics,
      started_at: row.started_at,
      submitted_at: row.submitted_at,
      anonymous_event_id: source.proposal.event_id,
      match_label: source.match_label,
      venue_label: source.venue_label,
      proposal: source.proposal,
      stratum: source.prefill.match_index,
    };
  });
  return new NextResponse(
    JSON.stringify(
      {
        schema_version: 1,
        batch: {
          slug: batch.slug,
          title: batch.title,
          status: batch.status,
        },
        exported_at: new Date().toISOString(),
        assignments,
      },
      null,
      2,
    ),
    {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition":
          'attachment; filename="ponglens-placement-calibration-pilot.json"',
        "Cache-Control": "no-store",
      },
    },
  );
}
