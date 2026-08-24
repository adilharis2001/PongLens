import type { PlacementV3, Point } from "../types.ts";
import { selectPlacementHypothesis } from "./placementModel.ts";

export const PLACEMENT_AGGREGATE_TRUST_THRESHOLD = 0.7;
export const TABLE_WIDTH_M = 1.525;
export const TABLE_LENGTH_M = 2.74;
const NET_V_M = TABLE_LENGTH_M / 2;

export type PlacementPhysicalSide = "near" | "far";
export type PlacementAggregateFilter =
  | "myServes"
  | "theirServes"
  | "myRally"
  | "theirRally";
export type PlacementDepth = "short" | "medium" | "deep";
export type PlacementLateral = "left" | "middle" | "right";
export type PlacementZone =
  `${PlacementDepth}_${PlacementLateral}`;
export const PLACEMENT_ZONES = [
  "short_left",
  "short_middle",
  "short_right",
  "medium_left",
  "medium_middle",
  "medium_right",
  "deep_left",
  "deep_middle",
  "deep_right",
] as const satisfies readonly PlacementZone[];
export type PlacementZoneCounts = Record<PlacementZone, number>;

export interface TrustedPlacementObservation {
  pointId: string;
  shotSeq: number;
  filter: PlacementAggregateFilter;
  zone: PlacementZone;
  u: number;
  v: number;
  confidence: number;
}

export interface PlacementAggregateServing {
  server: "user" | "opponent" | null;
}

export interface CollectTrustedPlacementObservationsInput {
  points: Point[];
  userSide: PlacementPhysicalSide | null;
  gameIndexByPoint: Map<string, number>;
  serving: Map<string, PlacementAggregateServing>;
  gameFilter?: number | null;
}

function otherSide(
  side: PlacementPhysicalSide,
): PlacementPhysicalSide {
  return side === "near" ? "far" : "near";
}

function physicalSideForGame(
  initialSide: PlacementPhysicalSide,
  gameIndex: number,
): PlacementPhysicalSide {
  return gameIndex % 2 === 0
    ? initialSide
    : otherSide(initialSide);
}

/**
 * Worker frame → drawn map, oriented for the player at the bottom.
 *
 * The map is seen from above and behind the bottom player, so their left
 * is the map's left and their own end is the bottom.
 *
 * The worker's contract, which this depends on entirely:
 *
 *   u = 0 is corner A — the NEAR end, the camera's LEFT. v = 0 is the near
 *   end line. `table_coordinates.table_homography` maps the canonicalised
 *   quad A, B, C, D onto (0,0), (W,0), (W,L), (0,L), and the other two
 *   homography sites in the worker use the same destination.
 *
 * Camera-left at the near end is the NEAR player's left: the near end is by
 * construction the one lower in the frame, so that player faces away from
 * the camera and their left hand is on the camera's left. The same sideline
 * is therefore the FAR player's right, which is why u flips for them and
 * not for the near player.
 *
 * This read the other way round until 2026-08-23 and every placement map
 * the app had ever drawn was mirrored left to right. The unit test covering
 * it passed the whole time, because it asserted the numbers the code
 * produced rather than where the ball actually was. The test that governs
 * this now is tableOrientation.test.ts, which works it out from real
 * bounces that carry both their pixel and their table coordinate.
 */
export function normalizePlacementCoordinates(
  u: number,
  v: number,
  userPhysicalSide: PlacementPhysicalSide,
) {
  return userPhysicalSide === "near"
    ? { u, v }
    : { u: TABLE_WIDTH_M - u, v: TABLE_LENGTH_M - v };
}

function third<T extends string>(
  value: number,
  total: number,
  labels: readonly [T, T, T],
): T {
  if (value < total / 3) return labels[0];
  if (value < (total * 2) / 3) return labels[1];
  return labels[2];
}

function landsOnUsersHalf(filter: PlacementAggregateFilter) {
  return filter === "theirServes" || filter === "theirRally";
}

export function classifyPlacementZone(
  normalizedU: number,
  normalizedV: number,
  filter: PlacementAggregateFilter,
): PlacementZone | null {
  if (
    !Number.isFinite(normalizedU)
    || !Number.isFinite(normalizedV)
    || normalizedU < 0
    || normalizedU > TABLE_WIDTH_M
    || normalizedV < 0
    || normalizedV > TABLE_LENGTH_M
  ) {
    return null;
  }
  const distanceFromNet = landsOnUsersHalf(filter)
    ? NET_V_M - normalizedV
    : normalizedV - NET_V_M;
  if (distanceFromNet < 0) return null;

  const depth = third(
    distanceFromNet,
    NET_V_M,
    ["short", "medium", "deep"] as const,
  );
  const lateral = third(
    normalizedU,
    TABLE_WIDTH_M,
    ["left", "middle", "right"] as const,
  );
  return `${depth}_${lateral}`;
}

export function collectTrustedPlacementObservations({
  points,
  userSide,
  gameIndexByPoint,
  serving,
  gameFilter = null,
}: CollectTrustedPlacementObservationsInput): TrustedPlacementObservation[] {
  if (userSide === null) return [];

  const observations: TrustedPlacementObservation[] = [];
  for (const point of points) {
    if (point.deleted) continue;
    const placement = point.placement;
    if (!placement || !("v" in placement) || placement.v !== 3) {
      continue;
    }

    const gameIndex = gameIndexByPoint.get(point.id) ?? 0;
    if (gameFilter !== null && gameIndex !== gameFilter) continue;
    const userPhysicalSide = physicalSideForGame(userSide, gameIndex);
    const server = serving.get(point.id)?.server ?? null;
    if (server === null) continue;
    const serverSide =
      server === "user"
        ? userPhysicalSide
        : otherSide(userPhysicalSide);
    const hypothesis = selectPlacementHypothesis(
      placement,
      serverSide,
    );
    if (
      hypothesis === null
      || hypothesis.status !== "ready"
      || hypothesis.confidence
        < PLACEMENT_AGGREGATE_TRUST_THRESHOLD
      || hypothesis.hard_reasons.length > 0
    ) {
      continue;
    }

    for (const shot of hypothesis.shots) {
      const landing = shot.landing;
      if (
        landing === null
        || shot.confidence
          < PLACEMENT_AGGREGATE_TRUST_THRESHOLD
        || landing.confidence
          < PLACEMENT_AGGREGATE_TRUST_THRESHOLD
        || typeof landing.u !== "number"
        || typeof landing.v !== "number"
      ) {
        continue;
      }
      const expectedHitter =
        shot.seq % 2 === 1
          ? serverSide
          : otherSide(serverSide);
      if (shot.hitter_side !== expectedHitter) continue;

      const mine = expectedHitter === userPhysicalSide;
      const filter: PlacementAggregateFilter =
        shot.phase === "serve"
          ? mine
            ? "myServes"
            : "theirServes"
          : mine
            ? "myRally"
            : "theirRally";
      const normalized = normalizePlacementCoordinates(
        landing.u,
        landing.v,
        userPhysicalSide,
      );
      const zone = classifyPlacementZone(
        normalized.u,
        normalized.v,
        filter,
      );
      if (zone === null) continue;

      observations.push({
        pointId: point.id,
        shotSeq: shot.seq,
        filter,
        zone,
        u: normalized.u,
        v: normalized.v,
        confidence: Math.min(
          hypothesis.confidence,
          shot.confidence,
          landing.confidence,
        ),
      });
    }
  }
  return observations;
}

export function trustedPlacementPointCount(
  observations: readonly TrustedPlacementObservation[],
): number {
  return new Set(
    observations.map((observation) => observation.pointId),
  ).size;
}

export function placementZoneCounts(
  observations: readonly TrustedPlacementObservation[],
  filter: PlacementAggregateFilter,
): PlacementZoneCounts {
  const counts = Object.fromEntries(
    PLACEMENT_ZONES.map((zone) => [zone, 0]),
  ) as PlacementZoneCounts;
  for (const observation of observations) {
    if (observation.filter === filter) {
      counts[observation.zone] += 1;
    }
  }
  return counts;
}

// ---------------------------------------------------------------- serves

/**
 * How late in the point a serve's landing may be, when the serve's own
 * first bounce was never found and there is nothing to measure from.
 *
 * Zero-based, so 1 means "the first or second bounce of the point".
 */
const SERVE_LANDING_MAX_BOUNCE_INDEX = 1;

/** Which half of the table a v coordinate is on. */
function halfForV(v: number): PlacementPhysicalSide {
  return v < NET_V_M ? "near" : "far";
}

function insideTheTable(u: number, v: number): boolean {
  return (
    Number.isFinite(u)
    && Number.isFinite(v)
    && u >= 0
    && u <= TABLE_WIDTH_M
    && v >= 0
    && v <= TABLE_LENGTH_M
  );
}

/**
 * Every time the ball touched the table in this point, in order.
 *
 * The point's own candidate list, not the hypothesis's — the candidates
 * are what was actually detected, before any story was fitted to them,
 * which is what makes "is this bounce early enough to be a serve" an
 * independent question rather than a restatement of the reconstruction.
 */
function bounceOrdinals(
  placement: PlacementV3,
): Map<string, number> | null {
  // No list at all is not the same as an empty one. It means whatever
  // handed us this placement dropped the key — the share page's RPC did
  // exactly that until 133, to keep a 777 kB payload down — and the
  // honest answer is then "cannot be asked" rather than "no bounces
  // happened". Returning an empty map would refuse every serve on that
  // surface and look like a match with no data.
  if (!Array.isArray(placement.candidates)) return null;
  const ordinals = new Map<string, number>();
  placement.candidates
    .filter((candidate) => candidate.kind === "bounce")
    .slice()
    .sort((a, b) => a.t - b.t)
    .forEach((candidate, index) => {
      ordinals.set(candidate.id, index);
    });
  return ordinals;
}

/**
 * Where each serve landed, for every point that can answer it.
 *
 * A SEPARATE collector from collectTrustedPlacementObservations, not a
 * relaxation of it. That one asks whether we understood the whole rally,
 * which is the right question for a trajectory and the wrong one for a
 * map of where serves land: ten of its eleven veto rules are about who
 * hit the ball, when the bat touched it and how the point finished, and
 * any single one of them discards every landing in the point. On a fully
 * scored 98-point match it draws 12.
 *
 * The serve is the one shot that needs none of that:
 *
 *   * its owner is known independently, from the scored serve rotation,
 *     rather than by counting hits through the rally, where one missed
 *     contact flips the parity and hands the dot to the wrong player;
 *   * its geometry checks itself — a legal serve bounces on the server's
 *     half and then the receiver's, which no rally shot can claim;
 *   * it is first, so nothing upstream has had a chance to go wrong.
 *
 * So this asks six questions of its own, all about the landing:
 *
 *   1. the point has a server from the scored rotation
 *   2. the serve has a landing with real coordinates
 *   3. the landing is on the RECEIVER's half
 *   4. the landing is inside the physical table
 *   5. the landing is the very next bounce after the serve's own first
 *      bounce (or, with no first bounce found, the first or second
 *      bounce of the point)
 *   6. the serve's own first bounce, when it was found, is on the
 *      SERVER's half
 *
 * Rule 6 costs almost nothing and guards the only failure that would be
 * invisible. If first_server is wrong, every serve in the match flips to
 * the wrong player at once, and a systematic error reads as a finding
 * rather than as a bug. Rule 6 is a second, independent read of who
 * served, and it does not come from the rotation.
 *
 * Deliberately NOT required: a "ready" hypothesis, a confidence floor,
 * an empty hard_reasons, or any of the eleven rally blockers. Those keep
 * running and keep being stored — they are the raw material for a
 * point-winner detector — they simply stop deciding whether a map is
 * drawn.
 */
export function collectServePlacementObservations({
  points,
  userSide,
  gameIndexByPoint,
  serving,
  gameFilter = null,
}: CollectTrustedPlacementObservationsInput): TrustedPlacementObservation[] {
  if (userSide === null) return [];

  const observations: TrustedPlacementObservation[] = [];
  for (const point of points) {
    if (point.deleted) continue;
    const placement = point.placement;
    if (!placement || !("v" in placement) || placement.v !== 3) {
      continue;
    }

    const gameIndex = gameIndexByPoint.get(point.id) ?? 0;
    if (gameFilter !== null && gameIndex !== gameFilter) continue;
    const userPhysicalSide = physicalSideForGame(userSide, gameIndex);

    // 1. Who served, from the scored rotation.
    const server = serving.get(point.id)?.server ?? null;
    if (server === null) continue;
    const serverSide =
      server === "user"
        ? userPhysicalSide
        : otherSide(userPhysicalSide);
    const receiverSide = otherSide(serverSide);

    const hypothesis = selectPlacementHypothesis(
      placement,
      serverSide,
    );
    if (hypothesis === null) continue;
    const serve = hypothesis.shots.find(
      (shot) => shot.phase === "serve",
    );
    if (serve === undefined) continue;

    // 2. A landing with real coordinates.
    const landing = serve.landing;
    if (
      landing === null
      || typeof landing.u !== "number"
      || typeof landing.v !== "number"
    ) {
      continue;
    }

    // 3 and 4. On the receiver's half, and on the table at all. A serve
    // that projects off the table is a calibration failure, not a short
    // serve, and it is the one thing that makes a map look broken.
    if (!insideTheTable(landing.u, landing.v)) continue;
    if (halfForV(landing.v) !== receiverSide) continue;

    // 6. The independent read of who served. Only when the server's own
    // bounce was found — most serves have one, and the ones that do not
    // are not evidence of anything.
    const first = serve.serve_first_bounce;
    if (
      first !== null
      && typeof first.v === "number"
      && halfForV(first.v) !== serverSide
    ) {
      continue;
    }

    // 5. The two bounces are CONSECUTIVE: nothing else touched the table
    // between the serve's own bounce and where it landed. That is the
    // physical shape of a serve, and it is what stops a mid-rally ball
    // from being drawn as one.
    //
    // Counting from the start of the point instead — "the landing is the
    // first or second bounce" — reads plausibly and is wrong. Clips open
    // before the serve: the server bounces the ball on the table a couple
    // of times first, and the pad on the front of the clip often carries
    // the tail of the previous rally. Measured on the Chris match, that
    // reading threw away 18 serves whose two bounces were a textbook
    // server-half-then-receiver-half pair, simply because a ball had
    // touched the table earlier in the clip.
    //
    // With no first bounce there is nothing to be consecutive to, so fall
    // back to the ordinal: nothing has happened yet that early.
    //
    // With no candidate list the question cannot be asked at all, and the
    // serve is drawn on the strength of the other five. That is a real
    // loosening and it is the lesser one: measured on the Chris match,
    // rule five removes exactly one point that rules 1-4 and 6 admit,
    // whereas refusing every serve would empty the map completely.
    const ordinals = bounceOrdinals(placement);
    if (ordinals !== null) {
      const landingOrdinal =
        landing.event_id === null
          ? undefined
          : ordinals.get(landing.event_id);
      if (landingOrdinal === undefined) continue;
      const firstOrdinal =
        first === null || first.event_id === null
          ? undefined
          : ordinals.get(first.event_id);
      if (firstOrdinal === undefined) {
        if (landingOrdinal > SERVE_LANDING_MAX_BOUNCE_INDEX) continue;
      } else if (landingOrdinal - firstOrdinal !== 1) {
        continue;
      }
    }

    const filter: PlacementAggregateFilter =
      serverSide === userPhysicalSide ? "myServes" : "theirServes";
    const normalized = normalizePlacementCoordinates(
      landing.u,
      landing.v,
      userPhysicalSide,
    );
    const zone = classifyPlacementZone(
      normalized.u,
      normalized.v,
      filter,
    );
    if (zone === null) continue;

    observations.push({
      pointId: point.id,
      shotSeq: serve.seq,
      filter,
      zone,
      u: normalized.u,
      v: normalized.v,
      // Reported, never gated on. The number is honest evidence
      // confidence; the six rules above are the verdict.
      confidence: Math.min(serve.confidence, landing.confidence),
    });
  }
  return observations;
}
