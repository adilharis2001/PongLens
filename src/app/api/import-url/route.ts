import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/import-url — queue a YouTube import for the signed-in user.
 *
 * The browser sends a public or unlisted YouTube URL plus the same
 * processing options as a file upload. We validate + normalize the URL,
 * then insert a jobs row (kind 'youtube_import', options.url). The pgmq
 * trigger enqueues it and the Mac worker does the actual download with
 * yt-dlp, pushes the file to R2, and runs the normal pipeline.
 *
 * Body: { url, points?, placement?, strictness?, meta?: { opponent_name, match_type } }
 * ->    { ok: true, jobId } | { error }
 */

const VALID_STRICTNESS = new Set(["tight", "normal", "loose"]);
const VALID_MATCH_TYPES = new Set(["practice", "league", "tournament"]);

// A YouTube video id is exactly 11 chars of [A-Za-z0-9_-].
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract a video id from the URL shapes users actually paste:
 *   youtube.com/watch?v=ID     (+ www. / m. / music.)
 *   youtu.be/ID
 *   youtube.com/shorts/ID
 *   youtube.com/live/ID
 *   youtube.com/embed/ID
 * Unlisted videos use the same shapes, so they pass through fine.
 * Returns null for anything else (playlists, channels, non-YouTube).
 */
function extractVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // Allow pasting without a scheme ("youtu.be/xyz").
    try {
      url = new URL(`https://${raw.trim()}`);
    } catch {
      return null;
    }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com"
  ) {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v") ?? "";
      return VIDEO_ID.test(id) ? id : null;
    }
    const m = url.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/);
    if (m && VIDEO_ID.test(m[2])) return m[2];
  }
  return null;
}

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

  const videoId = extractVideoId(String(body.url ?? ""));
  if (!videoId) {
    return NextResponse.json(
      { error: "That doesn't look like a YouTube video link." },
      { status: 400 }
    );
  }
  // Canonical form: strips playlist/timestamp/tracking params.
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  // Same options shape the upload sheet writes (see UploadCard.queueJob).
  const points = body.points !== false; // default ON
  const placement = points && body.placement === true;
  const strictness = VALID_STRICTNESS.has(String(body.strictness))
    ? String(body.strictness)
    : "normal";
  const meta =
    body.meta && typeof body.meta === "object"
      ? (body.meta as Record<string, unknown>)
      : {};
  const opponent = String(meta.opponent_name ?? "").trim().slice(0, 120) || null;
  const matchType = VALID_MATCH_TYPES.has(String(meta.match_type))
    ? String(meta.match_type)
    : null;

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      kind: "youtube_import",
      status: "queued",
      input_path: null, // the worker sets this after it fetches the video
      original_name: `YouTube ${videoId}`, // worker replaces with the title
      options: {
        url,
        points,
        placement,
        strictness,
        meta: { opponent_name: opponent, match_type: matchType },
      },
    })
    .select("id")
    .single();

  if (error) {
    console.error("import-url insert error:", error);
    return NextResponse.json(
      { error: "Couldn't queue the import. Try again." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, jobId: data.id });
}
