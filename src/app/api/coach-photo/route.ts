import { NextResponse } from "next/server";

import { MEDIA_BUCKET, presignGet, putObject } from "@/lib/r2";
import { checkUploadAllowed, MEDIA_UPLOAD_RULES, refusalStatus } from "@/lib/quota";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/coach-photo — the coach's profile photo.
 *
 * multipart/form-data with an `image` file (jpeg/png/webp, max 4 MB).
 * Stored at r2://ponglens-media/avatar/<userId>/<uuid>.<ext> (permanent;
 * no sweep covers avatar/) and returned as { photo_path }. The client
 * saves it onto coach_profiles; the storefront presigns it back with the
 * same owner-prefix check as every other client-writable media path.
 *
 * GET — a short-lived URL for the caller's OWN photo (the profile
 * editor's preview). Owner-prefix pinned like the storefront side.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("photo_path")
    .eq("user_id", user.id)
    .maybeSingle();
  const marker = `r2://${MEDIA_BUCKET}/avatar/${user.id}/`;
  if (!profile?.photo_path?.startsWith(marker)) {
    return NextResponse.json({ url: null });
  }
  const key = profile.photo_path.slice(`r2://${MEDIA_BUCKET}/`.length);
  const url = await presignGet(MEDIA_BUCKET, key, { expiresSeconds: 3600 });
  return NextResponse.json({ url });
}

const MAX_BYTES = 4 * 1024 * 1024;

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

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "No coach page yet" }, { status: 409 });
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
      { error: "Photos are limited to 4 MB." },
      { status: 413 },
    );
  }
  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[mime];
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported image format" },
      { status: 415 },
    );
  }

  const refused = await checkUploadAllowed(supabase, file.size, MEDIA_UPLOAD_RULES);
  if (refused) {
    return NextResponse.json(
      { error: refused, resource: "storage" },
      { status: refusalStatus(refused) },
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = `avatar/${user.id}/${crypto.randomUUID()}${ext}`;
    await putObject(MEDIA_BUCKET, key, bytes, mime);
    const photoPath = `r2://${MEDIA_BUCKET}/${key}`;
    // Counts like everything else the account stores. Best-effort; the
    // nightly measurement corrects a miss.
    const { error: ledgerError } = await supabase.rpc("ledger_append_own_media", {
      p_bytes: bytes.byteLength,
      p_key: photoPath,
    });
    if (ledgerError) {
      console.error("coach-photo: ledger append failed:", ledgerError);
    }
    return NextResponse.json({ photo_path: photoPath });
  } catch (e) {
    console.error("coach-photo error:", e);
    return NextResponse.json(
      { error: "Could not store the photo. Try again." },
      { status: 500 },
    );
  }
}
