import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createBoundaryWalk,
  sortPoints,
  stepBoundaryWalk,
} from "@/app/match/[id]/gameScore";
import { clipPad, effectivePad } from "@/app/match/[id]/clipEdit";
import type { Point } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/reel — queue (or return) the rendered highlight reel for a
 * match's starred points. Owner only.
 *
 *   { matchId, showScore } -> { status: 'queued' | 'rendering' | 'ready',
 *                               durationS?, sizeBytes? }
 *
 * The manifest is computed HERE, in TS — gameScore.ts logic is the single
 * source of score truth. Each starred visible point (with a clip) gets the
 * running match score AT THE START of that rally, from confirmed winners
 * over ALL visible points in timeline order (a reel of points 3 and 12
 * shows the real match score entering those rallies, not a starred-only
 * count). No confirmed winners at all -> showScore is forced off.
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
 * One reel per match (r2 key reels/<matchId>.mp4, overwritten). Freshness:
 * when the stored manifest + show_score match what we just computed and
 * the reel is ready (or already queued/rendering), return that status
 * without re-queueing; otherwise enqueue_reel() re-renders. The version
 * bump means every pre-v2 reel compares stale and re-renders (at the new
 * quality) on the next request.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;
const MANIFEST_VERSION = 2;

interface ManifestPoint {
  point_id: string;
  clip_path: string;
  /** cut-timeline bounds (seconds); null when cut_t0/t0/t1 are unknown */
  seg_start: number | null;
  seg_end: number | null;
  score_you: number;
  score_them: number;
  games_you: number;
  games_them: number;
  /** completed games entering this rally: [[you, them], ...] */
  games_detail: [number, number][];
}

interface Manifest {
  version: number;
  you_name: string;
  them_name: string;
  played_at: string | null;
  points: ManifestPoint[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Deterministic stringify (sorted keys) so a jsonb round-trip through
 * Postgres — which re-orders object keys — still compares equal. */
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

  let matchId: string;
  let showScore: boolean;
  try {
    const body = await req.json();
    matchId = String(body.matchId ?? "");
    showScore = body.showScore !== false; // default on
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!UUID_RE.test(matchId)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Strict ownership (like /api/share): only the owner publishes media.
  const { data: match } = await supabase
    .from("matches")
    .select(
      "id, user_id, job_id, opponent_name, player_near_name, player_far_name, user_side, played_at"
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
  const pad = clipPad(strictness);

  const { data: points } = await supabase
    .from("points")
    .select("*")
    .eq("match_id", matchId)
    .eq("deleted", false);
  const ordered = sortPoints((points ?? []) as Point[]);

  // Running score walk capturing the state ENTERING each rally; lets and
  // unconfirmed points contribute nothing. Game boundaries come from
  // gameScore.ts stepBoundaryWalk — the SAME walk computeMatchScore and
  // serving.ts use (11-with-2-clear plus the owner's game_end_override
  // end/continue pins), so the reel scorebug always splits games exactly
  // where the match page does.
  const walk = createBoundaryWalk();
  let gamesYou = 0;
  let gamesThem = 0;
  let hasScore = false;
  const gamesDetail: [number, number][] = [];
  const manifestPoints: ManifestPoint[] = [];
  for (const p of ordered) {
    if (p.starred && p.clip_path) {
      // Cut-timeline segment covering the same content as the preview
      // clip: cut_t0 is the padded clip start, so the span is the rally
      // length plus both context pads. Split-boundary edges use the tight
      // pad (effectivePad) so the reel segment matches the reclipped
      // preview clip instead of running into the sibling's rally — BOTH
      // edges: split-born points now get a cut_t0 anchored on
      // t0 - TIGHT_PAD (split_point RPC / migration 023), so a full pre
      // here would overshoot the child's clip span by pre - 0.3.
      let segStart: number | null = null;
      let segEnd: number | null = null;
      if (p.cut_t0 !== null && p.t0 !== null && p.t1 !== null) {
        const eff = effectivePad(pad, p.tight_start, p.tight_end);
        segStart = round2(Math.max(0, Number(p.cut_t0)));
        segEnd = round2(
          Number(p.cut_t0) +
            (Number(p.t1) - Number(p.t0)) +
            eff.pre +
            eff.post
        );
      }
      manifestPoints.push({
        point_id: p.id,
        clip_path: p.clip_path,
        seg_start: segStart,
        seg_end: segEnd,
        score_you: walk.you,
        score_them: walk.them,
        games_you: gamesYou,
        games_them: gamesThem,
        games_detail: gamesDetail.map((g) => [g[0], g[1]]),
      });
    }
    if (p.is_let || !p.confirmed_winner) continue;
    hasScore = true;
    const ended = stepBoundaryWalk(
      walk,
      p.confirmed_winner,
      p.game_end_override ?? null
    );
    if (ended) {
      if (ended.you > ended.them) gamesYou += 1;
      else gamesThem += 1;
      gamesDetail.push([ended.you, ended.them]);
    }
  }
  if (manifestPoints.length === 0) {
    return NextResponse.json(
      { error: "Star at least one point first." },
      { status: 400 }
    );
  }
  const show = hasScore && showScore; // no score data -> force off

  // Title-card names: owner first (their tagged side), like the share
  // sheet's default title. The owner's name falls back to their account
  // first name (Google auth) before the generic "Player" — the app never
  // needs to ask the owner for their own name.
  const accountFullName =
    ((user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      "").trim();
  const accountName = accountFullName.split(/\s+/)[0] || "";
  const near = (match.player_near_name ?? "").trim();
  const far = (match.player_far_name ?? "").trim();
  const opp = (match.opponent_name ?? "").trim();
  const userIsFar = match.user_side === "far";
  const youName = (userIsFar ? far : near) || accountName || "Player";
  const themName = (userIsFar ? near : far) || opp || "Opponent";

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
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
