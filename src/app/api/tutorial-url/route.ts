import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, presignGetBatch } from "@/lib/r2";
import { handleTutorialURLRequest } from "@/app/learn/tutorialRoute";

export const runtime = "nodejs";

/**
 * POST /api/tutorial-url — signed R2 GETs for the tutorial chapters.
 *
 *   { course, platform }       -> namespaced URLs for one course
 *   { course, platform, slug } -> one namespaced chapter URL
 *   {} or no body              -> legacy flat player chapter URLs
 *   { slug }                   -> one legacy flat player chapter URL
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
  return handleTutorialURLRequest(req, {
    getUser: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user;
    },
    sign: (items) => presignGetBatch(items.map((item) => ({
      bucket: MEDIA_BUCKET,
      key: item.key,
      opts: {
        disposition: item.disposition,
        expiresSeconds: item.expiresSeconds,
      },
    }))),
  });
}
