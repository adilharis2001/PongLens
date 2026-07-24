import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, putObject } from "@/lib/r2";

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

  // The browser posts the image bytes here (multipart form-data) and the
  // SERVER writes to R2 — a same-origin request, so no bucket CORS is
  // needed (the object-scoped R2 token can't grant browser-PUT CORS on
  // ponglens-media anyway). Screenshots are small (<=10MB), so proxying
  // through the API is fine.
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
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) {
    return NextResponse.json(
      { error: "Only PNG, JPEG, or WebP images are allowed." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Keep screenshots under 10 MB." },
      { status: 400 }
    );
  }

  try {
    const key = `feedback/${user.id}/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await putObject(MEDIA_BUCKET, key, bytes, contentType);
    return NextResponse.json({ key });
  } catch (e) {
    console.error("feedback/upload error:", e);
    return NextResponse.json(
      { error: "Could not upload the screenshot. Try again." },
      { status: 500 }
    );
  }
}
