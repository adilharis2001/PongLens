import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/config";
import { headObject, presignGet } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/admin/media-url — signed inline links for the players portal.
 *
 *   { matchId }             -> the match's cut video
 *   { matchId, pointId }    -> one point's clip
 *   { matchId, raw: true }  -> the ORIGINAL upload (30-day retention;
 *                              HEAD-checked so an expired raw says so
 *                              instead of handing out a dead link)
 *
 * Access control lives in the RPCs (admin_match_cut_path 068,
 * admin_point_clip_path 069): each re-checks is_admin() before handing
 * back a path, so a non-admin session gets an error from Postgres even if
 * the email check here were wrong. The route only turns the returned
 * r2:// path into a time-limited URL.
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
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let matchId: string;
  let pointId: string;
  let raw: boolean;
  try {
    const body = await req.json();
    matchId = String(body.matchId ?? "");
    pointId = String(body.pointId ?? "");
    raw = Boolean(body.raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!matchId) {
    return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
  }

  const { data: path, error } = pointId
    ? await supabase.rpc("admin_point_clip_path", {
        p_match_id: matchId,
        p_point_id: pointId,
      })
    : raw
      ? await supabase.rpc("admin_match_raw_path", {
          p_match_id: matchId,
        })
      : await supabase.rpc("admin_match_cut_path", {
          p_match_id: matchId,
        });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  const loc = parseR2(path as string | null);
  if (!loc) {
    return NextResponse.json({ error: "Video not ready" }, { status: 409 });
  }
  if (raw && !(await headObject(loc.bucket, loc.key))) {
    return NextResponse.json(
      { error: "The original upload has expired (raw files are kept 30 days)." },
      { status: 404 }
    );
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
