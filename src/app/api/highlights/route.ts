import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";
import { automaticHighlightsEnabled } from "./access";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ManifestPoint = {
  point_id: string;
  cut_start_s: number;
  cut_end_s: number;
  output_start_s: number;
  output_end_s: number;
  n_hits: number | null;
  connected_crossings: number | null;
  table_bounces: number;
  alternating_table_landings: number | null;
};

type HighlightManifest = {
  v: 2;
  rule: "quality-first-v2";
  max_seconds: number;
  points_revision: string;
  duration_s: number;
  points: ManifestPoint[];
};

function response(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function manifestValue(value: unknown): HighlightManifest | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Partial<HighlightManifest>;
  if (
    manifest.v !== 2 ||
    manifest.rule !== "quality-first-v2" ||
    !Array.isArray(manifest.points) ||
    typeof manifest.points_revision !== "string"
  ) {
    return null;
  }
  return manifest as HighlightManifest;
}

async function selectedPointsAreFresh(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: string,
  manifest: HighlightManifest,
) {
  const ids = manifest.points.map((point) => point.point_id);
  if (!ids.length || ids.some((id) => !UUID_RE.test(id))) return false;
  const { data: rows, error } = await supabase
    .from("points")
    .select(
      "id,t0,cut_t0,rally_end_cut_s,deleted,edited,is_let,highlight_evidence",
    )
    .eq("match_id", matchId)
    .in("id", ids);
  if (error || !rows || rows.length !== ids.length) return false;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return manifest.points.every((point) => {
    const row = byId.get(point.point_id);
    const evidence = row?.highlight_evidence as
      | { v?: number; status?: string; observed_end_s?: number }
      | null
      | undefined;
    const rallyEndCutS =
      typeof row?.rally_end_cut_s === "number"
        ? row.rally_end_cut_s
        : typeof row?.cut_t0 === "number" &&
            typeof row?.t0 === "number" &&
            typeof evidence?.observed_end_s === "number"
          ? row.cut_t0 + evidence.observed_end_s - row.t0
          : null;
    return Boolean(
      row &&
        !row.deleted &&
        !row.edited &&
        !row.is_let &&
        evidence?.v === 2 &&
        evidence.status === "ready" &&
        typeof row.cut_t0 === "number" &&
        typeof rallyEndCutS === "number" &&
        Math.abs(row.cut_t0 - point.cut_start_s) < 0.011 &&
        Math.abs(rallyEndCutS + 0.75 - point.cut_end_s) < 0.011,
    );
  });
}

export async function GET(req: Request) {
  const matchId = new URL(req.url).searchParams.get("matchId") ?? "";
  if (!UUID_RE.test(matchId)) return response({ error: "Invalid match" }, 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return response({ error: "Not signed in" }, 401);

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select("id,user_id,cut_path,status")
    .eq("id", matchId)
    .maybeSingle();
  if (matchError || !match || match.user_id !== user.id) {
    return response({ error: "Match not found" }, 404);
  }

  try {
    const admin = createAdminClient();
    const { data: config } = await admin
      .from("app_config")
      .select("value")
      .eq("key", "automatic_highlights")
      .maybeSingle();
    if (!automaticHighlightsEnabled(config?.value, user.id)) {
      return response({ status: "unavailable" });
    }

    const { data: reel, error: reelError } = await supabase
      .from("match_reels")
      .select("status,r2_key,duration_s,manifest,error")
      .eq("match_id", matchId)
      .eq("scope", "highlights")
      .maybeSingle();
    if (reelError) throw reelError;

    const manifest = manifestValue(reel?.manifest);
    // A v1 terminal row is stale, not an answer. Let it fall through to
    // enqueue so the evidence-v2 rollout recovers matches that were shown
    // as empty under the over-strict intersection rule.
    if (reel?.status === "empty" && manifest) {
      return response({ status: "empty" });
    }
    if (reel?.status === "failed" && manifest) {
      return response({ status: "failed" });
    }
    if (
      (reel?.status === "queued" || reel?.status === "rendering") &&
      manifest
    ) {
      return response({ status: "rendering" });
    }

    if (
      reel?.status === "ready" &&
      reel.r2_key &&
      manifest &&
      reel.r2_key.startsWith(`reels/${matchId}-highlights-`) &&
      reel.r2_key.endsWith(".mp4") &&
      (await selectedPointsAreFresh(supabase, matchId, manifest))
    ) {
      const url = await presignGet(MEDIA_BUCKET, reel.r2_key, {
        expiresSeconds: 6 * 3600,
        disposition: "inline",
      });
      return response({
        status: "ready",
        url,
        durationS: Number(reel.duration_s ?? manifest.duration_s),
        manifest,
      });
    }

    if (!match.cut_path || match.status !== "ready") {
      return response({ status: "unavailable" });
    }
    const emptyManifest = {
      v: 2,
      rule: "quality-first-v2",
      max_seconds: 150,
      points_revision: "",
      duration_s: 0,
      points: [],
    };
    const { error: enqueueError } = await supabase.rpc("enqueue_reel", {
      p_match_id: matchId,
      p_scope: "highlights",
      p_show_score: false,
      p_manifest: emptyManifest,
    });
    if (enqueueError) throw enqueueError;
    return response({ status: "rendering" });
  } catch (error) {
    console.error("automatic highlights route failed", error);
    return response({ status: "failed" });
  }
}
