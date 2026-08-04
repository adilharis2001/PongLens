import { NextResponse } from "next/server";

import { headObject, MEDIA_BUCKET, presignPut } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/review-attachment — coach uploads a file onto an order.
 *
 * Two actions:
 *   { action: "create", orderId, filename, contentType, size }
 *       -> { url, key }   presigned PUT into review/<coachId>/
 *   { action: "complete", orderId, key, filename, contentType }
 *       -> { attachment } HEAD-verifies the object, inserts the row
 *          (RLS: coach on an in-progress order only)
 *
 * 50 MB cap, allow-listed types. Files land under review/<coachId>/,
 * which no retention sweep touches; /api/review-media signs them back.
 */

const MAX_BYTES = 50 * 1024 * 1024;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "text/plain",
]);

function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "file";
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_signed_in" }, { status: 401 });
  }

  let body: {
    action?: string;
    orderId?: string;
    filename?: string;
    contentType?: string;
    size?: number;
    key?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "invalid_json" }, { status: 400 });
  }

  const orderId = body.orderId ?? "";
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json({ code: "invalid_order" }, { status: 400 });
  }
  const contentType = (body.contentType ?? "").split(";")[0].trim();
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ code: "unsupported_type" }, { status: 415 });
  }
  const filename = cleanFilename(body.filename ?? "");

  // The insert RLS is the real gate; this early check just gives a clean
  // error before any bytes move.
  const { data: writable } = await supabase.rpc("review_writable", {
    p_order_id: orderId,
  });
  if (!writable) {
    return NextResponse.json({ code: "not_allowed" }, { status: 403 });
  }

  try {
    if (body.action === "create") {
      const size = Number(body.size ?? 0);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
        return NextResponse.json({ code: "too_large" }, { status: 413 });
      }
      const key = `review/${user.id}/${crypto.randomUUID()}-${filename}`;
      const url = await presignPut(MEDIA_BUCKET, key, 600);
      return NextResponse.json({ url, key });
    }

    if (body.action === "complete") {
      const key = body.key ?? "";
      if (!key.startsWith(`review/${user.id}/`)) {
        return NextResponse.json({ code: "not_allowed" }, { status: 403 });
      }
      const size = await headObject(MEDIA_BUCKET, key);
      if (!size || size <= 0 || size > MAX_BYTES) {
        return NextResponse.json({ code: "upload_missing" }, { status: 400 });
      }
      const { data, error } = await supabase
        .from("review_attachments")
        .insert({
          order_id: orderId,
          r2_key: `r2://${MEDIA_BUCKET}/${key}`,
          filename,
          size_bytes: size,
          content_type: contentType,
        })
        .select()
        .single();
      if (error) {
        console.error("review-attachment insert:", error);
        return NextResponse.json({ code: "not_allowed" }, { status: 403 });
      }
      return NextResponse.json({ attachment: data });
    }

    return NextResponse.json({ code: "invalid_action" }, { status: 400 });
  } catch (e) {
    console.error("review-attachment error:", e);
    return NextResponse.json({ code: "server_error" }, { status: 500 });
  }
}
