import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * GET /api/feedback/image?key=... — redirect to a short-TTL signed R2 GET for
 * one feedback screenshot, but ONLY when the caller is the admin or the
 * item's author. Privacy gate: screenshots can contain personal info, so the
 * public board never exposes their keys and this endpoint is the only way to
 * fetch the bytes. Authorization is enforced server-side by the SECURITY
 * DEFINER RPC feedback_can_view_attachment (admin, or the key lives under the
 * caller's own feedback/<uid>/ prefix and is referenced by one of their
 * items). Used directly as an <img src>.
 */

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!key.startsWith("feedback/")) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  const { data: allowed, error } = await supabase.rpc(
    "feedback_can_view_attachment",
    { p_key: key }
  );
  if (error) {
    console.error("feedback/image gate failed:", error);
    return NextResponse.json({ error: "Unavailable" }, { status: 500 });
  }
  if (allowed !== true) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = await presignGet(MEDIA_BUCKET, key, {
      expiresSeconds: 300,
      disposition: "inline",
    });
    return NextResponse.redirect(url, 302);
  } catch (e) {
    console.error("feedback/image error:", e);
    return NextResponse.json({ error: "Unavailable" }, { status: 500 });
  }
}
