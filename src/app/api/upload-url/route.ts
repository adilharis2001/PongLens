import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  RAW_BUCKET,
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  presignPut,
  presignUploadPart,
} from "@/lib/r2";

export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB (matches the UI limit)
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // >100 MB -> multipart
const PART_SIZE = 64 * 1024 * 1024; // R2 requires uniform part sizes

/**
 * POST /api/upload-url — mint presigned R2 upload URLs for the signed-in
 * user. Keys are always ponglens-raw/<userId>/<uuid>.<ext>, so a user can
 * only ever write inside their own folder.
 *
 * Actions:
 *   create   { fileSize, contentType? }        -> single PUT or multipart
 *   complete { key, uploadId, parts }          -> finish multipart
 *   abort    { key, uploadId }                 -> abandon multipart
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = (body.action as string) ?? "create";

  try {
    if (action === "create") {
      const fileSize = Number(body.fileSize);
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) {
        return NextResponse.json({ error: "Invalid file size" }, { status: 400 });
      }
      const contentType =
        body.contentType === "video/quicktime" ? "video/quicktime" : "video/mp4";
      const ext = contentType === "video/quicktime" ? ".mov" : ".mp4";
      const key = `${user.id}/${crypto.randomUUID()}${ext}`;

      if (fileSize <= MULTIPART_THRESHOLD) {
        const url = await presignPut(RAW_BUCKET, key);
        return NextResponse.json({ mode: "single", bucket: RAW_BUCKET, key, url });
      }

      const uploadId = await createMultipartUpload(RAW_BUCKET, key, contentType);
      const partCount = Math.ceil(fileSize / PART_SIZE);
      const partUrls = await Promise.all(
        Array.from({ length: partCount }, (_, i) =>
          presignUploadPart(RAW_BUCKET, key, uploadId, i + 1)
        )
      );
      return NextResponse.json({
        mode: "multipart",
        bucket: RAW_BUCKET,
        key,
        uploadId,
        partSize: PART_SIZE,
        partUrls,
      });
    }

    // complete / abort operate on an existing multipart upload; the key must
    // live in the caller's own folder.
    const key = String(body.key ?? "");
    const uploadId = String(body.uploadId ?? "");
    if (!key.startsWith(`${user.id}/`) || !uploadId) {
      return NextResponse.json({ error: "Invalid key" }, { status: 403 });
    }

    if (action === "complete") {
      const parts = (body.parts as { partNumber: number; etag: string }[]) ?? [];
      if (!Array.isArray(parts) || parts.length === 0) {
        return NextResponse.json({ error: "No parts" }, { status: 400 });
      }
      await completeMultipartUpload(RAW_BUCKET, key, uploadId, parts);
      return NextResponse.json({ ok: true });
    }

    if (action === "abort") {
      await abortMultipartUpload(RAW_BUCKET, key, uploadId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("upload-url error:", e);
    return NextResponse.json(
      { error: "Could not prepare the upload. Try again." },
      { status: 500 }
    );
  }
}
