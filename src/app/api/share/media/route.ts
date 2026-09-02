import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { presignGet } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * GET /api/share/media — short-TTL presigned R2 GET for a share link's
 * video. NO auth: the token IS the credential.
 *
 *   ?token=...              point link   -> its clip
 *                           match link   -> the cut video
 *   ?token=...&pointId=...  match link   -> that point's clip
 *                           starred link -> that clip, but ONLY if the
 *                           point is CURRENTLY starred and visible —
 *                           re-checked at signing time, because starred
 *                           links are live (unstarring kills the clip
 *                           even for a page someone kept open)
 *
 * Resolution goes through the SECURITY DEFINER resolve functions, which
 * return nothing for unknown/revoked tokens — so every failure mode is the
 * same 404 and anon needs no table access. TTL is 15 minutes: long enough
 * to watch a clip, short enough that a revoked link's last-signed URL dies
 * quickly.
 */

const TTL_SECONDS = 15 * 60;

function parseR2(path: string | null | undefined) {
  const m = (path ?? "").match(/^r2:\/\/([^/]+)\/(.+)$/);
  return m ? { bucket: m[1], key: m[2] } : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const pointId = url.searchParams.get("pointId") ?? "";
  if (!token || token.length < 32 || token.length > 128) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: links } = await supabase.rpc("resolve_share_link", {
    p_token: token,
  });
  const link = links?.[0];
  if (!link) {
    // Not a match-family link. A journal entry link (154) resolves through
    // its own function; the only media an entry has is its attached photo.
    // The function is the real gate (155): it returns image_path only when
    // the key sits inside the AUTHOR's own entry/<user_id>/ folder, because
    // image_path is a client-writable column and a forged value must not
    // let one user's link sign another user's photo. The checks here are a
    // second layer: right bucket, entry space, and no '..' segment that
    // could walk the signed key somewhere else after the prefix passes.
    const { data: entries } = await supabase.rpc("resolve_share_entry", {
      p_token: token,
    });
    const entry = entries?.[0];
    const loc = parseR2(entry?.image_path);
    if (
      !entry ||
      !loc ||
      loc.bucket !== "ponglens-media" ||
      !loc.key.startsWith("entry/") ||
      loc.key.includes("..")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    try {
      const signed = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: TTL_SECONDS,
        disposition: "inline",
      });
      return NextResponse.json({ url: signed });
    } catch (e) {
      console.error("share media error:", e);
      return NextResponse.json(
        { error: "Could not create a media link. Try again shortly." },
        { status: 500 }
      );
    }
  }

  try {
    // Point link: only its own clip, ever.
    if (link.kind === "point") {
      const loc = parseR2(link.point_clip_path);
      if (!loc) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const signed = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: TTL_SECONDS,
        disposition: "inline",
      });
      return NextResponse.json({ url: signed });
    }

    // Starred link: a clip request must name a point that is CURRENTLY
    // starred (live semantics — validated right now, not at link time).
    // A starred link has no whole-video fallback: no pointId = 404.
    if (link.kind === "starred") {
      if (!pointId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { data: starred } = await supabase.rpc("resolve_share_starred", {
        p_token: token,
      });
      const point = (starred ?? []).find(
        (p: { id: string }) => p.id === pointId
      );
      const loc = parseR2(point?.clip_path);
      if (!loc) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const signed = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: TTL_SECONDS,
        disposition: "inline",
      });
      return NextResponse.json({ url: signed });
    }

    // Tag link: a clip request must name a point that CURRENTLY carries
    // the link's tag (live semantics, same as starred). No whole-video
    // fallback: no pointId = 404.
    if (link.kind === "tag") {
      if (!pointId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { data: tagged } = await supabase.rpc("resolve_share_tagged", {
        p_token: token,
      });
      const point = (tagged ?? []).find(
        (p: { id: string }) => p.id === pointId
      );
      const loc = parseR2(point?.clip_path);
      if (!loc) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const signed = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: TTL_SECONDS,
        disposition: "inline",
      });
      return NextResponse.json({ url: signed });
    }

    // Match link + pointId: one of the match's visible points.
    if (pointId) {
      const { data: points } = await supabase.rpc("resolve_share_points", {
        p_token: token,
      });
      const point = (points ?? []).find(
        (p: { id: string }) => p.id === pointId
      );
      const loc = parseR2(point?.clip_path);
      if (!loc) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const signed = await presignGet(loc.bucket, loc.key, {
        expiresSeconds: TTL_SECONDS,
        disposition: "inline",
      });
      return NextResponse.json({ url: signed });
    }

    // Match link, no point: the cut video, or — for a match that has not
    // been processed — the original upload (153). Cut first, so the same
    // link upgrades the moment processing finishes.
    const loc = parseR2(link.cut_path) ?? parseR2(link.raw_path);
    if (!loc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const signed = await presignGet(loc.bucket, loc.key, {
      expiresSeconds: TTL_SECONDS,
      disposition: "inline",
    });
    return NextResponse.json({ url: signed });
  } catch (e) {
    console.error("share media error:", e);
    return NextResponse.json(
      { error: "Could not create a media link. Try again shortly." },
      { status: 500 }
    );
  }
}
