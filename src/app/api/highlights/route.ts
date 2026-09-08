import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";
import { automaticHighlightsEnabled } from "./access";
import { highlightShareMediaKey } from "../share/highlightShare";
import {
  automaticHighlightEvidenceRefreshNeeded,
  automaticHighlightReadDecision,
  automaticHighlightRequestDecision,
  highlightManifestIsFresh,
  type AutomaticHighlightRevisionPoint,
} from "./endPolicy";

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

async function loadPoints(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: string,
): Promise<AutomaticHighlightRevisionPoint[] | null> {
  const { data: rows, error } = await supabase
    .from("points")
    .select(
      "id,idx,t0,t1,cut_t0,scored_at_cut_s,rally_end_cut_s,clip_path,deleted,edited,is_let,highlight_evidence",
    )
    .eq("match_id", matchId);
  if (error || !rows) return null;
  return rows.map((row) => ({
    ...row,
    highlight_evidence: row.highlight_evidence as
      | {
          v?: number | null;
          status?: string | null;
          n_hits?: number | null;
          connected_crossings?: number | null;
          alternating_table_landings?: number | null;
          table_bounces?: number | null;
          observed_end_s?: number | null;
          end_source?: string | null;
        }
      | null,
  })) as AutomaticHighlightRevisionPoint[];
}

function initialManifest(refreshEvidence = false) {
  return {
    v: 2,
    rule: "quality-first-v2",
    max_seconds: 150,
    points_revision: "",
    duration_s: 0,
    points: [],
    ...(refreshEvidence ? { refresh_evidence: true } : {}),
  };
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
    const points = await loadPoints(supabase, matchId);
    if (!points) throw new Error("automatic highlights points unavailable");
    const manifestFresh = Boolean(
      manifest && highlightManifestIsFresh(points, manifest),
    );
    const decision = automaticHighlightReadDecision({
      hasReel: Boolean(reel),
      reelStatus: reel?.status ?? null,
      manifestFresh,
      pointsUpdating: points.some((point) => !point.deleted && point.edited),
    });

    if (decision.status === "ready") {
      if (
        !reel?.r2_key ||
        !manifest ||
        !highlightShareMediaKey(matchId, { match_id: matchId, r2_key: reel.r2_key })
      ) {
        return response({ status: "needs_update" });
      }
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

    if (
      decision.status === "needs_generation" &&
      (!match.cut_path || match.status !== "ready")
    ) {
      return response({ status: "unavailable" });
    }
    return response({ status: decision.status });
  } catch (error) {
    console.error("automatic highlights route failed", error);
    return response({ status: "failed" });
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return response({ code: "not_authenticated" }, 401);

  let matchId = "";
  try {
    const body = await req.json();
    matchId = String(body.matchId ?? "");
  } catch {
    return response({ code: "invalid_json" }, 400);
  }
  if (!UUID_RE.test(matchId)) {
    return response({ code: "invalid_match_id" }, 400);
  }

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select("id,user_id,cut_path,status")
    .eq("id", matchId)
    .maybeSingle();
  if (matchError || !match || match.user_id !== user.id) {
    return response({ code: "match_not_found" }, 404);
  }
  if (!match.cut_path || match.status !== "ready") {
    return response({ code: "highlights_unavailable" }, 409);
  }

  try {
    const admin = createAdminClient();
    const { data: config } = await admin
      .from("app_config")
      .select("value")
      .eq("key", "automatic_highlights")
      .maybeSingle();
    if (!automaticHighlightsEnabled(config?.value, user.id)) {
      return response({ code: "highlights_unavailable" }, 403);
    }

    const [{ data: reel, error: reelError }, points] = await Promise.all([
      supabase
        .from("match_reels")
        .select("status,manifest")
        .eq("match_id", matchId)
        .eq("scope", "highlights")
        .maybeSingle(),
      loadPoints(supabase, matchId),
    ]);
    if (reelError || !points) throw reelError ?? new Error("points unavailable");
    const manifest = manifestValue(reel?.manifest);
    const requestDecision = automaticHighlightRequestDecision({
      hasReel: Boolean(reel),
      reelStatus: reel?.status ?? null,
      manifestFresh: Boolean(
        manifest && highlightManifestIsFresh(points, manifest),
      ),
      pointsUpdating: points.some(
        (point) => !point.deleted && point.edited,
      ),
    });
    if (requestDecision === "rendering") {
      return response({ status: "rendering" }, 202);
    }
    if (requestDecision === "clips_updating") {
      return response({ code: "rally_clips_updating" }, 409);
    }
    if (requestDecision === "current") {
      return response({ code: "highlights_current" }, 409);
    }

    const { error: enqueueError } = await supabase.rpc("enqueue_reel", {
      p_match_id: matchId,
      p_scope: "highlights",
      p_show_score: false,
      p_manifest: initialManifest(
        automaticHighlightEvidenceRefreshNeeded(points),
      ),
    });
    if (enqueueError) {
      if (String(enqueueError.message).includes("render_queue_full")) {
        return response({ code: "render_queue_full" }, 429);
      }
      throw enqueueError;
    }
    return response({ status: "rendering" }, 202);
  } catch (error) {
    console.error("automatic highlights update failed", error);
    return response({ code: "highlight_update_failed" }, 500);
  }
}
