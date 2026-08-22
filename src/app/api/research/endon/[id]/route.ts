import { NextResponse } from "next/server";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The signal dump for one match on /research/endon.
 *
 * It goes through a route rather than a presigned link straight to the
 * browser for two reasons. A presigned URL cannot be read by `fetch` at all
 * — R2 sends no `Access-Control-Allow-Origin`, so the request dies in
 * preflight — and the alternative, opening CORS on the media bucket, would
 * loosen a production bucket to make a research page work. The second
 * reason is the better one: these dumps are other users' matches, and this
 * way the admin check is what guards them rather than the secrecy of a URL
 * that lives in the page source for twelve hours.
 *
 * The video is still presigned directly. A media element does not need CORS,
 * and proxying a few hundred megabytes of MP4 through a route handler to
 * gain nothing would be silly.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "signed out" }, { status: 401 });
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) return NextResponse.json({ error: "no" }, { status: 404 });

  const signed = await presignGet(
    MEDIA_BUCKET,
    `research/endon/${id}.page.json`,
    { expiresSeconds: 120 },
  );
  const res = await fetch(signed);
  if (!res.ok) {
    return NextResponse.json(
      { error: `not processed yet (${res.status})` },
      { status: 404 },
    );
  }
  return new NextResponse(res.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "private, max-age=300",
    },
  });
}
