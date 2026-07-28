import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sortPoints } from "@/app/match/[id]/gameScore";
import type { Point } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/tag-reel — queue (or return) the cross-match reel for a tag:
 * every point carrying the tag, across every match, in match-date order.
 *
 *   { tagId } -> { status: 'queued' | 'rendering' | 'ready',
 *                  durationS?, sizeBytes? }
 *
 * The manifest lists each point's preview clip with null cut-timeline
 * bounds — the clips span many matches, so there is no single cut video
 * to slice — and no scorebug (a running score across matches would be
 * incoherent). The title card carries the tag label instead of
 * 'you vs them'. Same freshness rule as /api/reel: identical manifest
 * already queued/rendering/ready -> report that status, no re-render.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_POINTS = 200;

/** Deterministic stringify (sorted keys) — see /api/reel. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let tagId: string;
  try {
    const body = await req.json();
    tagId = String(body.tagId ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!UUID_RE.test(tagId)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Owner-keyed: the RLS-scoped read is the ownership check.
  const { data: tag } = await supabase
    .from("tags")
    .select("id, owner_id, label")
    .eq("id", tagId)
    .maybeSingle();
  if (!tag || tag.owner_id !== user.id) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }

  const { data: taggedRows } = await supabase
    .from("point_tags")
    .select("point_id")
    .eq("tag_id", tagId);
  const pointIds = (taggedRows ?? []).map((r) => String(r.point_id));
  if (pointIds.length === 0) {
    return NextResponse.json(
      { error: "Tag at least one point first." },
      { status: 400 }
    );
  }

  const { data: pointRows } = await supabase
    .from("points")
    .select("id, match_id, idx, t0, t1, clip_path, is_let, confirmed_winner, game_end_override")
    .in("id", pointIds.slice(0, 500))
    .eq("deleted", false)
    .not("clip_path", "is", null);
  const points = (pointRows ?? []) as Point[];
  if (points.length === 0) {
    return NextResponse.json(
      { error: "None of the tagged points have playable clips." },
      { status: 400 }
    );
  }

  // Match-date order, then timeline order within each match — the reel
  // reads as the journey of this tag through the season.
  const matchIds = [...new Set(points.map((p) => p.match_id))];
  const { data: matchRows } = await supabase
    .from("matches")
    .select("id, user_id, played_at")
    .in("id", matchIds);
  const owned = new Map(
    (matchRows ?? [])
      .filter((m) => m.user_id === user.id)
      .map((m) => [m.id, m.played_at as string])
  );
  const ordered = matchIds
    .filter((id) => owned.has(id))
    .sort((a, b) => (owned.get(a) ?? "").localeCompare(owned.get(b) ?? ""))
    .flatMap((id) => sortPoints(points.filter((p) => p.match_id === id)))
    .slice(0, MAX_POINTS);
  if (ordered.length === 0) {
    return NextResponse.json(
      { error: "None of the tagged points have playable clips." },
      { status: 400 }
    );
  }

  const label = (tag.label as string).trim();
  const manifest = {
    version: 2,
    you_name: "",
    them_name: "",
    played_at: null,
    title: label,
    subtitle: `${ordered.length} point${ordered.length === 1 ? "" : "s"} · ${
      owned.size
    } match${owned.size === 1 ? "" : "es"}`,
    points: ordered.map((p) => ({
      point_id: p.id,
      clip_path: p.clip_path as string,
      seg_start: null,
      seg_end: null,
      score_you: 0,
      score_them: 0,
      games_you: 0,
      games_them: 0,
      games_detail: [] as [number, number][],
    })),
  };

  const { data: existing } = await supabase
    .from("tag_reels")
    .select("status, manifest, duration_s, size_bytes")
    .eq("tag_id", tagId)
    .maybeSingle();
  if (existing && canonical(existing.manifest) === canonical(manifest)) {
    if (existing.status === "ready") {
      return NextResponse.json({
        status: "ready",
        durationS:
          existing.duration_s !== null ? Number(existing.duration_s) : null,
        sizeBytes: existing.size_bytes,
      });
    }
    if (existing.status === "queued" || existing.status === "rendering") {
      return NextResponse.json({ status: existing.status });
    }
    // failed with identical inputs: fall through and retry
  }

  const { error } = await supabase.rpc("enqueue_tag_reel", {
    p_tag_id: tagId,
    p_manifest: manifest,
  });
  if (error) {
    console.error("enqueue_tag_reel error:", error);
    return NextResponse.json(
      { error: "Couldn't queue the video. Try again." },
      { status: 500 }
    );
  }
  return NextResponse.json({ status: "queued" });
}
