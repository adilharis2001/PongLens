import type { Point } from "@/lib/types";
import { computeMatchScore } from "@/app/match/[id]/gameScore";
import { computeServing } from "@/app/match/[id]/serving";
import {
  diagnoseServePlacement,
  type ServePlacementRejection,
} from "@/lib/placement/placementAggregate";
import {
  readPoint,
  rulesDisagree,
  type PointReading,
  type RuleVerdict,
  type Tracks,
} from "@/app/research/serve-accuracy/pointReading";
import { isRecovered } from "@/app/research/serve-accuracy/segments";
import {
  serveSpeed,
  type DetectedEvent,
  type ServeAccuracyRow,
} from "@/app/research/serve-accuracy/serveAccuracyModel";
import type { MatchJson, UploadDetail } from "./uploadView";

/**
 * The winner rules, asked of an ordinary upload.
 *
 * /research/serve-accuracy reads three rules over the touches the placement
 * reconstruction stored — the ball died, the ball went off the table, the
 * ball never came back over the net — and reads them for six matches named
 * in a list. Nothing about the rules was ever specific to those six. What
 * was specific was the ball track: the page uses a BlurBall re-run over each
 * point's clip, checked into the repository, one file per match.
 *
 * The card diagnosis now carries that track for every match it covers, so
 * the same rules can be asked here. The rules are IMPORTED, not copied. A
 * second implementation of a rule whose whole value is that it has been
 * scored against 174 hand-tapped points would be a different rule wearing
 * the same numbers.
 *
 * All rule evaluation runs on the SERVER. The browser receives the track's
 * time/x/y rows for the admin trail, but never the confidence or candidate
 * payload the rules read; only their verdicts cross that boundary.
 */

/** How the serve's own two bounces came out. */
export type ServeBounces = "both" | "first" | "landing" | "neither";

/** One rule's answer, or its silence. */
export interface RuleLine {
  name: RuleVerdict["name"];
  /** Null when the rule did not answer on this point. */
  verdict: "user" | "opponent" | null;
  why: string | null;
}

export interface CardReading {
  pointId: string;
  /**
   * False when nobody recorded which end the uploader played from.
   *
   * The rules read the ball against a physical end and answer "near lost"
   * or "far lost"; turning that into a player needs `matches.user_side`.
   * Without it the reading is still real — it just names an END. Refusing
   * to answer at all would throw away a correct verdict over a missing
   * label, and 16 of the 36 diagnosed matches have no side on them.
   */
  sideKnown: boolean;
  /** Who the owner said won, which is the ruler everything else is read
   *  against. Null on a point they never scored. */
  tapped: "user" | "opponent" | null;
  /** Every rule, answered or silent, always in the same order. */
  rules: RuleLine[];
  /** The call, which is the first rule that answered. */
  winner: "user" | "opponent" | null;
  rule: RuleVerdict["name"] | null;
  why: string | null;
  /** Why nothing was called, when nothing was. */
  refusal: string | null;
  /** True when two rules answered and named different players. */
  disagree: boolean;
  /** Against the owner's own tap: true, false, or null when untested. */
  agrees: boolean | null;
  /** The same test for the worker's own suggestion, so the rules are read
   *  against the thing they have to beat rather than against nothing. */
  agreesWorker: boolean | null;
  /** What the flight reader put back when the first pass refused. */
  recovered: { kind: string; at: number; theirHalf: boolean | null }[];
  repairTrusted: boolean | null;
  speed: { kmh: number; metres: number; frames: number } | null;
  rally: {
    hits: number | null;
    shots: number;
    contacts: number;
    seconds: number | null;
  };
  touches: { bounces: number; onTable: number; contacts: number };
  serveBounces: ServeBounces;
  /** Where the serve landed, in the receiver's terms. */
  serveLandsTheirHalf: boolean | null;
  lastLanding: { theirHalf: boolean; shotsAfter: number } | null;
  worker: {
    winner: "user" | "opponent" | null;
    how: string | null;
    reason: string | null;
    hits: number | null;
  } | null;
  /** Why the placement map refused this serve, when it did. */
  rejection: ServePlacementRejection | null;
  hasTrack: boolean;
}

export interface ReadingSummary {
  /** False when the match has no recorded side; every call names an end. */
  sideKnown: boolean;
  points: number;
  /** Points a rule spoke on, and how many of those match the owner's tap. */
  called: number;
  compared: number;
  agreed: number;
  /** Per rule: how often it made the call, and how often that was right. */
  byRule: { name: RuleVerdict["name"]; called: number; agreed: number;
            compared: number }[];
  disagreements: number;
  repaired: number;
  withTrack: number;
  speeds: { count: number; medianKmh: number | null; maxKmh: number | null };
  /** How the worker's own suggestion scores over the same points, so the
   *  rules are read against something rather than in the air. */
  workerCompared: number;
  workerAgreed: number;
}

interface EvidencePoint {
  id: string;
  idx: number;
  t0: number;
  t1: number;
  placement: Point["placement"] | null;
  suggestion: Point["suggestion"] | null;
}

/** The track artifact publish_card_diagnosis writes beside serves.json. */
export interface TrackArtifact {
  v: number;
  clock: string;
  w: number;
  h: number;
  /** "measured" when the samples carry BlurBall's own confidence,
   *  "stamped" when the publisher had to invent one. */
  conf?: "measured" | "stamped";
  cards: { t0: number; track: number[][] }[];
}

const RULE_ORDER: RuleVerdict["name"][] = ["ball died", "off table", "no return"];

const flipSide = (s: "near" | "far") => (s === "near" ? "far" : "near");

/**
 * Which half a table coordinate is on, from the reader's point of view.
 *
 * `v` runs along the table from the near end, so the halfway line is the
 * net. "Theirs" means the opponent's half, which depends on which end the
 * uploader was standing at for THIS game — ends swap every game, and
 * reading it once for the match is how a page ends up confidently mirrored.
 */
function theirHalf(
  v: number | null,
  userPhysicalSide: "near" | "far" | null
): boolean | null {
  if (v === null || userPhysicalSide === null) return null;
  const nearHalf = v < 2.74 / 2;
  return userPhysicalSide === "near" ? !nearHalf : nearHalf;
}

/**
 * Every card's reading, and the tally over the match.
 *
 * Returns an empty list rather than throwing when a match has no placement
 * or no track: an upload that was never reconstructed is the ordinary case
 * for anything processed before 2026-08, and the page simply does not offer
 * the section.
 */
export function readCards({
  detail,
  evidence,
  matchJson,
  tracks,
}: {
  detail: UploadDetail;
  evidence: EvidencePoint[];
  matchJson: MatchJson | null;
  tracks: TrackArtifact | null;
}): { readings: CardReading[]; summary: ReadingSummary | null } {
  if (evidence.length === 0) return { readings: [], summary: null };

  const { match } = detail;
  const byId = new Map(detail.points.map((p) => [p.id, p]));

  // Point-shaped just enough for the two shared readers below. The evidence
  // RPC already excludes deleted points, which is what makes the rotation
  // and the game boundaries agree with the ones the owner scored against.
  const visible = evidence.map((e) => {
    const row = byId.get(e.id);
    return {
      id: e.id,
      idx: e.idx,
      t0: e.t0,
      t1: e.t1,
      deleted: false,
      placement: e.placement,
      suggestion: e.suggestion,
      confirmed_winner: row?.confirmed_winner ?? null,
      is_let: row?.is_let ?? false,
      server_override: row?.server_override ?? null,
      game_end_override: row?.game_end_override ?? null,
      game_winner_override: row?.game_winner_override ?? null,
    } as unknown as Point;
  });

  const score = computeMatchScore(visible);
  const gameIndexByPoint = new Map<string, number>();
  let game = 0;
  for (const p of visible) {
    gameIndexByPoint.set(p.id, game);
    if (score.boundaryAfter.has(p.id)) game += 1;
  }
  // computeServing, never a second rotation: lets, deleted points and an
  // override are handled there exactly as the scorekeeper handled them.
  const serving = computeServing(visible, match.first_server ?? null);

  const diagnosed = new Map(
    diagnoseServePlacement({
      points: visible,
      userSide: match.user_side as "near" | "far" | null,
      gameIndexByPoint,
      serving,
    }).map((d) => [d.pointId, d])
  );

  const corners = matchJson?.calibration?.table_corners_px ?? null;
  const source = matchJson?.source
    ? {
        width: matchJson.source.width ?? 0,
        height: matchJson.source.height ?? 0,
        fps: matchJson.source.fps ?? 30,
      }
    : null;
  const fps = source?.fps ?? 30;

  // The artifact is keyed by the card's own start, the same way the card
  // diagnosis is matched to a point. A tenth of a second covers the
  // rounding on the way out; nothing else is ever that close.
  // A stamped track is refused outright.
  //
  // Two of the rules filter the track on BlurBall's confidence, and a
  // publisher that had to invent one cannot be read: measured over the
  // 23-point corpus, a low stamp silences the repair layer completely and a
  // high one changes two verdicts. Ignoring the track costs the net read,
  // the no-return read and the repair — the page says so — and every answer
  // it still gives is one the rules would have given anyway.
  const usable = tracks && tracks.conf === "measured" ? tracks : null;
  const trackByT0 = (usable?.cards ?? []).map((c) => ({
    t0: c.t0,
    rows: c.track as (readonly number[])[],
  }));
  const trackFor = (t0: number) =>
    trackByT0.find((c) => Math.abs(c.t0 - t0) < 0.1)?.rows ?? null;

  const trackMap: Tracks = {};
  const rows: ServeAccuracyRow[] = evidence.map((e) => {
    const gameIndex = gameIndexByPoint.get(e.id) ?? 0;
    // With no recorded side, read the match from the NEAR end and say so.
    // Every "user" below then means the near player, which the page relabels
    // rather than pretending to know who that is.
    const userSide = (match.user_side as "near" | "far" | null) ?? "near";
    const userPhysicalSide =
      gameIndex % 2 === 0 ? userSide : flipSide(userSide);
    const server = serving.get(e.id)?.server ?? null;
    const d = diagnosed.get(e.id) ?? null;
    const placement = e.placement;
    const v3 =
      placement && "v" in placement && placement.v === 3 ? placement : null;

    const serverSide =
      userPhysicalSide === null || server === null
        ? null
        : server === "user"
          ? userPhysicalSide
          : flipSide(userPhysicalSide);
    const hypothesis = v3 && serverSide ? v3.hypotheses[serverSide] : null;

    const roles = new Map<string, DetectedEvent["role"]>();
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

    const events: DetectedEvent[] = (v3?.candidates ?? [])
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        t: c.t,
        clipT: null,
        x: c.x ?? null,
        y: c.y ?? null,
        u: c.u ?? null,
        v: c.v ?? null,
        nu: null,
        nv: null,
        visual: c.visual_confidence,
        audio: c.audio_confidence,
        role: roles.get(c.id) ?? null,
      }))
      .sort((a, b) => a.t - b.t);

    const rowTrack = trackFor(e.t0);
    if (rowTrack) trackMap[e.id] = rowTrack;

    const first = events.find((ev) => ev.role === "serve_first_bounce");
    const landing = events.find((ev) => ev.role === "serve_landing");
    const point = byId.get(e.id);
    const suggestion = e.suggestion;

    return {
      pointId: e.id,
      idx: e.idx,
      game: gameIndex + 1,
      server,
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
      serve: d?.observation ? { u: d.observation.u, v: d.observation.v } : null,
      final: d?.finalLanding ?? null,
      rejection: d?.rejection ?? null,
      events,
      speed: first && landing ? serveSpeed(first, landing, fps) : null,
      rally: {
        hits: suggestion?.n_hits ?? null,
        shots: hypothesis?.shots.length ?? 0,
        contacts: events.filter((ev) => ev.kind === "contact").length,
        seconds: e.t1 - e.t0,
      },
      userPhysicalSide,
      // The track is already in SOURCE seconds, the clock the candidates
      // use, so the rules need no origin to add. Handing them zero is the
      // conversion, not the absence of one.
      clipT0: rowTrack ? 0 : null,
    };
  });

  const sideKnown = match.user_side !== null;
  const readings = rows.map((row, i) =>
    toCardReading(
      row,
      readPoint(row, corners, trackMap, source),
      evidence[i].t0,
      sideKnown
    )
  );
  return { readings, summary: summarise(readings) };
}

function toCardReading(
  row: ServeAccuracyRow,
  reading: PointReading,
  cardT0: number,
  sideKnown: boolean
): CardReading {
  const spoke = new Map(reading.verdicts.map((v) => [v.name, v]));
  const landings = reading.events.filter(
    (e) => e.role === "landing" || e.role === "serve_landing"
  );
  const last = landings[landings.length - 1] ?? null;
  const serveLanding = reading.events.find((e) => e.role === "serve_landing");
  const serveFirst = reading.events.find(
    (e) => e.role === "serve_first_bounce"
  );
  const onTable = reading.events.filter(
    (e) => e.kind === "bounce" && e.u !== null && e.v !== null
  ).length;

  return {
    pointId: row.pointId,
    sideKnown,
    tapped: sideKnown ? row.winner : null,
    rules: RULE_ORDER.map((name) => ({
      name,
      verdict: spoke.get(name)?.verdict ?? null,
      why: spoke.get(name)?.why ?? null,
    })),
    winner: reading.winner,
    rule: reading.rule,
    why: reading.why,
    refusal: reading.refusal,
    disagree: rulesDisagree(reading),
    // Both comparisons need the side: without it "user" is an end, not a
    // person, and scoring it against a tap would be arithmetic on two
    // different things.
    agrees:
      !sideKnown || reading.winner === null || row.winner === null
        ? null
        : reading.winner === row.winner,
    agreesWorker:
      !sideKnown || row.computed?.winner == null || row.winner === null
        ? null
        : row.computed.winner === row.winner,
    recovered: reading.events.filter(isRecovered).map((e) => ({
      kind: e.kind,
      at: Number((e.t - cardT0).toFixed(2)),
      theirHalf: theirHalf(e.v, row.userPhysicalSide),
    })),
    repairTrusted: reading.trust ? reading.trust.trusted : null,
    speed: row.speed
      ? {
          kmh: Math.round(row.speed.kmh),
          metres: Number(row.speed.metres.toFixed(2)),
          frames: row.speed.frames,
        }
      : null,
    rally: row.rally,
    touches: {
      bounces: row.events.filter((e) => e.kind === "bounce").length,
      onTable,
      contacts: row.rally.contacts,
    },
    serveBounces:
      serveFirst && serveLanding
        ? "both"
        : serveFirst
          ? "first"
          : serveLanding
            ? "landing"
            : "neither",
    serveLandsTheirHalf: serveLanding
      ? theirHalf(serveLanding.v, row.userPhysicalSide)
      : null,
    lastLanding:
      last && theirHalf(last.v, row.userPhysicalSide) !== null
        ? {
            theirHalf: theirHalf(last.v, row.userPhysicalSide) as boolean,
            shotsAfter: reading.events.filter((e) => e.t > last.t).length,
          }
        : null,
    worker: row.computed,
    rejection: row.rejection,
    hasTrack: row.clipT0 !== null,
  };
}

function summarise(readings: readonly CardReading[]): ReadingSummary {
  const called = readings.filter((r) => r.winner !== null);
  const compared = called.filter((r) => r.agrees !== null);
  const speeds = readings
    .map((r) => r.speed?.kmh)
    .filter((k): k is number => k !== undefined)
    .sort((a, b) => a - b);
  const worker = readings.filter((r) => r.worker?.winner);

  return {
    sideKnown: readings[0]?.sideKnown ?? true,
    points: readings.length,
    called: called.length,
    compared: compared.length,
    agreed: compared.filter((r) => r.agrees).length,
    byRule: RULE_ORDER.map((name) => {
      const mine = readings.filter((r) => r.rule === name);
      const judged = mine.filter((r) => r.agrees !== null);
      return {
        name,
        called: mine.length,
        compared: judged.length,
        agreed: judged.filter((r) => r.agrees).length,
      };
    }),
    disagreements: readings.filter((r) => r.disagree).length,
    repaired: readings.filter((r) => r.recovered.length > 0).length,
    withTrack: readings.filter((r) => r.hasTrack).length,
    speeds: {
      count: speeds.length,
      medianKmh: speeds.length ? speeds[Math.floor(speeds.length / 2)] : null,
      maxKmh: speeds.length ? speeds[speeds.length - 1] : null,
    },
    // The worker's own call over the same points. Without it the rules'
    // score is a number with nothing behind it — this is the thing they
    // have to beat to be worth reading.
    workerCompared: worker.filter((r) => r.agreesWorker !== null).length,
    workerAgreed: worker.filter((r) => r.agreesWorker === true).length,
  };
}
