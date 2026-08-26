import type {
  Match,
  MatchEndChangeEvidence,
  MatchStructureEvidence,
  Point,
  SideChangeEvidence,
} from "@/lib/types";
import {
  computeMatchScore,
  type GameEndOverride,
} from "./gameScore.ts";
import type { MatchServer } from "./serving.ts";

export interface ResolvedFirstServer {
  server: MatchServer | null;
  source: "user" | "detected" | "unknown";
}

export interface ResolvedBoundaries {
  /** Detection-only overrides. Point-level user overrides remain on Point. */
  effectiveOverrides: Map<string, GameEndOverride>;
  provenance: Map<string, "user" | "detected" | "score-confirmed">;
  boundaryAfter: Set<string>;
  unresolved: MatchEndChangeEvidence[];
}

/**
 * Whether detected game-end indicators may show on this match at all.
 *
 * Three gates, every one deliberate:
 *  - the app_config flag (read server-side, passed down) — rollback is
 *    one UPDATE;
 *  - competitive content only: match, league or tournament. A missing
 *    type FAILS SAFE to no indicators, even though the rest of the app
 *    treats untyped as scoreable — an indicator is a claim about the
 *    footage, and we don't make claims about footage nobody classified;
 *  - the match is UNSCORED: no confirmed winner and no user game
 *    boundary anywhere. The moment the owner scores a point or pins a
 *    boundary they are doing the job themselves, and the real dividers
 *    take over. Detection stays out of the way.
 */
export function gameEndIndicatorsEligible(
  matchType: Match["match_type"],
  points: Pick<Point, "confirmed_winner" | "game_end_override">[],
  flagOn: boolean
): boolean {
  if (!flagOn) return false;
  if (
    matchType !== "match" &&
    matchType !== "league" &&
    matchType !== "tournament"
  ) {
    return false;
  }
  return points.every(
    (point) =>
      point.confirmed_winner === null && point.game_end_override === null
  );
}

/**
 * point id -> the confirmed detected side change sitting AFTER that
 * visible point. Purely informational: nothing here feeds scoring,
 * serving or game numbering.
 *
 * Placement is by point id when the referenced point is still visible,
 * else by time (the evidence's gap start against t1), so an indicator
 * survives the owner deleting the junk card the worker referenced. A
 * change that would land after the last visible point is dropped —
 * "the match ended" is not a boundary between two things.
 */
export function resolveDetectedGameEnds(
  visiblePoints: Point[],
  evidence: MatchStructureEvidence | null | undefined
): Map<string, SideChangeEvidence> {
  const out = new Map<string, SideChangeEvidence>();
  if (
    !evidence ||
    evidence.algorithm !== "side-change-v2" ||
    evidence.status !== "ready"
  ) {
    return out;
  }
  const positions = new Map(
    visiblePoints.map((point, index) => [point.id, index])
  );
  for (const change of evidence.side_changes ?? []) {
    if (!change.confirmed) continue;
    let position = change.after_point_id
      ? positions.get(change.after_point_id)
      : undefined;
    if (position === undefined && typeof change.gap_t0 === "number") {
      for (let i = visiblePoints.length - 1; i >= 0; i--) {
        const t1 = visiblePoints[i].t1;
        if (t1 !== null && Number(t1) <= change.gap_t0 + 0.5) {
          position = i;
          break;
        }
      }
    }
    if (position === undefined || position >= visiblePoints.length - 1) {
      continue;
    }
    const id = visiblePoints[position].id;
    const existing = out.get(id);
    if (!existing || change.confidence > existing.confidence) {
      out.set(id, change);
    }
  }
  return out;
}

/** Manual scoring must never silently trust a detector-authored value. */
export function userConfirmedFirstServer(
  match: Pick<Match, "first_server" | "first_server_source">
): MatchServer | null {
  return match.first_server_source === "detected"
    ? null
    : match.first_server;
}

/** A setup-sheet answer is authoritative over any dormant detector. */
export function userFirstServerUpdate(server: MatchServer) {
  return {
    first_server: server,
    first_server_source: "user" as const,
  };
}

export function resolveFirstServer(
  match: Pick<
    Match,
    "first_server" | "first_server_source" | "user_side" | "match_structure"
  >,
  enabled: boolean
): ResolvedFirstServer {
  if (match.first_server_source === "user" && match.first_server) {
    return { server: match.first_server, source: "user" };
  }
  const detected = match.match_structure?.first_server;
  if (
    enabled &&
    detected?.status === "high_confidence" &&
    detected.side &&
    match.user_side
  ) {
    return {
      server: detected.side === match.user_side ? "user" : "opponent",
      source: "detected",
    };
  }
  if (match.first_server) {
    return {
      server: match.first_server,
      source:
        match.first_server_source === "detected" ? "detected" : "user",
    };
  }
  return { server: null, source: "unknown" };
}

function evidenceUsable(
  evidence: MatchStructureEvidence | null,
  enabled: boolean
): evidence is MatchStructureEvidence {
  if (!enabled || evidence?.status !== "ready") return false;
  const coverage = evidence.coverage;
  return !!coverage &&
    coverage.total > 0 &&
    (coverage.high_confidence ?? 0) / coverage.total >= 0.9;
}

function isDecidingGameEndChange(points: Point[], candidatePosition: number) {
  const beforeCandidate = points.slice(0, candidatePosition + 1);
  const score = computeMatchScore(beforeCandidate);
  return (
    score.gamesYou > 0 &&
    score.gamesYou === score.gamesThem &&
    score.current.you < 11 &&
    score.current.them < 11 &&
    (score.current.you === 5 || score.current.them === 5)
  );
}

export function resolveMatchBoundaries(
  points: Point[],
  evidence: MatchStructureEvidence | null,
  enabled: boolean
): ResolvedBoundaries {
  const effectiveOverrides = new Map<string, GameEndOverride>();
  const provenance = new Map<
    string,
    "user" | "detected" | "score-confirmed"
  >();
  const changes = evidence?.end_changes ?? [];

  for (const point of points) {
    if (point.game_end_override) provenance.set(point.id, "user");
  }

  if (!evidenceUsable(evidence, enabled)) {
    const score = computeMatchScore(points);
    return {
      effectiveOverrides,
      provenance,
      boundaryAfter: new Set(score.boundaryAfter.keys()),
      unresolved: [...changes],
    };
  }

  const positions = new Map(points.map((point, index) => [point.id, index]));
  const provisional = computeMatchScore(points);
  const scoreBoundaries = [...provisional.boundaryAfter.keys()]
    .map((id) => ({ id, position: positions.get(id) }))
    .filter(
      (entry): entry is { id: string; position: number } =>
        entry.position !== undefined
    );
  const pairedScoreBoundaries = new Set<string>();
  const unresolved: MatchEndChangeEvidence[] = [];

  const orderedChanges = [...changes].sort(
    (a, b) => a.before_idx - b.before_idx
  );
  for (const change of orderedChanges) {
    const afterPosition = change.after_point_id
      ? positions.get(change.after_point_id)
      : undefined;
    const beforePosition = change.before_point_id
      ? positions.get(change.before_point_id)
      : undefined;
    if (afterPosition === undefined || beforePosition === undefined) {
      unresolved.push(change);
      continue;
    }

    const bracketed = scoreBoundaries.find(
      (boundary) =>
        !pairedScoreBoundaries.has(boundary.id) &&
        boundary.position > afterPosition &&
        boundary.position < beforePosition
    );
    if (bracketed) {
      pairedScoreBoundaries.add(bracketed.id);
      provenance.set(bracketed.id, "score-confirmed");
      continue;
    }

    if (beforePosition !== afterPosition + 1) {
      unresolved.push(change);
      continue;
    }
    if (isDecidingGameEndChange(points, afterPosition)) {
      unresolved.push(change);
      continue;
    }

    const nearestScoreBoundary = scoreBoundaries
      .filter((boundary) => !pairedScoreBoundaries.has(boundary.id))
      .sort(
        (a, b) =>
          Math.abs(a.position - afterPosition) -
          Math.abs(b.position - afterPosition)
      )[0];
    const lower = Math.min(
      afterPosition,
      nearestScoreBoundary?.position ?? afterPosition
    );
    const upper = Math.max(
      beforePosition,
      nearestScoreBoundary?.position ?? beforePosition
    );
    const userResolved = points
      .slice(lower, upper + 1)
      .some((point) => point.game_end_override !== null);
    if (userResolved) continue;

    if (nearestScoreBoundary) {
      pairedScoreBoundaries.add(nearestScoreBoundary.id);
      if (nearestScoreBoundary.position < afterPosition) {
        effectiveOverrides.set(nearestScoreBoundary.id, "continue");
      }
    }
    effectiveOverrides.set(points[afterPosition].id, "end");
    provenance.set(points[afterPosition].id, "detected");
  }

  const resolvedScore = computeMatchScore(points, effectiveOverrides);
  return {
    effectiveOverrides,
    provenance,
    boundaryAfter: new Set(resolvedScore.boundaryAfter.keys()),
    unresolved,
  };
}
