import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MEDIA_BUCKET, presignGet } from "@/lib/r2";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ManifestPoint = {
  point_id: string;
  cut_start_s: number;
  cut_end_s: number;
  output_start_s: number;
  output_end_s: number;
  n_hits: number;
  connected_crossings: number;
  table_bounces: number;
};

type HighlightManifest = {
  v: 1;
  rule: "quality-first-v1";
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
    manifest.v !== 1 ||
    manifest.rule !== "quality-first-v1" ||
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
      "id,cut_t0,rally_end_cut_s,deleted,edited,highlight_evidence",
    )
    .eq("match_id", matchId)
    .in("id", ids);
  if (error || !rows || rows.length !== ids.length) return false;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return manifest.points.every((point) => {
    const row = byId.get(point.point_id);
    const evidence = row?.highlight_evidence as
      | { v?: number; status?: string }
      | null
      | undefined;
    return Boolean(
      row &&
        !row.deleted &&
        !row.edited &&
        evidence?.v === 1 &&
        evidence.status === "ready" &&
        typeof row.cut_t0 === "number" &&
        typeof row.rally_end_cut_s === "number" &&
        Math.abs(row.cut_t0 - point.cut_start_s) < 0.011 &&
        Math.abs(row.rally_end_cut_s + 0.75 - point.cut_end_s) < 0.011,
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
    if (config?.value !== "on") return response({ status: "unavailable" });

    const { data: reel, error: reelError } = await supabase
      .from("match_reels")
      .select("status,r2_key,duration_s,manifest,error")
      .eq("match_id", matchId)
      .eq("scope", "highlights")
      .maybeSingle();
    if (reelError) throw reelError;

    if (reel?.status === "empty") return response({ status: "empty" });
    if (reel?.status === "failed") return response({ status: "failed" });
    if (reel?.status === "queued" || reel?.status === "rendering") {
      return response({ status: "rendering" });
    }

    const manifest = manifestValue(reel?.manifest);
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
      v: 1,
      rule: "quality-first-v1",
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
