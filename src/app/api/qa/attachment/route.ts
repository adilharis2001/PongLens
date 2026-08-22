import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { headObject, MEDIA_BUCKET, presignGet, presignPut } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * Evidence for a bug report, both directions.
 *
 * POST { action: "create", contentType, size }
 *      -> { url, key, kind }   presigned PUT into qa/<userId>/
 * POST { action: "complete", key }
 *      -> { key, kind }        HEAD-verifies the object actually landed
 *
 * GET ?key=... — redirect to a short-lived signed URL for one attachment.
 *
 * The bytes go BROWSER -> R2, not browser -> function -> R2. That was the
 * first shape, copied from /api/feedback/upload, and it could never have
 * worked here: a Vercel function's request body is capped at 4.5 MB, well
 * under this route's own limit, and the cap is enforced by the platform
 * before any of this code runs. So the route answered every screen
 * recording with FUNCTION_PAYLOAD_TOO_LARGE while advertising 60 MB — the
 * one file type it exists for was the one it could not accept. Video is
 * the point: a stutter, a stall or a rotation glitch cannot be a
 * screenshot. /api/review-attachment already moves coach files onto the
 * same bucket this way; this is that pattern, with the order's write
 * permission swapped for the QA role.
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

/** Back from a stored key to what the browser should render it as. */
const KIND_BY_EXT = new Map(
  Object.values(EXT_BY_TYPE).map((v) => [v.ext, v.kind] as const),
);

/**
 * The gate for every verb. Only the two roles that can see the bug table
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

  let body: { action?: string; contentType?: string; size?: number; key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  try {
    if (body.action === "create") {
      const contentType = (body.contentType ?? "").split(";")[0].trim().toLowerCase();
      const match = EXT_BY_TYPE[contentType];
      if (!match) {
        return NextResponse.json(
          { error: "Attach a PNG, JPEG or WebP image, or an MP4, WebM or MOV." },
          { status: 415 },
        );
      }
      const size = Number(body.size ?? 0);
      if (!Number.isFinite(size) || size <= 0) {
        return NextResponse.json({ error: "That file is empty." }, { status: 400 });
      }
      if (size > MAX_BYTES) {
        return NextResponse.json(
          { error: "Keep attachments under 60 MB." },
          { status: 413 },
        );
      }
      const key = `qa/${user.id}/${crypto.randomUUID()}.${match.ext}`;
      // Ten minutes: long enough for 60 MB on a bad hotel connection, short
      // enough that a URL left in a console is not a standing write.
      const url = await presignPut(MEDIA_BUCKET, key, 600);
      return NextResponse.json({ url, key, kind: match.kind });
    }

    if (body.action === "complete") {
      const key = body.key ?? "";
      // Same prefix rule as the reader below, and it is what stops one
      // tester claiming a key inside someone else's folder.
      if (!key.startsWith(`qa/${user.id}/`) || key.includes("..")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // The PUT goes straight to R2, so this is the only moment the server
      // learns whether it arrived. Without it a browser that dropped its
      // upload halfway would still file a bug pointing at nothing.
      const size = await headObject(MEDIA_BUCKET, key);
      if (!size || size <= 0 || size > MAX_BYTES) {
        return NextResponse.json(
          { error: "That upload did not finish. Try it again." },
          { status: 400 },
        );
      }
      const ext = key.split(".").pop() ?? "";
      return NextResponse.json({ key, kind: KIND_BY_EXT.get(ext) ?? "image" });
    }

    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
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
  // Any qa/ key, not just the reader's own: triage means Adil opening the
  // screenshots Mumtaz attached.
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
