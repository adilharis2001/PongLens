import type {
  PlacementEventV3,
  PlacementHypothesisV3,
  PlacementTerminalV3,
  PlacementV3,
} from "../types.ts";


export type PlacementPhaseFilter = {
  serve: boolean;
  rally: boolean;
  final: boolean;
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
  hiddenCounts: {
    serve: number;
    rally: number;
    final: number;
  };
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
  filters: PlacementPhaseFilter,
): PlacementRenderModel {
  const hiddenCounts = { serve: 0, rally: 0, final: 0 };
  if (
    hypothesis.status === "unavailable"
    || hypothesis.hard_reasons.length > 0
  ) {
    return {
      status: hypothesis.status,
      confidence: hypothesis.confidence,
      reasons: hypothesis.reasons,
      segments: [],
      hiddenCounts,
    };
  }

  const shots = hypothesis.shots;
  const phases = shots.map((shot, index) =>
    effectivePhase(shot, index, shots.length)
  );
  const visible = phases.map((phase) => filters[phase]);
  phases.forEach((phase, index) => {
    if (!visible[index]) hiddenCounts[phase] += 1;
  });

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
    hiddenCounts,
  };
}
