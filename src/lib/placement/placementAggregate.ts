import type { Point } from "../types.ts";
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

export function normalizePlacementCoordinates(
  u: number,
  v: number,
  userPhysicalSide: PlacementPhysicalSide,
) {
  return userPhysicalSide === "near"
    ? { u: TABLE_WIDTH_M - u, v }
    : { u, v: TABLE_LENGTH_M - v };
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
