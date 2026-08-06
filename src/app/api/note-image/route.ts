import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, presignGet, putObject } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/note-image — an annotated video frame for a note.
 *
 * multipart/form-data with an `image` file (jpeg/png/webp, max 8 MB —
 * a composited 720p frame is a few hundred KB). Stored at
 * r2://ponglens-media/sketch/<userId>/<uuid>.<ext> and returned as
 * { image_path }; the client saves the note with it. Sketches are kept
 * while the account is active (no retention sweep) — they are part of
 * the note's long-term value, unlike the 90-day voice tier.
 *
 * Images always live under the AUTHOR's folder; /api/media-url enforces
 * that when signing them back (same trust model as voice audio).
 */

const MAX_BYTES = 8 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const entry = form.get("image");
    if (entry instanceof File) file = entry;
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No image provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Images are limited to 8 MB." },
      { status: 413 }
    );
  }
  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[mime];
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported image format" },
      { status: 415 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `sketch/${user.id}/${crypto.randomUUID()}${ext}`;

  try {
    await putObject(MEDIA_BUCKET, key, bytes, mime);

    // Storage ledger. Best-effort: accounting must not break an image
    // that is already stored.
    const { error: ledgerError } = await supabase.rpc(
      "ledger_append_sketch",
      {
        p_bytes: bytes.byteLength,
        p_key: `r2://${MEDIA_BUCKET}/${key}`,
      }
    );
    if (ledgerError) {
      console.error("note-image: ledger append failed:", ledgerError);
    }

    // `url` lets the uploader preview what they just attached without a
    // second round-trip (the finding editor shows the student's view).
    const url = await presignGet(MEDIA_BUCKET, key, {
      expiresSeconds: 3600,
      disposition: "inline",
    });
    return NextResponse.json({
      image_path: `r2://${MEDIA_BUCKET}/${key}`,
      url,
    });
  } catch (e) {
    console.error("note-image error:", e);
    return NextResponse.json(
      { error: "Could not store the image. Try again." },
      { status: 500 }
    );
  }
}
