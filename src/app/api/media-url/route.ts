import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/media-url — signed R2 GET links for match media.
 *
 *   { matchId, pointId }  -> point clip, inline disposition (streams in <video>)
 *   { matchId, noteId }   -> voice note audio, inline disposition
 *   { matchId, reel }     -> rendered highlight reel, attachment disposition
 *                            (owner only: the match_reels row is read under
 *                            RLS, whose select policy is owner-scoped)
 *   { matchId }           -> full cut video, attachment disposition
 *                            (falls back to the source job's result when
 *                            match.cut_path is null)
 *   { matchId, preview }  -> full cut video, inline disposition (the match
 *                            page's download card streams a preview)
 *
 * Access control: the match row is read through RLS, whose select policy is
 * has_match_access() (owner or accepted coach). No row, no link.
 *
 * Voice notes: the note row is also read through RLS (same match-access
 * policy), and the audio_path must live under the note AUTHOR's own voice
 * folder (voice/<author_id>/...). audio_path is client-writable text, so
 * without that prefix check a user could point their note at any object in
 * the media bucket and use this route to sign a URL for it.
 */

function parseR2(path: string | null | undefined) {
  const m = (path ?? "").match(/^r2:\/\/([^/]+)\/(.+)$/);
  return m ? { bucket: m[1], key: m[2] } : null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let matchId: string;
  let pointId: string;
  let noteId: string;
  let preview: boolean;
  let reel: boolean;
  try {
    const body = await req.json();
    matchId = String(body.matchId ?? "");
    pointId = String(body.pointId ?? "");
    noteId = String(body.noteId ?? "");
    preview = Boolean(body.preview);
    reel = Boolean(body.reel);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!matchId) {
    return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
  }

  // RLS select policy == has_match_access(); reading the row is the check.
  const { data: match, error } = await supabase
    .from("matches")
    .select("id, user_id, job_id, opponent_name, cut_path, status")
    .eq("id", matchId)
    .single();
  if (error || !match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  try {
    if (noteId) {
      const { data: note } = await supabase
        .from("notes")
        .select("id, author_id, audio_path")
        .eq("id", noteId)
        .eq("match_id", matchId)
        .single();
      const loc = parseR2(note?.audio_path);
      // Only sign audio in the media bucket under the author's voice folder.
      if (
        !note ||
        !loc ||
        loc.bucket !== "ponglens-media" ||
        !loc.key.startsWith(`voice/${note.author_id}/`)
      ) {
        return NextResponse.json({ error: "Audio not found" }, { status: 404 });
      }
      const url = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: 3600,
        disposition: "inline",
      });
      return NextResponse.json({ url });
    }

    if (reel) {
      // Owner only: match_reels' select policy is owner-scoped, so a coach
      // (who can read the match) still gets no row here.
      const { data: reelRow } = await supabase
        .from("match_reels")
        .select("status, r2_key")
        .eq("match_id", matchId)
        .maybeSingle();
      if (!reelRow || reelRow.status !== "ready" || !reelRow.r2_key) {
        return NextResponse.json({ error: "Reel not ready" }, { status: 409 });
      }
      const base = (match.opponent_name ?? "").trim() || "match";
      const url = await presignGet(MEDIA_BUCKET, reelRow.r2_key, {
        expiresSeconds: 3600,
        filename: `PongLens - ${base} (highlights).mp4`,
        disposition: "attachment",
      });
      return NextResponse.json({ url });
    }

    if (pointId) {
      const { data: point } = await supabase
        .from("points")
        .select("id, clip_path")
        .eq("id", pointId)
        .eq("match_id", matchId)
        .single();
      const loc = parseR2(point?.clip_path);
      if (!loc) {
        return NextResponse.json({ error: "Clip not found" }, { status: 404 });
      }
      const url = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: 3600,
        disposition: "inline",
      });
      return NextResponse.json({ url });
    }

    // Full cut video. Fall back to the source job's result path.
    let loc = parseR2(match.cut_path);
    if (!loc && match.job_id) {
      const { data: job } = await supabase
        .from("jobs")
        .select("result_path, status")
        .eq("id", match.job_id)
        .single();
      if (job?.status === "done") loc = parseR2(job.result_path);
    }
    if (!loc) {
      return NextResponse.json({ error: "Video not ready" }, { status: 409 });
    }
    // preview: inline disposition so the match page can stream it in a
    // <video>; default: attachment with a friendly filename.
    if (preview) {
      const url = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: 3600,
        disposition: "inline",
      });
      return NextResponse.json({ url });
    }
    const base = (match.opponent_name ?? "").trim() || "match";
    const url = await presignGet(loc.bucket, loc.key, {
      expiresSeconds: 3600,
      filename: `PongLens - ${base} (pure play).mp4`,
      disposition: "attachment",
    });
    return NextResponse.json({ url });
  } catch (e) {
    console.error("media-url error:", e);
    return NextResponse.json(
      { error: "Could not create a media link. Try again shortly." },
      { status: 500 }
    );
  }
}
