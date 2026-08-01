import type {
  PlacementEventV3,
  PlacementHypothesisV3,
  PlacementTerminalV3,
  PlacementV3,
} from "../types.ts";


/**
 * How much of the rally to draw: shots 1..through, or all of it.
 *
 * A CUTOFF rather than the three phase toggles it replaces (serve / rally /
 * final, each independently on or off). Past a handful of shots a whole
 * trajectory is a scribble, and the way out is to walk the rally forward
 * one shot at a time — which needs an ordinal, not a category.
 *
 * The trade, stated plainly: a phase can no longer be isolated on a single
 * point ("just the final shot" is gone). Cross-point questions of that
 * shape belong to the aggregate map, which keeps its own serve/rally
 * filters; on ONE point, watching it build is the readable thing.
 */
export type PlacementShotFilter = {
  /** 1-based count of shots to show; null shows every shot. */
  through: number | null;
};

export type PlacementMapPoint = { u: number; v: number };

export interface PlacementRenderSegment {
  shotId: string;
  shotNumber: number;
  hitterSide: "near" | "far";
  phase: "serve" | "rally" | "final";
  from: PlacementMapPoint | null;
  to: PlacementMapPoint | null;
  fromContext: boolean;
  terminal: PlacementTerminalV3 | null;
  confidence: number;
}

export interface PlacementRenderModel {
  status: PlacementHypothesisV3["status"];
  confidence: number;
  reasons: string[];
  segments: PlacementRenderSegment[];
  /** Shots the cutoff admits — what the caption counts. */
  shownCount: number;
  /** Shots the rally actually has, cutoff or not. */
  totalCount: number;
}

export type PlacementNotice = {
  mode: "hidden" | "review";
  message: string;
};

export function placementNotice(
  hypothesis: PlacementHypothesisV3,
): PlacementNotice | null {
  if (
    hypothesis.status === "unavailable"
    || hypothesis.hard_reasons.length > 0
  ) {
    return {
      mode: "hidden",
      message:
        "A placement map couldn’t be generated for this point because the ball path was difficult to track.",
    };
  }
  if (hypothesis.status === "review") {
    return {
      mode: "review",
      message:
        "This placement map may be less accurate because the ball path was difficult to track.",
    };
  }
  return null;
}

function eventPoint(event: PlacementEventV3 | null): PlacementMapPoint | null {
  if (
    event === null
    || typeof event.u !== "number"
    || typeof event.v !== "number"
  ) {
    return null;
  }
  return { u: event.u, v: event.v };
}

export function selectPlacementHypothesis(
  placement: PlacementV3,
  serverSide: "near" | "far" | null,
): PlacementHypothesisV3 | null {
  if (serverSide) return placement.hypotheses[serverSide];

  const ordered = Object.values(placement.hypotheses)
    .filter((hypothesis) => hypothesis.hard_reasons.length === 0)
    .sort((a, b) => b.confidence - a.confidence);
  const [best, second] = ordered;
  if (!best || best.status === "unavailable") return null;
  if (second && best.confidence - second.confidence < 0.18) return null;
  return best;
}

function effectivePhase(
  shot: PlacementHypothesisV3["shots"][number],
  index: number,
  count: number,
): PlacementRenderSegment["phase"] {
  if (shot.phase === "serve") return "serve";
  if (shot.phase === "final") return "final";
  return index === count - 1 ? "final" : "rally";
}

export function buildPlacementRenderModel(
  hypothesis: PlacementHypothesisV3,
  filter: PlacementShotFilter,
): PlacementRenderModel {
  if (
    hypothesis.status === "unavailable"
    || hypothesis.hard_reasons.length > 0
  ) {
    return {
      status: hypothesis.status,
      confidence: hypothesis.confidence,
      reasons: hypothesis.reasons,
      segments: [],
      shownCount: 0,
      totalCount: 0,
    };
  }

  const shots = hypothesis.shots;
  const phases = shots.map((shot, index) =>
    effectivePhase(shot, index, shots.length)
  );
  // A cutoff past the end, or null, is simply the whole rally — the strip
  // never has to clamp itself against a shot count it does not know.
  const shownCount =
    filter.through === null
      ? shots.length
      : Math.max(0, Math.min(filter.through, shots.length));
  const visible = shots.map((_, index) => index < shownCount);

  const segments: PlacementRenderSegment[] = [];
  shots.forEach((shot, index) => {
    if (!visible[index]) return;

    let from: PlacementMapPoint | null = null;
    let fromContext = false;
    if (shot.phase === "serve") {
      if (eventPoint(shot.landing)) {
        from = {
          u: 1.525 / 2,
          v: hypothesis.serverSide === "near" ? 0 : 2.74,
        };
      }
    } else {
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        const priorLanding = eventPoint(shots[previous].landing);
        if (!priorLanding) continue;
        from = priorLanding;
        fromContext = !visible[previous];
        break;
      }
    }

    const to = eventPoint(shot.landing);
    if (to === null && shot.terminal === null) return;
    segments.push({
      shotId: shot.id,
      shotNumber: index + 1,
      hitterSide: shot.hitter_side,
      phase: phases[index],
      from,
      to,
      fromContext,
      terminal: shot.terminal,
      confidence: shot.confidence,
    });
  });

  return {
    status: hypothesis.status,
    confidence: hypothesis.confidence,
    reasons: hypothesis.reasons,
    segments,
    shownCount,
    totalCount: shots.length,
  };
}
