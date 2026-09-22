import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { sortPoints } from "@/app/match/[id]/gameScore";
import { clipPad } from "@/app/match/[id]/clipEdit";
import type { EndOptions } from "@/app/match/[id]/playhead";
import {
  getTapEndPlayback,
  getUnscoredRallyEnd,
  getUnscoredRallyEndBufferS,
  getUnscoredRallyEndTightBufferS,
} from "@/lib/config";
import type { Point } from "@/lib/types";
import { canonical, manifestSeconds, storyNames, walkManifestPoints } from "./manifest";
import {
  SELECTION_VIDEO_MAX_POINTS,
  selectionPointIds,
  selectionVideoCapS,
  selectionVideoTooLong,
} from "@/lib/starredSelection";

/**
 * POST /api/reel { pointIds, purpose, showScore, showNames, showLogo } —
 * starred points picked from any number of matches, as ONE 9:16 video
 * (2026-09-22; docs/superpowers/specs/2026-09-22-starred-points-selection-design.md).
 *
 * Each match's rallies are built by walkManifestPoints, the same walk a
 * match's own starred highlights use, so a rally carries the score its
 * match was at entering it, under that match's names. The worker renders
 * each rally the way a single-rally share is rendered and crossfades them.
 *
 * purpose 'instagram' holds the whole thing to Instagram's 60 seconds;
 * 'save' allows three minutes. The render is the same file either way,
 * which is why the purpose is not part of the manifest: a video saved at
 * 45 seconds is already the Reel.
 *
 * One row per account (selection_reels). Same freshness rule as /api/reel:
 * an identical manifest already queued, rendering or ready is reported, not
 * re-queued, except that a request that has sat queued or rendering for
 * ten minutes is queued again, because nothing else will ever finish it.
 */

const STALE_MS = 10 * 60 * 1000;

type SelectionBody = {
  pointIds?: unknown;
  purpose?: unknown;
  showScore?: unknown;
  showNames?: unknown;
  showLogo?: unknown;
};

export async function selectionReel(
  supabase: SupabaseClient,
  user: User,
  body: SelectionBody,
) {
  const ids = selectionPointIds(body.pointIds, SELECTION_VIDEO_MAX_POINTS);
  if (!ids) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const purpose = body.purpose === "save" ? "save" : "instagram";
  const showScore = body.showScore !== false;
  const showNames = body.showNames !== false;
  const showLogo = body.showLogo !== false;

  const { data: gate } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "instagram_sharing")
    .maybeSingle();
  if (gate?.value === "off") {
    return NextResponse.json(
      { error: "Sharing videos is off right now.", code: "sharing_off" },
      { status: 403 },
    );
  }

  // Which matches, and are they the caller's. The points read is RLS-scoped,
  // which a coach passes for a shared match, so ownership is checked on the
  // match row explicitly: only the owner publishes.
  const { data: picked } = await supabase
    .from("points")
    .select("id, match_id")
    .in("id", ids);
  const matchOf = new Map(
    (picked ?? []).map((r) => [String(r.id), String(r.match_id)]),
  );
  const matchIds = [...new Set(ids.map((id) => matchOf.get(id)).filter(Boolean))] as string[];
  const { data: matchRows } = matchIds.length
    ? await supabase
        .from("matches")
        .select(
          "id, user_id, job_id, opponent_name, player_near_name, player_far_name, user_side, clip_pads",
        )
        .in("id", matchIds)
    : { data: [] };
  const matches = new Map(
    (matchRows ?? [])
      .filter((m) => m.user_id === user.id)
      .map((m) => [String(m.id), m]),
  );
  if (ids.some((id) => !matches.has(matchOf.get(id) ?? ""))) {
    return NextResponse.json({ error: "Point not found" }, { status: 404 });
  }

  const ends: EndOptions = {
    tapEnd: await getTapEndPlayback(),
    rallyEnd: {
      on: await getUnscoredRallyEnd(),
      bufferS: await getUnscoredRallyEndBufferS(),
      tightBufferS: await getUnscoredRallyEndTightBufferS(),
    },
  };

  // Each match's own pads (the job's strictness, then the owner's override).
  const jobIds = [...matches.values()]
    .map((m) => m.job_id)
    .filter(Boolean) as string[];
  const { data: jobs } = jobIds.length
    ? await supabase.from("jobs").select("id, options").in("id", jobIds)
    : { data: [] };
  const strictnessOf = new Map(
    (jobs ?? []).map((j) => [
      String(j.id),
      (j.options as { strictness?: string } | null)?.strictness ?? "normal",
    ]),
  );

  const wanted = new Set(ids);
  const byPoint = new Map<string, ReturnType<typeof walkManifestPoints>["points"][number]>();
  const describe: Record<
    string,
    { you_name: string; them_name: string; show_score: boolean }
  > = {};
  for (const [matchId, match] of matches) {
    const { data: rows } = await supabase
      .from("points")
      .select("*")
      .eq("match_id", matchId)
      .eq("deleted", false);
    const pad = clipPad(
      (match.job_id && strictnessOf.get(String(match.job_id))) || "normal",
      (match as { clip_pads?: { pre: number; post: number } | null }).clip_pads,
    );
    const walked = walkManifestPoints(
      sortPoints((rows ?? []) as Point[]),
      (p) => wanted.has(p.id),
      pad,
      ends,
    );
    for (const p of walked.points) byPoint.set(p.point_id, p);
    const names = storyNames(match, user.user_metadata);
    describe[matchId] = {
      you_name: names.you,
      them_name: names.them,
      // No confirmed winner anywhere in that match: nothing to print, and
      // 0-0 over a rally that was really 8-6 would be worse than nothing.
      show_score: walked.hasScore && showScore,
    };
  }

  // In the order picked. A point with no playable clip drops out here, the
  // way a clipless point drops out of a match's own highlights.
  const points = ids
    .map((id) => {
      const p = byPoint.get(id);
      return p ? { ...p, match_id: matchOf.get(id) as string } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  if (points.length === 0) {
    return NextResponse.json(
      { error: "These points have no video to share yet." },
      { status: 400 },
    );
  }

  const seconds = manifestSeconds(points);
  if (selectionVideoTooLong(seconds, purpose)) {
    return NextResponse.json(
      {
        error:
          purpose === "instagram"
            ? `These points run ${Math.round(seconds)} seconds together. Instagram takes up to 60.`
            : `These points run ${Math.round(seconds)} seconds together. A video can be up to ${Math.round(selectionVideoCapS("save") / 60)} minutes.`,
        code: "too_long",
      },
      { status: 400 },
    );
  }

  // Only the matches the surviving points come from.
  const used = new Set(points.map((p) => p.match_id));
  const manifest = {
    version: 1,
    format: "story" as const,
    show_names: showNames,
    show_logo: showLogo,
    points,
    matches: Object.fromEntries(
      Object.entries(describe).filter(([id]) => used.has(id)),
    ),
  };

  const { data: existing } = await supabase
    .from("selection_reels")
    .select("status, manifest, duration_s, size_bytes, updated_at")
    .eq("user_id", user.id)
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
    const stale =
      Date.now() - new Date(existing.updated_at as string).getTime() > STALE_MS;
    if (
      (existing.status === "queued" || existing.status === "rendering") &&
      !stale
    ) {
      return NextResponse.json({ status: existing.status });
    }
    // failed, or stuck: fall through and queue it again
  }

  const { error } = await supabase.rpc("enqueue_selection_reel", {
    p_manifest: manifest,
  });
  if (error) {
    if (error.message?.includes("render_queue_full")) {
      return NextResponse.json(
        { error: "Something else is still rendering. Try again shortly." },
        { status: 429 },
      );
    }
    console.error("enqueue_selection_reel error:", error);
    return NextResponse.json(
      { error: "Couldn't queue the video. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ status: "queued" });
}
