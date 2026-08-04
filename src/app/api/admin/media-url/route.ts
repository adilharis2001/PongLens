import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupportEmail } from "@/lib/config";
import { presignGet } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/admin/media-url — { matchId } -> a signed inline link for any
 * match's cut video, for the players portal.
 *
 * Access control lives in admin_match_cut_path (068): the RPC re-checks
 * is_admin() before handing back a path, so a non-admin session gets an
 * error from Postgres even if the email check here were wrong. The route
 * only turns the returned r2:// path into a time-limited URL.
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
  const adminEmail = await getSupportEmail();
  if (!user || user.email !== adminEmail) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let matchId: string;
  try {
    const body = await req.json();
    matchId = String(body.matchId ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!matchId) {
    return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
  }

  const { data: path, error } = await supabase.rpc("admin_match_cut_path", {
    p_match_id: matchId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  const loc = parseR2(path as string | null);
  if (!loc) {
    return NextResponse.json({ error: "Video not ready" }, { status: 409 });
  }

  try {
    const url = await presignGet(loc.bucket, loc.key, {
      expiresSeconds: 3600,
      disposition: "inline",
    });
    return NextResponse.json({ url });
  } catch (e) {
    console.error("admin media-url error:", e);
    return NextResponse.json(
      { error: "Could not create a media link. Try again shortly." },
      { status: 500 }
    );
  }
}
