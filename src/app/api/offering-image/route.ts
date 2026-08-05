import { NextResponse } from "next/server";

import { MEDIA_BUCKET, presignGet, putObject } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Offering card art the coach uploads themself (the alternative to the
 * shipped 'stock:' images).
 *
 * POST — multipart/form-data with an `image` file (jpeg/png/webp, max
 * 4 MB). Stored at r2://ponglens-media/offer/<userId>/<uuid>.<ext>
 * (permanent prefix, no sweep) and returned as { image }; the client
 * saves it onto the offering row. Prefix-pinned on every signing side.
 *
 * GET ?id=<offeringId> — a short-lived URL for one of the caller's OWN
 * offerings' uploaded image (editor preview).
 */

const MAX_BYTES = 4 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      { error: "Images are limited to 4 MB." },
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

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = `offer/${user.id}/${crypto.randomUUID()}${ext}`;
    await putObject(MEDIA_BUCKET, key, bytes, mime);
    return NextResponse.json({ image: `r2://${MEDIA_BUCKET}/${key}` });
  } catch (e) {
    console.error("offering-image error:", e);
    return NextResponse.json(
      { error: "Could not store the image. Try again." },
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
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const { data: offering } = await supabase
    .from("offerings")
    .select("image, coach_id")
    .eq("id", id)
    .eq("coach_id", user.id)
    .maybeSingle();
  const marker = `r2://${MEDIA_BUCKET}/offer/${user.id}/`;
  if (!offering?.image?.startsWith(marker)) {
    return NextResponse.json({ url: null });
  }
  const key = offering.image.slice(`r2://${MEDIA_BUCKET}/`.length);
  const url = await presignGet(MEDIA_BUCKET, key, { expiresSeconds: 3600 });
  return NextResponse.json({ url });
}
