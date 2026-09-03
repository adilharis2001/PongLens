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
  type TrackSlug,
} from "./serveAccuracyModel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Serve accuracy",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The matches the winner rules are judged against.
 *
 * Chris and Julian came first and every rule on this page was written
 * watching them, so their scores are a development set and read high. The
 * four below were added on 27 August to find out what the rules do on
 * sessions they have never seen: two more venues, both rungs of the
 * calibration ladder, and one match from a different uploader.
 *
 * A `caution` is not a footnote. It names a reason this match's score is
 * about something other than the rules, so nobody spends a morning
 * chasing a rule failure that is really a missing column.
 */
const MATCHES: {
  id: string;
  slug: TrackSlug;
  label: string;
  caution: string | null;
}[] = [
  {
    id: "ec6490f4-b835-4d82-882a-8fb2f1abc2e5",
    slug: "chris",
    label: "Chris",
    caution: null,
  },
  {
    id: "7e02fbb9-a3af-4686-84bc-d4b961ab9fed",
    slug: "julian",
    label: "Julian",
    caution: null,
  },
  {
    id: "cebaa6d4-81e4-4aab-b4fa-1ed485685d00",
    slug: "rowel",
    label: "Rowel",
    caution: null,
  },
  {
    id: "d59d7610-d087-42ec-a1a6-b532fb4cac96",
    slug: "ishan",
    label: "Ishan",
    caution:
      "The ends do not alternate on this match the way the page assumes. "
      + "Fitting each game separately against the ball put you near, near, "
      + "far, near, far, and 79 of the 81 points are tapped, so missing taps "
      + "are not the cause. Until the real order is confirmed by eye, treat "
      + "every winner on this match as possibly the other player, and read "
      + "the touches and the ball track rather than the call.",
  },
  {
    id: "9e15ed10-f595-4efc-85c8-74cce08eb9c5",
    slug: "prabhas",
    label: "Prabhas",
    caution: null,
  },
  {
    id: "840b4635-7791-4538-b722-9cd17ae6ed34",
    slug: "anton",
    label: "Anton",
    caution:
      "This match never recorded which end the uploader was on, so nothing "
      + "here can be attributed to a player: no serve is drawn and no winner "
      + "is called. The touches, the table and the ball track are all real "
      + "and worth watching. Name the end from any clip and the rest follows.",
  },
];

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
        note?: string;
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
    // The shared diagnosis refuses the whole match when nobody recorded
    // which end the uploader was on, which is right for a placement map and
    // wrong here: the touches, the table and the ball track are all still
    // real, and this page exists to look at them. So the row list is every
    // live point, and a diagnosis is merged in wherever there is one.
    const diagnosed = new Map(diagnoses.map((d) => [d.pointId, d]));
    const entries = visible.map(
      (p) =>
        diagnosed.get(p.id) ?? {
          pointId: p.id,
          gameIndex: gameIndexByPoint.get(p.id) ?? 0,
          server: serving.get(p.id)?.server ?? null,
          observation: null,
          finalLanding: null,
          rejection: null,
        },
    );
    const byId = new Map(visible.map((p) => [p.id, p]));

    const rows: ServeAccuracyRow[] = entries.map((d) => {
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
      const t0 = point?.t0 ?? null;
      const t1 = point?.t1 ?? null;
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
        userPhysicalSide: userPhysicalSide,
        rally: {
          hits: suggestion?.n_hits ?? null,
          shots: hypothesis?.shots.length ?? 0,
          contacts: events.filter((e) => e.kind === "contact").length,
          seconds: t0 !== null && t1 !== null ? t1 - t0 : null,
        },
        clipT0: offset,
      };
    });

    matches.push({
      matchId: entry.id,
      slug: entry.slug,
      label: entry.label,
      opponent: match.opponent_name ?? entry.label,
      corners: matchJson?.calibration?.table_corners_px ?? null,
      source: matchJson?.source ?? null,
      // Vision-proposed quads from before the ladder was named write only a
      // note, so reading `source` alone reports the table as unrecorded on
      // two of the six matches when it is nothing of the sort.
      calibrationSource:
        matchJson?.calibration?.source
        ?? matchJson?.calibration?.note?.split(",")[0]
        ?? null,
      userSide: match.user_side ?? null,
      // The column is optional on the type, so `!== null` would count every
      // row on a match that predates it.
      serveAnchored: all.filter(
        (p) => !p.deleted && typeof p.serve_start_at_cut_s === "number",
      ).length,
      firstServer: match.first_server,
      firstServerSource: match.first_server_source,
      caution: entry.caution,
      rows,
    });
  }

  if (matches.length === 0) notFound();
  return <ServeAccuracy matches={matches} />;
}
