import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { presignGet } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/download-url { jobId } — signed download link for a finished
 * job the caller owns. Handles both storage generations:
 *   r2://<bucket>/<key>  -> presigned R2 GET (with friendly filename)
 *   <path>               -> legacy Supabase Storage 'results' signed URL
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let jobId: string;
  try {
    const body = await req.json();
    jobId = String(body.jobId ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  // RLS already scopes this to the caller's rows; the user_id check is a
  // second, explicit ownership assertion.
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, user_id, result_path, original_name, status")
    .eq("id", jobId)
    .single();
  if (error || !job || job.user_id !== user.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "done" || !job.result_path) {
    return NextResponse.json({ error: "Result not ready" }, { status: 409 });
  }

  const base = (() => {
    const name = job.original_name ?? "";
    const i = name.lastIndexOf(".");
    const b = (i > 0 ? name.slice(0, i) : name).trim();
    return b.length > 0 ? b : "match";
  })();
  const filename = `PongLens - ${base} (pure play).mp4`;

  try {
    const r2Match = job.result_path.match(/^r2:\/\/([^/]+)\/(.+)$/);
    if (r2Match) {
      const url = await presignGet(r2Match[1], r2Match[2], {
        expiresSeconds: 3600,
        filename,
      });
      return NextResponse.json({ url });
    }

    // Legacy row: result still lives in Supabase Storage.
    const { data, error: signError } = await supabase.storage
      .from("results")
      .createSignedUrl(job.result_path, 3600, { download: filename });
    if (signError || !data?.signedUrl) {
      throw signError ?? new Error("no signed URL");
    }
    return NextResponse.json({ url: data.signedUrl });
  } catch (e) {
    console.error("download-url error:", e);
    return NextResponse.json(
      { error: "Could not create a download link. Try again shortly." },
      { status: 500 }
    );
  }
}
