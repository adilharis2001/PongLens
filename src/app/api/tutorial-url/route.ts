import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, presignGetBatch } from "@/lib/r2";
import type { LearnAudience, LearnPlatform } from "@/app/learn/catalogTypes";
import { resolveTutorialRequest } from "@/app/learn/tutorialRequest";

export const runtime = "nodejs";

/**
 * POST /api/tutorial-url — signed R2 GETs for the tutorial chapters.
 *
 *   { course, platform }       -> { urls: { slug: url } } for the course
 *   { course, platform, slug } -> { urls: { slug: url } } for one chapter
 *
 * Signed in one batch like the match thumbnails, because the videos page
 * wants all nine at once and signing them one at a time costs a metering
 * round trip each (see presignGetBatch).
 *
 * Sign-in required — /learn is behind the app gate, so its media should be
 * too — but nothing here is per-user: every chapter is the same file for
 * everyone, so there is no ownership to check, only a session.
 */
interface TutorialURLRequest {
  course: LearnAudience;
  platform: LearnPlatform;
  slug?: string;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let request: TutorialURLRequest;
  try {
    request = (await req.json()) as TutorialURLRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid course or platform" },
      { status: 400 },
    );
  }

  if (!request || typeof request !== "object") {
    return NextResponse.json(
      { error: "Invalid course or platform" },
      { status: 400 },
    );
  }

  // The resolver returns catalog chapters, never a key constructed from
  // request text, so course and platform select visibility without becoming
  // a storage authorization boundary of their own.
  const wanted = resolveTutorialRequest(request);
  if (wanted === null) {
    return NextResponse.json(
      { error: "Invalid course or platform" },
      { status: 400 },
    );
  }
  if (wanted.length === 0) {
    return NextResponse.json({ error: "Unknown chapter" }, { status: 404 });
  }

  const urls = await presignGetBatch(
    wanted.map((c) => ({
      bucket: MEDIA_BUCKET,
      key: c.mediaKey,
      opts: { disposition: "inline" as const, expiresSeconds: 6 * 3600 },
    }))
  );

  return NextResponse.json({
    urls: Object.fromEntries(wanted.map((c, i) => [c.slug, urls[i]])),
  });
}
