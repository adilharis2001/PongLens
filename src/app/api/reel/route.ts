import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sortPoints } from "@/app/match/[id]/gameScore";
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
 * One reel per match (r2 key reels/<matchId>.mp4, overwritten). Freshness:
 * when the stored manifest + show_score match what we just computed and
 * the reel is ready (or already queued/rendering), return that status
 * without re-queueing; otherwise enqueue_reel() re-renders.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;

interface ManifestPoint {
  point_id: string;
  clip_path: string;
  score_you: number;
  score_them: number;
  games_you: number;
  games_them: number;
}

interface Manifest {
  you_name: string;
  them_name: string;
  played_at: string | null;
  points: ManifestPoint[];
}

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
      "id, user_id, opponent_name, player_near_name, player_far_name, user_side, played_at"
    )
    .eq("id", matchId)
    .maybeSingle();
  if (!match || match.user_id !== user.id) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const { data: points } = await supabase
    .from("points")
    .select("*")
    .eq("match_id", matchId)
    .eq("deleted", false);
  const ordered = sortPoints((points ?? []) as Point[]);

  // Running score walk (mirrors computeMatchScore) capturing the state
  // ENTERING each rally; lets and unconfirmed points contribute nothing.
  let you = 0;
  let them = 0;
  let gamesYou = 0;
  let gamesThem = 0;
  let hasScore = false;
  const manifestPoints: ManifestPoint[] = [];
  for (const p of ordered) {
    if (p.starred && p.clip_path) {
      manifestPoints.push({
        point_id: p.id,
        clip_path: p.clip_path,
        score_you: you,
        score_them: them,
        games_you: gamesYou,
        games_them: gamesThem,
      });
    }
    if (p.is_let || !p.confirmed_winner) continue;
    hasScore = true;
    if (p.confirmed_winner === "user") you += 1;
    else them += 1;
    if ((you >= 11 || them >= 11) && Math.abs(you - them) >= 2) {
      if (you > them) gamesYou += 1;
      else gamesThem += 1;
      you = 0;
      them = 0;
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
  // sheet's default title.
  const near = (match.player_near_name ?? "").trim();
  const far = (match.player_far_name ?? "").trim();
  const opp = (match.opponent_name ?? "").trim();
  const userIsFar = match.user_side === "far";
  const youName = (userIsFar ? far : near) || "Player";
  const themName = (userIsFar ? near : far) || opp || "Opponent";

  const manifest: Manifest = {
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
