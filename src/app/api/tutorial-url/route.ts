import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, presignGetBatch } from "@/lib/r2";
import { CHAPTERS } from "@/app/learn/videos/chapters";

export const runtime = "nodejs";

/**
 * POST /api/tutorial-url — signed R2 GETs for the tutorial chapters.
 *
 *   {}              -> { urls: { slug: url } } for every chapter
 *   { slug: "..." } -> { urls: { slug: url } } for one
 *
 * Signed in one batch like the match thumbnails, because the videos page
 * wants all nine at once and signing them one at a time costs a metering
 * round trip each (see presignGetBatch).
 *
 * Sign-in required — /learn is behind the app gate, so its media should be
 * too — but nothing here is per-user: every chapter is the same file for
 * everyone, so there is no ownership to check, only a session.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let slug: string | undefined;
  try {
    ({ slug } = (await req.json()) as { slug?: string });
  } catch {
    // no body: sign the lot
  }

  // Only slugs we know about, so the route can never be talked into signing
  // an arbitrary key in the media bucket.
  const wanted = slug ? CHAPTERS.filter((c) => c.slug === slug) : CHAPTERS;
  if (wanted.length === 0) {
    return NextResponse.json({ error: "Unknown chapter" }, { status: 404 });
  }

  const urls = await presignGetBatch(
    wanted.map((c) => ({
      bucket: MEDIA_BUCKET,
      key: `tutorial/${c.slug}.mp4`,
      opts: { disposition: "inline" as const, expiresSeconds: 6 * 3600 },
    }))
  );

  return NextResponse.json({
    urls: Object.fromEntries(wanted.map((c, i) => [c.slug, urls[i]])),
  });
}
