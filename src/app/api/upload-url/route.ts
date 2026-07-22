import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkUploadAllowed } from "@/lib/quota";
import {
  RAW_BUCKET,
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  listParts,
  presignUploadPart,
} from "@/lib/r2";

export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB (matches the UI limit)
const MAX_PARTS = 10_000; // R2 hard limit

/**
 * POST /api/upload-url — R2 multipart plumbing for the signed-in user.
 * Keys are always ponglens-raw/<userId>/<uuid>.<ext>, so a user can only
 * ever write inside their own folder. Every upload is multipart (R2 allows
 * a single-part multipart upload) so any upload can be resumed.
 *
 * Actions:
 *   create     { fileSize, contentType? }         -> { bucket, key, uploadId }
 *   sign-part  { key, uploadId, partNumber }      -> { url }
 *   list-parts { key, uploadId }                  -> { parts: [{PartNumber, Size, ETag}] }
 *   complete   { key, uploadId, parts }           -> { ok }
 *   abort      { key, uploadId }                  -> { ok }
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
      // Storage quota + anti-spam gate (see src/lib/quota.ts).
      const rejection = await checkUploadAllowed(supabase, fileSize);
      if (rejection) {
        return NextResponse.json({ error: rejection }, { status: 429 });
      }
      const contentType =
        body.contentType === "video/quicktime" ? "video/quicktime" : "video/mp4";
      const ext = contentType === "video/quicktime" ? ".mov" : ".mp4";
      const key = `${user.id}/${crypto.randomUUID()}${ext}`;
      const uploadId = await createMultipartUpload(RAW_BUCKET, key, contentType);
      return NextResponse.json({ bucket: RAW_BUCKET, key, uploadId });
    }

    // All other actions operate on an existing multipart upload; the key
    // must live in the caller's own folder.
    const key = String(body.key ?? "");
    const uploadId = String(body.uploadId ?? "");
    if (!key.startsWith(`${user.id}/`) || !uploadId) {
      return NextResponse.json({ error: "Invalid key" }, { status: 403 });
    }

    if (action === "sign-part") {
      const partNumber = Number(body.partNumber);
      if (
        !Number.isInteger(partNumber) ||
        partNumber < 1 ||
        partNumber > MAX_PARTS
      ) {
        return NextResponse.json({ error: "Invalid part" }, { status: 400 });
      }
      const url = await presignUploadPart(RAW_BUCKET, key, uploadId, partNumber);
      return NextResponse.json({ url });
    }

    if (action === "list-parts") {
      const parts = await listParts(RAW_BUCKET, key, uploadId);
      return NextResponse.json({ parts });
    }

    if (action === "complete") {
      const raw = (body.parts as Record<string, unknown>[]) ?? [];
      if (!Array.isArray(raw) || raw.length === 0) {
        return NextResponse.json({ error: "No parts" }, { status: 400 });
      }
      // Accept both Uppy-style {PartNumber, ETag} and legacy {partNumber, etag}.
      const parts = raw.map((p) => ({
        partNumber: Number(p.PartNumber ?? p.partNumber),
        etag: String(p.ETag ?? p.etag ?? ""),
      }));
      if (parts.some((p) => !Number.isInteger(p.partNumber) || !p.etag)) {
        return NextResponse.json({ error: "Bad parts" }, { status: 400 });
      }
      // Real uploaded size for the storage ledger, straight from R2.
      let totalBytes = 0;
      try {
        const uploaded = await listParts(RAW_BUCKET, key, uploadId);
        totalBytes = uploaded.reduce((sum, p) => sum + (p.Size || 0), 0);
      } catch (e) {
        console.error("upload-url: listParts for ledger failed:", e);
      }
      await completeMultipartUpload(RAW_BUCKET, key, uploadId, parts);
      if (totalBytes > 0) {
        // Best-effort: accounting must not fail a finished upload.
        const { error: ledgerError } = await supabase.rpc(
          "ledger_append_upload",
          { p_bytes: totalBytes, p_key: `r2://${RAW_BUCKET}/${key}` }
        );
        if (ledgerError) {
          console.error("upload-url: ledger append failed:", ledgerError);
        }
      }
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
