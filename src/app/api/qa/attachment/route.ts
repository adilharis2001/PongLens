import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, presignGet, putObject } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * Evidence for a bug report, both directions.
 *
 * POST — multipart upload of one screenshot or screen recording. Written
 * to R2 under qa/<userId>/ by the server, the same way the feedback
 * screenshot route works, so no bucket CORS is involved.
 *
 * GET ?key=... — redirect to a short-lived signed URL for one attachment.
 *
 * Two differences from /api/feedback/upload. Video is allowed, because
 * this is a video product and a stutter, a stall or a rotation glitch
 * cannot be a screenshot. And the size cap is higher to match: a few
 * seconds of screen recording clears 10 MB easily.
 *
 * Not metered against anyone's storage quota. Bug evidence is app
 * feedback, not user content, and it is not swept by retention.
 */

const MAX_BYTES = 60 * 1024 * 1024; // 60 MB

const EXT_BY_TYPE: Record<string, { ext: string; kind: "image" | "video" }> = {
  "image/png": { ext: "png", kind: "image" },
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
};

/**
 * The gate for both verbs. Only the two roles that can see the bug table
 * can put anything in it or read anything out of it, and the key prefix
 * keeps a writer inside their own folder.
 */
async function allowed(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ data: isAdmin }, { data: isQa }] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase.rpc("is_qa"),
  ]);
  return isAdmin === true || isQa === true;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!(await allowed(supabase))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }

  const contentType = file.type.toLowerCase();
  const match = EXT_BY_TYPE[contentType];
  if (!match) {
    return NextResponse.json(
      { error: "Attach a PNG, JPEG or WebP image, or an MP4, WebM or MOV." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Keep attachments under 60 MB." },
      { status: 400 },
    );
  }

  try {
    const key = `qa/${user.id}/${crypto.randomUUID()}.${match.ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await putObject(MEDIA_BUCKET, key, bytes, contentType);
    return NextResponse.json({ key, kind: match.kind });
  } catch (e) {
    console.error("qa/attachment upload error:", e);
    return NextResponse.json(
      { error: "Could not upload that. Try again." },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!(await allowed(supabase))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const key = new URL(req.url).searchParams.get("key") ?? "";
  // The prefix check is what stops this route being a general-purpose
  // reader for the whole media bucket, which holds every player's footage.
  if (!key.startsWith("qa/") || key.includes("..")) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  try {
    const url = await presignGet(MEDIA_BUCKET, key, {
      expiresSeconds: 300,
      disposition: "inline",
    });
    return NextResponse.redirect(url, 302);
  } catch (e) {
    console.error("qa/attachment read error:", e);
    return NextResponse.json({ error: "Unavailable" }, { status: 500 });
  }
}
