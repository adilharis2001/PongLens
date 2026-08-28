/**
 * Which detected side-change markers get drawn, and where.
 *
 * The worker watches the two players and records where they swapped ends
 * of the table (worker/side_change.py). Under the rules that is how a
 * game ends. This decides which of those detections becomes a marker on
 * screen — between two rallies in Keep score's strip, and between two
 * cards in the point list.
 *
 * THE MARKER NEVER CHANGES THE SCORE. It is not folded into the boundary
 * walk in gameScore.ts and a match nobody touches scores exactly as it
 * did before this existed. The only way detector evidence reaches the
 * score is the owner tapping "Game ended here", which writes the same
 * points.game_end_override = 'end' they could have pinned by hand.
 *
 * That is a deliberate reversal of the 2026-07 design, which is still
 * sitting dormant in matchStructure.ts: resolveMatchBoundaries took v1
 * evidence and silently rewrote where games ended. A detector that is
 * right 87% of the time and edits the score is worse than no detector,
 * because the other 13% is invisible and lands on the one number the
 * player came for.
 *
 * The rule exists TWICE — here and in ios/PongLens/PongLens/Core/
 * SideChanges.swift — so it carries a parity fixture rather than two
 * readings of the same paragraph. See sideChanges.test.ts.
 */
import type { MatchStructureEvidence, Point } from "@/lib/types";
import type { GameBoundary } from "./gameScore.ts";

/**
 * What the marker says. "Players changed ends" rather than "Game end
 * detected", because in a deciding game the players swap at 5 points and
 * the detector cannot tell that from a game ending — there is no score to
 * consult, and on an unscored match we do not even know it is the
 * deciding game. This wording is true in every case; the interpretation
 * moves into the sheet, where the button says "Game ended here" and the
 * judgement is the owner's.
 */
export const SIDE_CHANGE_LABEL = "Players changed ends";

/** The short form, for the Keep-score strip where four characters is the
 *  budget (the score divider's pill holds "11-7" at 9px). */
export const SIDE_CHANGE_SHORT = "ends";

/**
 * How near a real game boundary silences a detected one, in visible
 * rallies either side.
 *
 * Three, because three is what the owner's own scoring drifts by. Over 49
 * confirmed fires, six landed one to four rallies from the scored
 * boundary and every one of those six fired on a LONGER break than the
 * score had (22.5s against 1.2s, 34.0s against 9.7s, 57.5s against 3.5s)
 * — the changeover is the long gap, and the score is what moved. Two
 * dividers three rallies apart are the same event drawn twice, so the one
 * the score proves wins and the detected one disappears.
 *
 * This is what makes the marker fade as a match gets scored: an unscored
 * match shows every detection, and each one goes quiet as the scorer
 * reaches the game it belongs to.
 */
export const SCORE_BOUNDARY_SUPPRESS = 3;

/** Slack when matching a gap time to a rally's end, in SOURCE seconds. */
const GAP_MATCH_TOLERANCE_S = 0.25;

export interface SideChangeMarker {
  /** The visible point this marker is drawn AFTER. */
  pointId: string;
  /** The detector's own confidence, 0..1. Not rendered; kept for review. */
  confidence: number;
  /** How the marker found its point — `gap_time` means the rally the
   *  detector named has since been deleted and this was recovered. */
  anchor: "point_id" | "gap_time";
}

export interface SideChangeInput {
  evidence: MatchStructureEvidence | null | undefined;
  /** The same list the dividers are drawn over: deleted points excluded,
   *  in match order. */
  visiblePoints: Pick<
    Point,
    "id" | "t1" | "game_end_override" | "side_change_dismissed"
  >[];
  /** score.boundaryAfter from the shared walk in gameScore.ts. */
  boundaryAfter: ReadonlyMap<string, GameBoundary>;
  /** app_config.game_end_detection === 'on'. */
  enabled: boolean;
  /** tracksServe(match.match_type): games are a scored-match construct. */
  scoredType: boolean;
}

/**
 * Rules, in the order they are applied. Each one is here because of
 * something that went wrong, in this project or in the research behind it.
 *
 *  1. flag off                  -> nothing at all
 *  2. not a scored match type   -> nothing (drills and practice: players
 *                                  routinely do not change ends)
 *  3. evidence not 'ready'      -> nothing (a withheld match is one the
 *                                  detector refused, and refusing is the
 *                                  feature)
 *  4. change not confirmed      -> skip it (everything else is
 *                                  diagnostics and must never be drawn)
 *  5. anchor to a visible point -> by id, else recovered from gap_t0,
 *                                  else dropped
 *  6. a real boundary within 3  -> drop (the score proved it; two
 *                                  dividers for one event read as a bug)
 *  7. an owner answer within 3  -> drop (they have already ruled here)
 *  8. dismissed on the anchor   -> drop
 *
 * Six and seven look alike and are not the same test: a 'continue' pin
 * satisfies seven and produces no boundary at all, so six would let it
 * through.
 */
export function visibleSideChanges(input: SideChangeInput): SideChangeMarker[] {
  const { evidence, visiblePoints, boundaryAfter, enabled, scoredType } = input;
  if (!enabled || !scoredType) return [];                        // 1, 2
  if (!evidence || evidence.status !== "ready") return [];        // 3
  const changes = evidence.side_changes ?? [];
  if (changes.length === 0) return [];

  const positionById = new Map<string, number>();
  visiblePoints.forEach((point, index) => positionById.set(point.id, index));

  const markers: SideChangeMarker[] = [];
  const claimed = new Set<number>();

  for (const change of changes) {
    if (!change.confirmed) continue;                              // 4

    let position: number | undefined;
    let anchor: SideChangeMarker["anchor"] = "point_id";
    if (change.after_point_id !== undefined) {
      position = positionById.get(change.after_point_id);
    }
    if (position === undefined && change.gap_t0 !== undefined) {
      // The rally the detector named has been deleted since. Its END time
      // is still a place in the match, and both clocks are SOURCE seconds
      // with alignment already established worker-side (map_point_ids
      // stores gap_t0 for exactly this), so the last rally that finished
      // at or before the gap is the same position.
      const limit = change.gap_t0 + GAP_MATCH_TOLERANCE_S;
      for (let i = visiblePoints.length - 1; i >= 0; i -= 1) {
        const t1 = visiblePoints[i].t1;
        if (t1 !== null && t1 <= limit) {
          position = i;
          anchor = "gap_time";
          break;
        }
      }
    }
    if (position === undefined) continue;                         // 5
    // The very last rally has nothing after it, so there is no "between"
    // for a marker to sit in.
    if (position >= visiblePoints.length - 1) continue;
    if (claimed.has(position)) continue;

    const lower = Math.max(0, position - SCORE_BOUNDARY_SUPPRESS);
    const upper = Math.min(
      visiblePoints.length - 1,
      position + SCORE_BOUNDARY_SUPPRESS
    );
    let silenced = false;
    for (let i = lower; i <= upper; i += 1) {
      const point = visiblePoints[i];
      if (boundaryAfter.has(point.id)) { silenced = true; break; } // 6
      if (point.game_end_override !== null) { silenced = true; break; } // 7
    }
    if (silenced) continue;
    if (visiblePoints[position].side_change_dismissed) continue;   // 8

    claimed.add(position);
    markers.push({
      pointId: visiblePoints[position].id,
      confidence: change.confidence,
      anchor,
    });
  }
  return markers;
}

/** Markers keyed by the point they follow, which is how both surfaces
 *  render: one lookup per row rather than a scan per row. */
export function sideChangesByPoint(
  input: SideChangeInput
): Map<string, SideChangeMarker> {
  return new Map(
    visibleSideChanges(input).map((marker) => [marker.pointId, marker])
  );
}
