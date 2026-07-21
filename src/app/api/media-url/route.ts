import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { presignGet } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/media-url — signed R2 GET links for match media.
 *
 *   { matchId, pointId }  -> point clip, inline disposition (streams in <video>)
 *   { matchId }           -> full cut video, attachment disposition
 *                            (falls back to the source job's result when
 *                            match.cut_path is null)
 *
 * Access control: the match row is read through RLS, whose select policy is
 * has_match_access() (owner or accepted coach). No row, no link.
 */

function parseR2(path: string | null | undefined) {
  const m = (path ?? "").match(/^r2:\/\/([^/]+)\/(.+)$/);
  return m ? { bucket: m[1], key: m[2] } : null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let matchId: string;
  let pointId: string;
  try {
    const body = await req.json();
    matchId = String(body.matchId ?? "");
    pointId = String(body.pointId ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!matchId) {
    return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
  }

  // RLS select policy == has_match_access(); reading the row is the check.
  const { data: match, error } = await supabase
    .from("matches")
    .select("id, user_id, job_id, opponent_name, cut_path, status")
    .eq("id", matchId)
    .single();
  if (error || !match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  try {
    if (pointId) {
      const { data: point } = await supabase
        .from("points")
        .select("id, clip_path")
        .eq("id", pointId)
        .eq("match_id", matchId)
        .single();
      const loc = parseR2(point?.clip_path);
      if (!loc) {
        return NextResponse.json({ error: "Clip not found" }, { status: 404 });
      }
      const url = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: 3600,
        disposition: "inline",
      });
      return NextResponse.json({ url });
    }

    // Full cut video. Fall back to the source job's result path.
    let loc = parseR2(match.cut_path);
    if (!loc && match.job_id) {
      const { data: job } = await supabase
        .from("jobs")
        .select("result_path, status")
        .eq("id", match.job_id)
        .single();
      if (job?.status === "done") loc = parseR2(job.result_path);
    }
    if (!loc) {
      return NextResponse.json({ error: "Video not ready" }, { status: 409 });
    }
    const base = (match.opponent_name ?? "").trim() || "match";
    const url = await presignGet(loc.bucket, loc.key, {
      expiresSeconds: 3600,
      filename: `PongLens - ${base} (pure play).mp4`,
      disposition: "attachment",
    });
    return NextResponse.json({ url });
  } catch (e) {
    console.error("media-url error:", e);
    return NextResponse.json(
      { error: "Could not create a media link. Try again shortly." },
      { status: 500 }
    );
  }
}
