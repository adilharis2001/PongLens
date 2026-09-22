import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
import {
  canonical,
  manifestSeconds,
  storyNames,
  walkManifestPoints,
  type ManifestPoint,
} from "./manifest";
import { selectionReel } from "./selection";

export const runtime = "nodejs";

/**
 * POST /api/reel — queue (or return) a rendered export for a match. Owner
 * only. Two scopes share this route and the render pipeline:
 *
 *   scope 'starred' (default) — the match's STARRED points, in order.
 *   scope 'full'              — EVERY visible point (with a clip), in order:
 *                               the whole match with the running scorebug.
 *
 *   { matchId, scope?, showScore } -> { status: 'queued' | 'rendering' |
 *                                       'ready', durationS?, sizeBytes? }
 *
 * The manifest is computed HERE, in TS — gameScore.ts logic is the single
 * source of score truth. Each included visible point (with a clip) gets the
 * running match score AT THE START of that rally, from confirmed winners
 * over ALL visible points in timeline order (an export of points 3 and 12
 * shows the real match score entering those rallies, not a subset count).
 * No confirmed winners at all -> showScore is forced off. The score walk is
 * identical across scopes; only which points land in the manifest differs.
 *
 * Manifest v2 (worker renders from the full-res CUT video, not the 720p
 * preview clips): each point also carries its cut-timeline segment.
 * points.cut_t0 is anchored on the padded clip start (t0 minus the
 * point's EFFECTIVE pre pad — full strictness pre from points_pipeline.py,
 * TIGHT_PAD on split-born tight_start points), so the segment covering
 * exactly what the preview clip shows is
 * [cut_t0, cut_t0 + (t1 - t0) + effPre + effPost]; the worker clamps
 * seg_end against the cut video's real duration. Points without cut_t0
 * (pre-011 matches) get null bounds and the worker falls back to their
 * preview clip. games_detail is the list
 * of completed games' point pairs entering the rally ([[11,9],...]) for
 * the broadcast-table scorebug.
 *
 * One row per (match, scope) in match_reels (r2 keys reels/<matchId>.mp4
 * for starred, reels/<matchId>-full.mp4 for full, each overwritten).
 * Freshness: when the stored manifest + show_score for THIS scope match
 * what we just computed and the row is ready (or already queued/rendering),
 * return that status without re-queueing; otherwise enqueue_reel() re-
 * renders. The version bump means every pre-v2 reel compares stale and
 * re-renders (at the new quality) on the next request.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;
const MANIFEST_VERSION = 2;

/**
 * Instagram takes 60 seconds in a Reel and 20 in a Story (135). The Story
 * cap is enforced on the phone, which knows the rally length before it asks
 * for anything and can say so without a round trip. This is the backstop:
 * nothing over a minute is worth rendering vertically, because no Instagram
 * surface reachable through the share handover will accept it.
 */
const VERTICAL_MAX_S = 60;
const HIGHLIGHT_CEILINGS_S = { story: 20, reel: 60, long: 150 } as const;
type HighlightKind = keyof typeof HIGHLIGHT_CEILINGS_S;

type CanonicalHighlightPoint = {
  point_id: string;
  cut_start_s: number;
  cut_end_s: number;
  n_hits: number | null;
  connected_crossings: number | null;
  table_bounces: number;
  alternating_table_landings: number | null;
};

function canonicalHighlightPoints(value: unknown): CanonicalHighlightPoint[] | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Record<string, unknown>;
  if (
    manifest.v !== 2 ||
    manifest.rule !== "quality-first-v2" ||
    !Array.isArray(manifest.points)
  ) {
    return null;
  }
  const points = manifest.points as CanonicalHighlightPoint[];
  return points.every(
    (point) =>
      typeof point.point_id === "string" &&
      Number.isFinite(point.cut_start_s) &&
      Number.isFinite(point.cut_end_s) &&
      point.cut_end_s > point.cut_start_s &&
      (point.n_hits === null || Number.isFinite(point.n_hits)) &&
      (point.connected_crossings === null ||
        Number.isFinite(point.connected_crossings)) &&
      Number.isFinite(point.table_bounces) &&
      (point.alternating_table_landings === null ||
        Number.isFinite(point.alternating_table_landings)),
  )
    ? points
    : null;
}

/** Build a shorter derivative from the worker's already-qualified pool. */
function fitQualifiedHighlights(
  points: CanonicalHighlightPoint[],
  ceilingS: number,
): CanonicalHighlightPoint[] {
  let usedS = 0;
  return points
    .map((point, timelineIndex) => ({ point, timelineIndex }))
    .sort((a, b) => {
      const aCrossings = a.point.connected_crossings ?? 0;
      const bCrossings = b.point.connected_crossings ?? 0;
      const aLandings = a.point.alternating_table_landings ?? 0;
      const bLandings = b.point.alternating_table_landings ?? 0;
      const aHits =
        aCrossings >= 2 || aLandings >= 3 ? (a.point.n_hits ?? 0) : 0;
      const bHits =
        bCrossings >= 2 || bLandings >= 3 ? (b.point.n_hits ?? 0) : 0;
      const aExchanges = Math.max(aCrossings, aLandings, aHits);
      const bExchanges = Math.max(bCrossings, bLandings, bHits);
      return (
        bExchanges - aExchanges ||
        bCrossings - aCrossings ||
        bLandings - aLandings ||
        b.point.table_bounces - a.point.table_bounces ||
        a.timelineIndex - b.timelineIndex
      );
    })
    .filter(({ point }) => {
      const durationS = point.cut_end_s - point.cut_start_s;
      if (usedS + durationS > ceilingS + 0.001) return false;
      usedS += durationS;
      return true;
    })
    .sort((a, b) => a.timelineIndex - b.timelineIndex)
    .map(({ point }) => point);
}

interface Manifest {
  version: number;
  /** 'story' = the 9:16 canvas a share hands to Instagram (135). Absent on
   *  every export rendered before it existed, which the worker reads as
   *  landscape — so old stored manifests still compare equal and are not
   *  re-rendered just because this key was added. */
  format?: "story";
  /** Vertical only: whether the name band is drawn. Lives in the manifest
   *  rather than a column so the freshness check re-renders on a change of
   *  mind for free. Absent = true, matching every render before it. */
  show_names?: boolean;
  /** Vertical only: whether the PongLens mark is drawn under the picture.
   *  Same contract as show_names — absent = true. */
  show_logo?: boolean;
  you_name: string;
  them_name: string;
  played_at: string | null;
  points: ManifestPoint[];
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
  let showScore: boolean;
  let showNames: boolean;
  let showLogo: boolean;
  let scope: string;
  let tagId: string;
  let pointId: string;
  let highlight: string;
  try {
    const body = await req.json();
    // Starred points picked from any number of matches (2026-09-22): its
    // own manifest and table, the same canvas and switches.
    if (Array.isArray(body.pointIds)) {
      return await selectionReel(supabase, user, body);
    }
    matchId = String(body.matchId ?? "");
    showScore = body.showScore !== false; // default on
    showNames = body.showNames !== false; // default on
    showLogo = body.showLogo !== false; // default on
    tagId = String(body.tagId ?? "");
    // A pointId asks for the vertical single-rally render a Share to
    // Instagram hands over (135). It outranks the other selectors: there
    // is exactly one point in the manifest and the canvas is 9:16.
    pointId = String(body.pointId ?? "");
    // highlight 'story' | 'reel' | 'long' asks for the AUTOMATIC picks —
    // the picker in highlights.ts chooses the rallies, the caller only
    // names the time budget. Same canvas and pipeline as every vertical.
    highlight = String(body.highlight ?? "");
    // scope 'tag:<uuid>' (036) selects the points carrying that tag; the
    // rest of the pipeline is scope-agnostic (the manifest lists the
    // points, the worker renders the manifest).
    // vertical: true with the default starred scope asks for the 9:16
    // stitched highlights a share hands to Instagram as a Reel — the same
    // canvas as a single-point story, one segment per starred rally.
    scope = pointId
      ? `v:point:${pointId}`
      : highlight
        ? `v:hl:${highlight}`
        : tagId
          ? `tag:${tagId}`
          : body.scope === "full"
            ? "full"
            : body.vertical === true
              ? "v:starred"
              : "starred"; // default starred
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    !UUID_RE.test(matchId) ||
    (tagId && !UUID_RE.test(tagId)) ||
    (pointId && !UUID_RE.test(pointId)) ||
    (highlight && !(highlight in HIGHLIGHT_CEILINGS_S))
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const hlKind = (highlight || null) as HighlightKind | null;
  const vertical =
    Boolean(pointId) || scope === "v:starred" || hlKind !== null;

  // The switch shipped in 136. Reading it here covers every caller —
  // including a phone whose own config read failed open — and failing OPEN
  // on an unreadable row is deliberate: a config outage should slow nobody's
  // share, it is the 'off' value that must always be obeyed.
  if (vertical) {
    const { data: gate } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "instagram_sharing")
      .maybeSingle();
    if (gate?.value === "off") {
      return NextResponse.json(
        { error: "Sharing to Instagram is off right now.", code: "sharing_off" },
        { status: 403 }
      );
    }
  }

  // Strict ownership (like /api/share): only the owner publishes media.
  const { data: match } = await supabase
    .from("matches")
    .select(
      "id, user_id, job_id, opponent_name, player_near_name, player_far_name, user_side, played_at, clip_pads"
    )
    .eq("id", matchId)
    .maybeSingle();
  if (!match || match.user_id !== user.id) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // Cut strictness of the source job — the segment bounds must use the
  // same context padding the preview clips were cut with (clipEdit.ts).
  let strictness = "normal";
  if (match.job_id) {
    const { data: job } = await supabase
      .from("jobs")
      .select("options")
      .eq("id", match.job_id)
      .maybeSingle();
    const s = (job?.options as { strictness?: string } | null)?.strictness;
    if (s) strictness = s;
  }
  const pad = clipPad(
    strictness,
    (match as { clip_pads?: { pre: number; post: number } | null }).clip_pads
  );

  const { data: points } = await supabase
    .from("points")
    .select("*")
    .eq("match_id", matchId)
    .eq("deleted", false);
  const ordered = sortPoints((points ?? []) as Point[]);

  // Which endings trim a point: the winner tap plus half a second (138),
  // and on an unscored point the observed rally end plus its buffer (143).
  // The SAME object must reach the picker and the segment math below, and
  // it is what the players and the Tools row read — one set of flags,
  // every surface, or the row promises one cut and the render delivers
  // another.
  const ends: EndOptions = {
    tapEnd: await getTapEndPlayback(),
    rallyEnd: {
      on: await getUnscoredRallyEnd(),
      bufferS: await getUnscoredRallyEndBufferS(),
      tightBufferS: await getUnscoredRallyEndTightBufferS(),
    },
  };

  // Automatic highlights are worker-authoritative. Older clients can still
  // ask for shorter vertical derivatives, but their pool comes only from
  // the canonical continuous highlight manifest.
  const hlIds = new Set<string>();
  const hlBounds = new Map<string, CanonicalHighlightPoint>();
  if (hlKind) {
    const { data: automatic } = await supabase
      .from("match_reels")
      .select("status,manifest")
      .eq("match_id", matchId)
      .eq("scope", "highlights")
      .maybeSingle();
    const qualified = canonicalHighlightPoints(automatic?.manifest);
    if (automatic?.status !== "ready" || !qualified) {
      return NextResponse.json(
        {
          error: "Highlights are still being prepared. Try again shortly.",
          code: "highlights_not_ready",
        },
        { status: 409 },
      );
    }
    for (const point of fitQualifiedHighlights(
      qualified,
      HIGHLIGHT_CEILINGS_S[hlKind],
    )) {
      hlIds.add(point.point_id);
      hlBounds.set(point.point_id, point);
    }
  }

  // Tag scope: the tag must be the owner's (tags are owner-keyed), and the
  // included set is the points currently carrying it. enqueue_reel()
  // re-checks tag ownership server-side.
  const taggedIds = new Set<string>();
  if (tagId) {
    const { data: tag } = await supabase
      .from("tags")
      .select("id, owner_id")
      .eq("id", tagId)
      .maybeSingle();
    if (!tag || tag.owner_id !== user.id) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }
    const { data: taggedRows } = await supabase
      .from("point_tags")
      .select("point_id")
      .eq("tag_id", tagId);
    for (const r of taggedRows ?? []) taggedIds.add(String(r.point_id));
  }

  // The score walk and the cut windows (manifest.ts). scope 'full' takes
  // every visible point with a clip; 'starred' only the starred ones; a tag
  // scope only the points carrying the tag. The walk runs over ALL points
  // either way, so the running score entering each rally is identical.
  const { points: manifestPoints, hasScore } = walkManifestPoints(
    ordered,
    (p) =>
      pointId
        ? p.id === pointId
        : hlKind
          ? hlIds.has(p.id)
          : scope === "full"
            ? true
            : tagId
              ? taggedIds.has(p.id)
              : p.starred,
    pad,
    ends,
    hlBounds,
  );
  if (manifestPoints.length === 0) {
    return NextResponse.json(
      {
        error: pointId
          ? "This rally has no video to share."
          : hlKind === "story"
            ? "Every rally here runs past Instagram's 20-second Story cap."
            : hlKind
              ? "This match has no playable clips yet."
              : scope === "full"
                ? "This match has no playable clips yet."
                : tagId
                  ? "Tag at least one point first."
                  : "Star at least one point first.",
      },
      { status: 400 }
    );
  }
  // Nothing Instagram will accept runs past a minute through the share
  // handover, so refuse here rather than spend a render on a file the
  // phone would have to throw away.
  if (vertical) {
    // Highlight scopes carry their own ceiling (the picker already fills
    // to it; this is the backstop). Everything else keeps the Reel cap.
    const capS = hlKind ? HIGHLIGHT_CEILINGS_S[hlKind] : VERTICAL_MAX_S;
    const seconds = manifestSeconds(manifestPoints);
    if (seconds > capS + 0.5) {
      return NextResponse.json(
        {
          error: pointId
            ? `That rally runs ${Math.round(seconds)} seconds. Instagram takes up to ${VERTICAL_MAX_S}.`
            : hlKind
              ? "Couldn't fit the highlights. Try again."
              : `Your starred rallies run ${Math.round(seconds)} seconds together. Instagram takes up to ${VERTICAL_MAX_S}.`,
          code: "too_long",
        },
        { status: 400 }
      );
    }
  }
  const show = hasScore && showScore; // no score data -> force off

  const { you: youName, them: themName } = storyNames(
    match,
    user.user_metadata,
  );

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    // Only ever set for a vertical render, so a landscape export's stored
    // manifest keeps the exact shape it had before 135 and its freshness
    // check still passes.
    ...(vertical
      ? {
          format: "story" as const,
          show_names: showNames,
          show_logo: showLogo,
        }
      : {}),
    you_name: youName,
    them_name: themName,
    played_at: match.played_at ?? null,
    points: manifestPoints,
  };

  // Freshness check: same manifest + score toggle already rendered (or in
  // flight) -> no re-queue.
  const { data: existing } = await supabase
    .from("match_reels")
    .select("status, show_score, manifest, duration_s, size_bytes")
    .eq("match_id", matchId)
    .eq("scope", scope)
    .maybeSingle();
  if (
    existing &&
    existing.show_score === show &&
    canonical(existing.manifest) === canonical(manifest)
  ) {
    if (existing.status === "ready") {
      return NextResponse.json({
        status: "ready",
        durationS: existing.duration_s !== null ? Number(existing.duration_s) : null,
        sizeBytes: existing.size_bytes,
      });
    }
    if (existing.status === "queued" || existing.status === "rendering") {
      return NextResponse.json({ status: existing.status });
    }
    // failed with identical inputs: fall through and retry
  }

  const { error } = await supabase.rpc("enqueue_reel", {
    p_match_id: matchId,
    p_scope: scope,
    p_show_score: show,
    p_manifest: manifest,
  });
  if (error) {
    console.error("enqueue_reel error:", error);
    return NextResponse.json(
      { error: "Couldn't queue the video. Try again." },
      { status: 500 }
    );
  }
  return NextResponse.json({ status: "queued" });
}
