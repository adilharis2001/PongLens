import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Match, Point } from "@/lib/types";
import { computeMatchScore } from "@/app/match/[id]/gameScore";
import { computeServing } from "@/app/match/[id]/serving";
import {
  diagnoseServePlacement,
  normalizePlacementCoordinates,
} from "@/lib/placement/placementAggregate";
import { MEDIA_BUCKET, getObject } from "@/lib/r2";
import { ServeAccuracy } from "./ServeAccuracy";
import {
  livePoints,
  serveSpeed,
  type DetectedEvent,
  type ServeAccuracyMatch,
  type ServeAccuracyRow,
} from "./serveAccuracyModel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Serve accuracy",
  robots: { index: false, follow: false, nocache: true },
};

const MATCHES = [
  { id: "ec6490f4-b835-4d82-882a-8fb2f1abc2e5", label: "Chris" },
  { id: "7e02fbb9-a3af-4686-84bc-d4b961ab9fed", label: "Julian" },
] as const;

/** match.json carries the calibrated corners and the clip offsets. */
async function readMatchJson(path: string | null) {
  if (!path) return null;
  const key = path.replace(`r2://${MEDIA_BUCKET}/`, "");
  try {
    const object = await getObject(MEDIA_BUCKET, key);
    if (!object) return null;
    return JSON.parse(new TextDecoder().decode(object.body)) as {
      calibration?: {
        ok?: boolean;
        source?: string;
        table_corners_px?: Record<string, [number, number]>;
      };
      source?: { width: number; height: number; fps: number };
      points?: { idx: number; clip_t0?: number }[];
    };
  } catch {
    return null;
  }
}

export default async function ServeAccuracyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/serve-accuracy");
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const matches: ServeAccuracyMatch[] = [];
  for (const entry of MATCHES) {
    const [matchRes, pointsRes] = await Promise.all([
      supabase.from("matches").select("*").eq("id", entry.id).maybeSingle(),
      supabase
        .from("points")
        .select("*")
        .eq("match_id", entry.id)
        .order("idx", { ascending: true }),
    ]);
    const match = matchRes.data as Match | null;
    if (!match) continue;
    const all = (pointsRes.data ?? []) as Point[];
    const visible = livePoints(all);
    const matchJson = await readMatchJson(match.match_json_path);
    const fps = matchJson?.source?.fps ?? 30;
    const clipT0 = new Map<number, number>(
      (matchJson?.points ?? [])
        .filter((p) => typeof p.clip_t0 === "number")
        .map((p) => [p.idx, p.clip_t0 as number]),
    );

    const score = computeMatchScore(visible);
    const gameIndexByPoint = new Map<string, number>();
    let game = 0;
    for (const p of visible) {
      gameIndexByPoint.set(p.id, game);
      if (score.boundaryAfter.has(p.id)) game += 1;
    }
    const serving = computeServing(visible, match.first_server);
    const diagnoses = diagnoseServePlacement({
      points: visible,
      userSide: match.user_side,
      gameIndexByPoint,
      serving,
    });
    const byId = new Map(visible.map((p) => [p.id, p]));

    const rows: ServeAccuracyRow[] = diagnoses.map((d) => {
      const point = byId.get(d.pointId);
      const placement = point?.placement;
      const v3 =
        placement && "v" in placement && placement.v === 3 ? placement : null;
      const userPhysicalSide =
        match.user_side === null
          ? null
          : d.gameIndex % 2 === 0
            ? match.user_side
            : match.user_side === "near"
              ? "far"
              : "near";

      // Which events the reconstruction gave a part to, so the map can say
      // "this bounce is the one the serve rule read" rather than showing
      // nine identical dots.
      const roles = new Map<string, DetectedEvent["role"]>();
      const serverSide =
        userPhysicalSide === null || d.server === null
          ? null
          : d.server === "user"
            ? userPhysicalSide
            : userPhysicalSide === "near"
              ? "far"
              : "near";
      const hypothesis =
        v3 && serverSide ? v3.hypotheses[serverSide] : null;
      for (const shot of hypothesis?.shots ?? []) {
        const first = shot.serve_first_bounce?.event_id;
        const landing = shot.landing?.event_id;
        const contact = shot.contact?.event_id;
        if (first) roles.set(first, "serve_first_bounce");
        if (landing) {
          roles.set(landing, shot.phase === "serve" ? "serve_landing" : "landing");
        }
        if (contact) roles.set(contact, "contact");
      }

      const offset = clipT0.get(point?.idx ?? -1) ?? null;
      const events: DetectedEvent[] = (v3?.candidates ?? []).map((c) => {
        const nu =
          userPhysicalSide !== null
            && typeof c.u === "number"
            && typeof c.v === "number"
            ? normalizePlacementCoordinates(c.u, c.v, userPhysicalSide)
            : null;
        return {
          id: c.id,
          kind: c.kind,
          t: c.t,
          clipT: offset === null ? null : c.t - offset,
          x: c.x ?? null,
          y: c.y ?? null,
          u: c.u ?? null,
          v: c.v ?? null,
          nu: nu ? nu.u : null,
          nv: nu ? nu.v : null,
          visual: c.visual_confidence,
          audio: c.audio_confidence,
          role: roles.get(c.id) ?? null,
        };
      });
      events.sort((a, b) => a.t - b.t);

      const first = events.find((e) => e.role === "serve_first_bounce");
      const landing = events.find((e) => e.role === "serve_landing");

      const suggestion = point?.suggestion ?? null;
      return {
        pointId: d.pointId,
        idx: point?.idx ?? 0,
        game: d.gameIndex + 1,
        server: d.server,
        winner: point?.confirmed_winner ?? null,
        isLet: point?.is_let === true,
        computed: suggestion
          ? {
              winner: suggestion.winner ?? null,
              how: suggestion.how ?? null,
              reason: suggestion.reason ?? null,
              hits: suggestion.n_hits ?? null,
            }
          : null,
        serve: d.observation
          ? { u: d.observation.u, v: d.observation.v }
          : null,
        final: d.finalLanding,
        rejection: d.rejection,
        events,
        speed:
          first && landing ? serveSpeed(first, landing, fps) : null,
        clipT0: offset,
      };
    });

    matches.push({
      matchId: entry.id,
      label: entry.label,
      opponent: match.opponent_name ?? entry.label,
      corners: matchJson?.calibration?.table_corners_px ?? null,
      source: matchJson?.source ?? null,
      calibrationSource: matchJson?.calibration?.source ?? null,
      rows,
    });
  }

  if (matches.length === 0) notFound();
  return <ServeAccuracy matches={matches} />;
}
