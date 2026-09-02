import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  MEDIA_BUCKET,
  RAW_BUCKET,
  headObject,
  presignGet,
  presignGetBatch,
} from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/media-url — signed R2 GET links for match media.
 *
 *   { thumbs: [matchId] } -> { urls: { matchId: url } } — poster thumbs for
 *                            up to 100 matches in one call (the Matches
 *                            library). Matches the caller can't read, or
 *                            without a thumb, are simply absent from the map.
 *   { matchId, pointId }  -> point clip, inline disposition (streams in <video>)
 *   { matchId, noteId }   -> voice note audio, inline disposition
 *   { matchId, reel, scope? } -> rendered export (scope 'starred' default or
 *                            'full'), attachment disposition (owner only: the
 *                            match_reels row is read under RLS, whose select
 *                            policy is owner-scoped)
 *   { matchId, raw }      -> original raw upload, attachment disposition.
 *                            Resolved through the source job, whose select
 *                            policy is owner-only, so this one is a
 *                            download for the owner and nobody else.
 *                            HEAD-checked, so a gone upload returns
 *                            { available: false } (200) and the Export
 *                            sheet simply hides the row.
 *   { matchId, rawPreview } -> the SAME original, inline, so it streams in a
 *                            <video>. The raw view of an unprocessed match
 *                            and the "Original" pill on a processed one.
 *                            Open to everyone has_match_access() admits,
 *                            deliberately: watching the uncut footage when
 *                            the cut came out poor is as much a coach's
 *                            need as the player's.
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
  let image: boolean;
  let preview: boolean;
  let reel: boolean;
  let download: boolean;
  let raw: boolean;
  let rawPreview: boolean;
  let scope: string;
  let thumbs: string[];
  let tagReel: string;
  let lessonId: string;
  try {
    const body = await req.json();
    matchId = String(body.matchId ?? "");
    lessonId = String(body.lessonId ?? "");
    pointId = String(body.pointId ?? "");
    noteId = String(body.noteId ?? "");
    image = Boolean(body.image);
    preview = Boolean(body.preview);
    reel = Boolean(body.reel);
    download = Boolean(body.download);
    raw = Boolean(body.raw);
    rawPreview = Boolean(body.rawPreview);
    // 'starred' | 'full' | 'tag:<uuid>' (036) | 'v:point:<uuid>' | 'v:starred'
    // (135, the vertical share renders) — anything else is starred.
    const rawScope = String(body.scope ?? "");
    const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    scope =
      rawScope === "full" ||
      rawScope === "v:starred" ||
      /^v:hl:(story|reel|long)$/.test(rawScope) ||
      new RegExp(`^tag:${UUID}$`).test(rawScope) ||
      new RegExp(`^v:point:${UUID}$`).test(rawScope)
        ? rawScope
        : "starred";
    thumbs = Array.isArray(body.thumbs)
      ? body.thumbs
          .filter((v: unknown): v is string => typeof v === "string")
          .slice(0, 100)
      : [];
    tagReel = String(body.tagReel ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // { lessonId, image: true } — a journal entry's attached photo. The
  // lessons row is owner-scoped under RLS, and image_path (client-written
  // via /api/lesson, which enforces the same prefix) must live under the
  // OWNER's entry folder before it gets signed.
  if (lessonId) {
    const { data: lesson } = await supabase
      .from("lessons")
      .select("id, user_id, image_path")
      .eq("id", lessonId)
      .maybeSingle();
    const loc = parseR2(lesson?.image_path);
    if (
      !lesson ||
      !loc ||
      loc.bucket !== "ponglens-media" ||
      !loc.key.startsWith(`entry/${lesson.user_id}/`) ||
      // A '..' segment would walk the signed key back out of the owner's
      // folder after the prefix check passes.
      loc.key.includes("..")
    ) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
    const url = await presignGet(loc.bucket, loc.key, {
      expiresSeconds: 3600,
      disposition: "inline",
    });
    return NextResponse.json({ url });
  }

  if (tagReel) {
    // Cross-match tag reel (042): the RLS-scoped tag_reels read is the
    // ownership check; the tag label names the download.
    try {
      const { data: reelRow } = await supabase
        .from("tag_reels")
        .select("status, r2_key, tag_id")
        .eq("tag_id", tagReel)
        .maybeSingle();
      if (!reelRow || reelRow.status !== "ready" || !reelRow.r2_key) {
        return NextResponse.json(
          { error: "Export not ready" },
          { status: 409 }
        );
      }
      const { data: tag } = await supabase
        .from("tags")
        .select("label")
        .eq("id", tagReel)
        .maybeSingle();
      const base = ((tag?.label as string | undefined) ?? "tagged points")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, " ");
      const url = await presignGet(MEDIA_BUCKET, reelRow.r2_key, {
        expiresSeconds: 3600,
        disposition: "attachment",
        filename: `${base || "tagged points"} - PongLens.mp4`,
      });
      return NextResponse.json({ url });
    } catch (e) {
      console.error("media-url tag-reel error:", e);
      return NextResponse.json(
        { error: "Could not create a download link. Try again shortly." },
        { status: 500 }
      );
    }
  }

  if (thumbs.length > 0) {
    // Batch poster thumbs. One RLS select covers the whole library page;
    // rows the caller can't read never come back, so no per-id checks.
    try {
      const { data: rows } = await supabase
        .from("matches")
        .select("id, thumb_path")
        .in("id", thumbs);
      // Signed together, not one at a time: see presignGetBatch. Rows with
      // no thumb (or a thumb outside the media bucket) drop out here, so
      // signed[] lines up with targets[] index for index.
      const targets: { id: string; bucket: string; key: string }[] = [];
      for (const row of rows ?? []) {
        const loc = parseR2(row.thumb_path);
        if (!loc || loc.bucket !== MEDIA_BUCKET) continue;
        targets.push({ id: row.id, bucket: loc.bucket, key: loc.key });
      }
      const signed = await presignGetBatch(
        targets.map((t) => ({
          bucket: t.bucket,
          key: t.key,
          opts: { expiresSeconds: 3600, disposition: "inline" as const },
        }))
      );
      const urls: Record<string, string> = {};
      targets.forEach((t, i) => {
        urls[t.id] = signed[i];
      });
      return NextResponse.json({ urls });
    } catch (e) {
      console.error("media-url thumbs error:", e);
      return NextResponse.json(
        { error: "Could not create media links. Try again shortly." },
        { status: 500 }
      );
    }
  }

  if (!matchId) {
    return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
  }

  // RLS select policy == has_match_access(); reading the row is the check.
  const { data: match, error } = await supabase
    .from("matches")
    .select("id, user_id, job_id, opponent_name, cut_path, raw_path, status")
    .eq("id", matchId)
    .single();
  if (error || !match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  try {
    if (noteId) {
      // { image: true } signs the note's annotated-frame image (040);
      // default is the voice audio. Both paths are client-writable text,
      // so each only signs media-bucket keys under the note AUTHOR's own
      // folder for that media type.
      const { data: note } = await supabase
        .from("notes")
        .select("id, author_id, audio_path, image_path")
        .eq("id", noteId)
        .eq("match_id", matchId)
        .single();
      const folder = image ? "sketch" : "voice";
      const loc = parseR2(image ? note?.image_path : note?.audio_path);
      if (
        !note ||
        !loc ||
        loc.bucket !== "ponglens-media" ||
        !loc.key.startsWith(`${folder}/${note.author_id}/`)
      ) {
        return NextResponse.json(
          { error: image ? "Image not found" : "Audio not found" },
          { status: 404 }
        );
      }
      const url = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: 3600,
        disposition: "inline",
      });
      return NextResponse.json({ url });
    }

    if (reel) {
      // Owner only: match_reels' select policy is owner-scoped, so a coach
      // (who can read the match) still gets no row here. scope picks the
      // starred (default) or full-match export row.
      const { data: reelRow } = await supabase
        .from("match_reels")
        .select("status, r2_key")
        .eq("match_id", matchId)
        .eq("scope", scope)
        .maybeSingle();
      if (!reelRow || reelRow.status !== "ready" || !reelRow.r2_key) {
        return NextResponse.json({ error: "Export not ready" }, { status: 409 });
      }
      const base = (match.opponent_name ?? "").trim() || "match";
      let suffix = scope === "full" ? "full match" : "highlights";
      if (scope.startsWith("tag:")) {
        const { data: tag } = await supabase
          .from("tags")
          .select("label")
          .eq("id", scope.slice(4))
          .maybeSingle();
        suffix = (tag?.label as string | undefined) ?? "tagged points";
      }
      // A share render is fetched by the app, not saved by a person: it
      // goes on the pasteboard and is handed to Instagram. Inline, so
      // nothing downstream treats it as a download — unless the caller
      // says download, which is the web's highlight buttons saving the
      // same file to disk.
      const share = scope.startsWith("v:");
      if (share) {
        suffix = scope.startsWith("v:point:") ? "rally" : "highlights";
      }
      const url = await presignGet(MEDIA_BUCKET, reelRow.r2_key, {
        expiresSeconds: 3600,
        filename: `PongLens - ${base} (${suffix}).mp4`,
        disposition: share && !download ? "inline" : "attachment",
      });
      return NextResponse.json({ url });
    }

    if (rawPreview) {
      // The original upload, inline so it streams in a <video>. Serves the
      // raw view of an unprocessed match AND the "Original" pill on a
      // processed one — the file is the same object either way, and
      // r2_raw_sweep never expires it while the library row points at it.
      //
      // raw_path only — deliberately NOT the source job's input_path that
      // the { raw } download below falls back to. raw_path means the
      // retention sweep is protecting the object; input_path only means a
      // job once pointed there, and those files age out on the ordinary
      // 30-day clock. The UI draws its pill from the same column without
      // probing, so widening this to input_path would put a control on
      // matches whose file is already gone. The HEAD below still runs, so
      // a caller that asks anyway gets an honest answer.
      const loc = parseR2(match.raw_path);
      if (!loc || loc.bucket !== RAW_BUCKET) {
        return NextResponse.json({ available: false });
      }
      const size = await headObject(loc.bucket, loc.key);
      if (size === null) {
        return NextResponse.json({ available: false });
      }
      const url = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: 6 * 3600,
        disposition: "inline",
      });
      return NextResponse.json({ url, available: true });
    }

    if (raw) {
      // Original raw upload as a download. raw_path first: it is the
      // retention-protected object (r2_raw_sweep keeps it while the
      // library row exists), and an UNPROCESSED match has no job_id yet.
      // Older rows with a null raw_path fall back to the source job's
      // input_path, which ages out on the 30-day clock. HEAD-check before
      // signing so a gone upload reports { available: false } (the Export
      // sheet hides the row) rather than handing back a link that 404s.
      let loc = parseR2(match.raw_path);
      if ((!loc || loc.bucket !== RAW_BUCKET) && match.job_id) {
        const { data: job } = await supabase
          .from("jobs")
          .select("input_path")
          .eq("id", match.job_id)
          .single();
        loc = parseR2(job?.input_path);
      }
      if (!loc || loc.bucket !== RAW_BUCKET) {
        return NextResponse.json({ available: false });
      }
      const size = await headObject(loc.bucket, loc.key);
      if (size === null) {
        return NextResponse.json({ available: false });
      }
      const base = (match.opponent_name ?? "").trim() || "match";
      const url = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: 3600,
        filename: `PongLens - ${base} (raw).mp4`,
        disposition: "attachment",
      });
      return NextResponse.json({ url, available: true });
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
      // Six hours, like the raw link: this URL is HELD, not clicked. The
      // coach workspace streams a whole review session off one mint, and
      // at an hour the signature died mid-review — the player's error
      // recovery then threw the coach back to 0:00. Recovery now keeps
      // the position, but the link should outlive any real session in
      // the first place.
      const url = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: 6 * 3600,
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
