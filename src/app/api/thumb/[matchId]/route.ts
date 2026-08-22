import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, getObject } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * GET /api/thumb/<matchId> — a match's poster thumb, as bytes.
 *
 * The point of this route is that its URL never changes. Thumbs used to be
 * handed to clients as presigned R2 links from /api/media-url, which meant
 * every holder of one had to notice it expiring and go get another. The iOS
 * app's cache decided staleness at read time and quietly started answering
 * "no thumb", with nothing to re-sign it and nothing to tell the UI — so
 * thumbnails vanished about fifty minutes into a session and only came back
 * on a relaunch. A stable URL removes the problem rather than timing it:
 * signing happens here, per request, where it cannot be held too long.
 *
 * It also lets HTTP caching do its job. A presigned URL carries a fresh
 * signature every time, so it is a new cache key every time and no client
 * cache ever hits. This URL is the same forever, so a client (and its disk
 * cache) keeps the picture across launches and offline.
 *
 * Access control: the matches row is read through RLS, whose select policy
 * is has_match_access() (owner or accepted coach). No row, no bytes. The
 * thumb_path must also live in the media bucket — it is a database column,
 * and this route would otherwise read any object the key names.
 */

// Thumbs are rewritten only when a match is reprocessed, which also changes
// the object. A day of cache with revalidation after keeps a scroll through
// the library free while still letting a regenerated thumb land.
const MAX_AGE = 86400;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      matchId
    )
  ) {
    return new Response("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Not signed in", { status: 401 });
  }

  const { data: row } = await supabase
    .from("matches")
    .select("thumb_path")
    .eq("id", matchId)
    .maybeSingle();

  const m = (row?.thumb_path ?? "").match(/^r2:\/\/([^/]+)\/(.+)$/);
  if (!m || m[1] !== MEDIA_BUCKET) {
    // No row, no thumb yet, or a path pointing somewhere it shouldn't. All
    // three mean the same thing to a caller: show the placeholder. 404 is
    // deliberately not cached — a match still processing gets its thumb
    // minutes later, and the next ask should see it.
    return new Response("No thumb", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const object = await getObject(m[1], m[2]);
    if (!object) {
      return new Response("No thumb", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return new Response(object.body, {
      status: 200,
      headers: {
        "Content-Type": object.contentType ?? "image/webp",
        // private: this is one player's match, never a shared cache's to
        // keep. The client's own disk cache is the one that matters.
        "Cache-Control": `private, max-age=${MAX_AGE}, stale-while-revalidate=604800`,
        ...(object.etag ? { ETag: object.etag } : {}),
      },
    });
  } catch (e) {
    console.error("thumb route error:", e);
    return new Response("Could not read the thumb", {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
