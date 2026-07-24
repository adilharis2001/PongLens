import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, presignPut } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/feedback/upload — presigned single PUT for one feedback
 * screenshot. Keys are always ponglens-media/feedback/<userId>/<uuid>.<ext>,
 * so a user can only ever write inside their own feedback folder. The client
 * PUTs the file bytes directly to the returned URL.
 *
 * Screenshots are private (admin + author only); they are NOT metered against
 * the user's storage quota (app feedback, not user content) and are not swept
 * by retention. Accepts image/png|jpeg|webp up to 10 MB.
 *
 * Body: { contentType }  ->  { url, key }
 */

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let contentType = "";
  let size = 0;
  try {
    const body = await req.json();
    contentType = String(body.contentType ?? "").toLowerCase();
    size = Number(body.size ?? 0);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ext = EXT_BY_TYPE[contentType];
  if (!ext) {
    return NextResponse.json(
      { error: "Only PNG, JPEG, or WebP images are allowed." },
      { status: 400 }
    );
  }
  if (Number.isFinite(size) && size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Keep screenshots under 10 MB." },
      { status: 400 }
    );
  }

  try {
    const key = `feedback/${user.id}/${crypto.randomUUID()}.${ext}`;
    const url = await presignPut(MEDIA_BUCKET, key, 600);
    return NextResponse.json({ url, key });
  } catch (e) {
    console.error("feedback/upload error:", e);
    return NextResponse.json(
      { error: "Could not prepare the upload. Try again." },
      { status: 500 }
    );
  }
}
