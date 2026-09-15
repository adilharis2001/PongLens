import type { PlacementCandidateV3, PlacementV3, Point } from "../types.ts";
import {
  PLACEMENT_ZONES,
  TABLE_LENGTH_M,
  TABLE_WIDTH_M,
  classifyPlacementZone,
  diagnoseServePlacement,
  normalizePlacementCoordinates,
  otherSide,
  physicalSideForGame,
  type PlacementAggregateServing,
  type PlacementPhysicalSide,
  type PlacementZone,
  type PlacementZoneCounts,
  type ServePlacementDiagnosis,
} from "./placementAggregate.ts";
import { selectPlacementHypothesis } from "./placementModel.ts";

/**
 * The cards a match earns once most of it is scored.
 *
 * Everything here reads data the worker already stored and the owner's own
 * scoring; nothing asks the video for anything new. The score is the
 * trusted record: who served comes from the rotation the scorekeeper runs,
 * who won from the confirmed winner, and where a point ended from the
 * owner's own tap. The placement JSON supplies the two serve bounces and
 * the candidate bounces, and every rule below is a way of refusing what
 * the camera got wrong rather than a way of guessing more.
 *
 * Measured on 19 scored matches (1,320 points) before this shipped:
 * docs/research/2026-09-15-scored-match-cards. Two things that corpus
 * settled, kept here because the next reader will be tempted to undo them:
 *
 *   * The return of serve is missed by the bounce detector on about half
 *     of the points that show no return, so nothing here counts shots.
 *     A card that needed "did the return land" would be wrong one point in
 *     three. Point LENGTH in seconds needs no bounce after the serve.
 *   * A point's ending is the earlier of the worker's rally end and the
 *     owner's score tap. On one point in five the rally end sits after the
 *     tap, which is dead play after the point; the tap bounds it.
 */

/**
 * Share of scoreable points that must carry a winner before any card shows.
 * The same bar as the highlights, and the same arithmetic: see
 * public.highlight_generation_eligibility (migration 20260910190000),
 * which is where this number is really kept. Change both or neither.
 */
export const SCORED_CARDS_MIN_SHARE = 0.75;
/** A bounce this close to a detected racket contact is the contact. */
export const NEAR_CONTACT_S = 0.085;
/** A bounce this close to the net line is a net cord or a ball in flight. */
export const NET_BAND_M = 0.15;
/** A trailing bounce this long after the previous one is dead play. */
export const DEAD_PLAY_GAP_S = 1.5;
/** Endings show only where the last bounce agrees with the score this often. */
export const ENDINGS_MIN_AGREEMENT = 0.7;
export const ENDINGS_MIN_POINTS = 10;
/** Same floor the analysis deck uses: two data points are not a pattern. */
export const MIN_SAMPLES = 3;

const NET_V_M = TABLE_LENGTH_M / 2;

export interface ScoredTally {
  label: string;
  won: number;
  lost: number;
}

export interface ScoredCardsGate {
  scored: number;
  /** Scoreable points: live, and not a let. */
  eligible: number;
  share: number;
  /** How many scored points the bar asks for, rounded up like the SQL. */
  required: number;
  open: boolean;
}

export interface PointLengthResult {
  /** Points on the uploader's serve, one tally per length band. */
  mine: ScoredTally[];
  /** Points on the opponent's serve. */
  theirs: ScoredTally[];
  covered: number;
  considered: number;
}

export interface SpeedBand extends ScoredTally {
  /** Band edges in km/h along the table; null at the open ends. */
  fromKmh: number | null;
  toKmh: number | null;
}

export interface VarietySummary {
  count: number;
  zonesUsed: number;
  top: { zone: PlacementZone; label: string; count: number }[];
  topShare: number;
}

export interface EndingsResult {
  /** Points with a usable last bounce and an ending. */
  considered: number;
  /** ... whose last bounce sits on the loser's half, as it must. */
  agreed: number;
  agreement: number;
  shown: boolean;
  /** Endings on the uploader's half: points they lost. */
  lostCounts: PlacementZoneCounts;
  /** Endings on the opponent's half: points the uploader won. */
  wonCounts: PlacementZoneCounts;
  lost: number;
  won: number;
}

export interface ScoredCardsResult {
  gate: ScoredCardsGate;
  pointLength: PointLengthResult;
  serveSpeed: { mine: SpeedBand[]; theirs: SpeedBand[] };
  serveVariety: { mine: VarietySummary | null; theirs: VarietySummary | null };
  endings: EndingsResult;
}

export interface ScoredCardsInput {
  points: readonly Point[];
  userSide: PlacementPhysicalSide | null;
  gameIndexByPoint: Map<string, number>;
  serving: Map<string, PlacementAggregateServing>;
  /** Effective pre pad of a point's clip, seconds (clipEdit.effectivePad). */
  prePad: (point: Point) => number;
  /** False when the owner flagged the match's maps or placement is not ready. */
  placementTrusted?: boolean;
  /** One game only (0-based), or every game. The gate always reads the whole match. */
  gameFilter?: number | null;
}

function num(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

export function scoredCardsGate(points: readonly Point[]): ScoredCardsGate {
  const eligible = points.filter((p) => !p.deleted && !p.is_let);
  const scored = eligible.filter((p) => p.confirmed_winner !== null).length;
  const n = eligible.length;
  return {
    scored,
    eligible: n,
    share: n ? scored / n : 0,
    required: Math.floor((n * 3 + 3) / 4),
    // Integer arithmetic, as the SQL does it: 3 of 4 opens, 2 of 3 does not.
    open: n > 0 && scored * 4 >= n * 3,
  };
}

/**
 * Cut-video seconds → source-video seconds, the clock the placement
 * candidates carry. cut_t0 is the padded clip start on the cut clock and
 * t0 minus the effective pre pad is the same instant on the source clock
 * (playhead.ts, the anchoring fact).
 */
export function cutToSource(
  point: Point,
  prePad: number,
  cutS: number,
): number | null {
  const t0 = num(point.t0);
  const cutT0 = num(point.cut_t0);
  if (t0 === null || cutT0 === null) return null;
  return t0 - prePad - cutT0 + cutS;
}

/** When the point ended: the earlier of the worker's rally end and the owner's score tap. */
export function pointEndSource(point: Point, prePad: number): number | null {
  const ends: number[] = [];
  for (const cutS of [point.rally_end_cut_s, point.scored_at_cut_s]) {
    const c = num(cutS);
    if (c === null) continue;
    const s = cutToSource(point, prePad, c);
    if (s !== null) ends.push(s);
  }
  return ends.length ? Math.min(...ends) : null;
}

export function readableZone(zone: PlacementZone): string {
  const [depth, lateral] = zone.split("_");
  return `${depth} ${lateral}`;
}

function emptyCounts(): PlacementZoneCounts {
  return Object.fromEntries(
    PLACEMENT_ZONES.map((zone) => [zone, { total: 0, scored: 0, won: 0 }]),
  ) as PlacementZoneCounts;
}

function insideTable(u: number, v: number): boolean {
  return u >= 0 && u <= TABLE_WIDTH_M && v >= 0 && v <= TABLE_LENGTH_M;
}

function halfOf(v: number): PlacementPhysicalSide {
  return v < NET_V_M ? "near" : "far";
}

interface Ctx {
  point: Point;
  server: "user" | "opponent";
  serverSide: PlacementPhysicalSide;
  userPhysical: PlacementPhysicalSide;
  loserSide: PlacementPhysicalSide;
  placement: PlacementV3 | null;
  diagnosis: ServePlacementDiagnosis | null;
  end: number | null;
}

function serveOf(ctx: Ctx) {
  if (!ctx.placement) return null;
  const hypothesis = selectPlacementHypothesis(ctx.placement, ctx.serverSide);
  return hypothesis?.shots.find((shot) => shot.phase === "serve") ?? null;
}

const LENGTH_BANDS: { label: string; max: number }[] = [
  { label: "Under 3 s", max: 3 },
  { label: "3 to 6 s", max: 6 },
  { label: "Over 6 s", max: Infinity },
];

function tallies(): ScoredTally[] {
  return LENGTH_BANDS.map((band) => ({ label: band.label, won: 0, lost: 0 }));
}

function pointLength(contexts: Ctx[]): PointLengthResult {
  const mine = tallies();
  const theirs = tallies();
  let covered = 0;
  for (const ctx of contexts) {
    if (ctx.end === null) continue;
    let start: number | null = null;
    const serve = ctx.diagnosis?.observation ? serveOf(ctx) : null;
    const firstT = num(serve?.serve_first_bounce?.t);
    if (firstT !== null) {
      start = firstT;
    } else if (ctx.placement) {
      // No trusted serve: the first bounce seen on the table before the
      // point ended. Later than the real start by a shot at most.
      const first = ctx.placement.candidates
        .filter((c) => c.kind === "bounce")
        .sort((a, b) => a.t - b.t)
        .find((c) => {
          const u = num(c.u);
          const v = num(c.v);
          return u !== null && v !== null && insideTable(u, v) && c.t < ctx.end!;
        });
      start = first ? first.t : null;
    }
    if (start === null) continue;
    const duration = ctx.end - start;
    if (duration < 0.3) continue;
    covered += 1;
    const band = LENGTH_BANDS.findIndex((b) => duration < b.max);
    const target = ctx.server === "user" ? mine[band] : theirs[band];
    if (ctx.point.confirmed_winner === "user") target.won += 1;
    else target.lost += 1;
  }
  return { mine, theirs, covered, considered: contexts.length };
}

interface SpeedSample {
  speed: number;
  won: boolean;
}

/** Thirds of one player's serves, slowest to fastest, each with the uploader's share won. */
function speedBands(samples: SpeedSample[]): SpeedBand[] {
  if (samples.length < MIN_SAMPLES) return [];
  const sorted = samples.map((s) => s.speed).sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = sorted[Math.floor(n / 3)];
  const q3 = sorted[Math.floor((2 * n) / 3)];
  const edges: { label: string; lo: number; hi: number }[] = [
    { label: "Slow", lo: -Infinity, hi: q1 },
    { label: "Medium", lo: q1, hi: q3 },
    { label: "Fast", lo: q3, hi: Infinity },
  ];
  return edges.map((edge) => {
    const selected = samples.filter(
      (s) => s.speed >= edge.lo && s.speed < edge.hi,
    );
    return {
      label: edge.label,
      won: selected.filter((s) => s.won).length,
      lost: selected.filter((s) => !s.won).length,
      fromKmh: edge.lo === -Infinity ? null : edge.lo * 3.6,
      toKmh: edge.hi === Infinity ? null : edge.hi * 3.6,
    };
  });
}

/**
 * Speed along the table between the serve's two bounces. Both bounces sit
 * on the table plane, so both are measured rather than inferred, and the
 * number needs nothing that happens after the serve.
 */
export function serveSpeedMs(ctx: Ctx): number | null {
  if (!ctx.diagnosis?.observation) return null;
  const serve = serveOf(ctx);
  const first = serve?.serve_first_bounce;
  const landing = serve?.landing;
  const u0 = num(first?.u);
  const v0 = num(first?.v);
  const t0 = num(first?.t);
  const u1 = num(landing?.u);
  const v1 = num(landing?.v);
  const t1 = num(landing?.t);
  if (
    u0 === null || v0 === null || t0 === null
    || u1 === null || v1 === null || t1 === null
  ) {
    return null;
  }
  const dt = t1 - t0;
  const distance = Math.hypot(u1 - u0, v1 - v0);
  if (dt <= 0.05 || dt >= 1.5 || distance <= 0.2) return null;
  return distance / dt;
}

function serveSpeed(contexts: Ctx[]) {
  const mine: SpeedSample[] = [];
  const theirs: SpeedSample[] = [];
  for (const ctx of contexts) {
    const speed = serveSpeedMs(ctx);
    if (speed === null) continue;
    const sample = { speed, won: ctx.point.confirmed_winner === "user" };
    (ctx.server === "user" ? mine : theirs).push(sample);
  }
  return { mine: speedBands(mine), theirs: speedBands(theirs) };
}

function variety(zones: PlacementZone[]): VarietySummary | null {
  if (zones.length < MIN_SAMPLES) return null;
  const counts = new Map<PlacementZone, number>();
  for (const zone of zones) counts.set(zone, (counts.get(zone) ?? 0) + 1);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([zone, count]) => ({ zone, label: readableZone(zone), count }));
  return {
    count: zones.length,
    zonesUsed: counts.size,
    top,
    topShare: top[0].count / zones.length,
  };
}

function serveVariety(contexts: Ctx[]) {
  const mine: PlacementZone[] = [];
  const theirs: PlacementZone[] = [];
  for (const ctx of contexts) {
    const observation = ctx.diagnosis?.observation;
    if (!observation) continue;
    (ctx.server === "user" ? mine : theirs).push(observation.zone);
  }
  return { mine: variety(mine), theirs: variety(theirs) };
}

/**
 * The last bounce of a point that the camera can be believed about.
 *
 * Drops bounces that are really racket contacts, bounces in the net band,
 * anything after the point ended, and a trailing bounce long after the
 * one before it (the ball rolling about after the point). What is left is
 * the last landing, and it must sit on the loser's half: the loser is the
 * player who failed to return it. That check is independent of the camera
 * and is what gates the card.
 */
export function lastCleanBounce(
  placement: PlacementV3,
  end: number,
): PlacementCandidateV3 | null {
  const sorted = placement.candidates.slice().sort((a, b) => a.t - b.t);
  const contacts = sorted.filter((c) => c.kind === "contact");
  const clean = sorted.filter((c) => {
    if (c.kind !== "bounce") return false;
    const u = num(c.u);
    const v = num(c.v);
    if (u === null || v === null || !insideTable(u, v)) return false;
    if (Math.abs(v - NET_V_M) <= NET_BAND_M) return false;
    if (c.t > end + 0.2) return false;
    return !contacts.some((k) => Math.abs(k.t - c.t) <= NEAR_CONTACT_S);
  });
  while (
    clean.length >= 2
    && clean[clean.length - 1].t - clean[clean.length - 2].t > DEAD_PLAY_GAP_S
  ) {
    clean.pop();
  }
  return clean.length ? clean[clean.length - 1] : null;
}

function endings(contexts: Ctx[]): EndingsResult {
  const lostCounts = emptyCounts();
  const wonCounts = emptyCounts();
  let considered = 0;
  let agreed = 0;
  let lost = 0;
  let won = 0;
  for (const ctx of contexts) {
    if (!ctx.placement || ctx.end === null) continue;
    const last = lastCleanBounce(ctx.placement, ctx.end);
    if (!last) continue;
    considered += 1;
    const u = num(last.u)!;
    const v = num(last.v)!;
    if (halfOf(v) !== ctx.loserSide) continue;
    agreed += 1;
    const lostByUser = ctx.loserSide === ctx.userPhysical;
    const n = normalizePlacementCoordinates(u, v, ctx.userPhysical);
    const zone = classifyPlacementZone(
      n.u,
      n.v,
      lostByUser ? "theirRally" : "myRally",
    );
    if (zone === null) continue;
    const cell = (lostByUser ? lostCounts : wonCounts)[zone];
    cell.total += 1;
    cell.scored += 1;
    if (lostByUser) lost += 1;
    else won += 1;
  }
  const agreement = considered ? agreed / considered : 0;
  return {
    considered,
    agreed,
    agreement,
    shown: considered >= ENDINGS_MIN_POINTS && agreement >= ENDINGS_MIN_AGREEMENT,
    lostCounts,
    wonCounts,
    lost,
    won,
  };
}

export function computeScoredCards(
  input: ScoredCardsInput,
): ScoredCardsResult | null {
  const gate = scoredCardsGate(input.points);
  if (!gate.open || input.userSide === null) return null;
  const userSide = input.userSide;
  const live = input.points.filter((p) => !p.deleted);
  const diagnoses = new Map(
    diagnoseServePlacement({
      points: live,
      userSide,
      gameIndexByPoint: input.gameIndexByPoint,
      serving: input.serving,
    }).map((d) => [d.pointId, d]),
  );
  const trusted = input.placementTrusted ?? true;

  const contexts: Ctx[] = [];
  for (const point of live) {
    if (point.is_let || point.confirmed_winner === null) continue;
    if (
      input.gameFilter !== null
      && input.gameFilter !== undefined
      && (input.gameIndexByPoint.get(point.id) ?? 0) !== input.gameFilter
    ) {
      continue;
    }
    const server = input.serving.get(point.id)?.server ?? null;
    if (server === null) continue;
    const gameIndex = input.gameIndexByPoint.get(point.id) ?? 0;
    const userPhysical = physicalSideForGame(userSide, gameIndex);
    const serverSide = server === "user" ? userPhysical : otherSide(userPhysical);
    const winnerSide =
      point.confirmed_winner === "user" ? userPhysical : otherSide(userPhysical);
    const placement =
      trusted
      && !point.placement_flagged
      && point.placement
      && "v" in point.placement
      && point.placement.v === 3
        ? point.placement
        : null;
    contexts.push({
      point,
      server,
      serverSide,
      userPhysical,
      loserSide: otherSide(winnerSide),
      placement,
      diagnosis: placement ? (diagnoses.get(point.id) ?? null) : null,
      end: pointEndSource(point, input.prePad(point)),
    });
  }

  return {
    gate,
    pointLength: pointLength(contexts),
    serveSpeed: serveSpeed(contexts),
    serveVariety: serveVariety(contexts),
    endings: endings(contexts),
  };
}
