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
  /**
   * Where the ball carried to after this bounce: the same heading extended
   * on to the receiver's baseline. Drawn DOTTED — it is derived from the
   * two measured bounces, not observed, and it is where the ball crossed
   * the line rather than where the player stood. Null when the direction
   * cannot be established, in which case the next shot falls back to
   * starting from this bounce.
   */
  carryTo: PlacementMapPoint | null;
  terminal: PlacementTerminalV3 | null;
  confidence: number;
}

/** Table edges in metres; the carry always ends on one of the baselines. */
const NEAR_BASELINE_V = 0;
const FAR_BASELINE_V = 2.74;

/**
 * How far past a bounce the ball may be extrapolated, as a multiple of the
 * flight that reached it. A nearly-flat trajectory would otherwise project
 * halfway across the room off a rounding error; three is generous for a
 * real carry and refuses the degenerate cases outright.
 */
const MAX_CARRY = 3;

/**
 * Extend the flight THROUGH a bounce to the far baseline.
 *
 * A bounce reverses the ball's vertical velocity and leaves the horizontal
 * alone, so seen from above the heading is unchanged — the same straight
 * line simply continues. That is what makes this derivable rather than
 * invented: both ends of the incoming flight are measured bounces.
 *
 * It replaces joining bounce to bounce, which drew the ball teleporting
 * across the net from where it landed. Nobody hits the ball where it
 * bounced; they hit it at the end of the table, after it has carried on to
 * them, and the return starts from THERE.
 */
function carryThrough(
  from: PlacementMapPoint,
  landing: PlacementMapPoint,
  baselineV: number,
): PlacementMapPoint | null {
  const dv = landing.v - from.v;
  if (Math.abs(dv) < 1e-6) return null;
  const t = (baselineV - landing.v) / dv;
  // t <= 0 means the bounce is already at or past the baseline it would
  // carry to — a mis-ordered or edge-of-table reconstruction, not a carry.
  if (t <= 0 || t > MAX_CARRY) return null;
  return { u: landing.u + t * (landing.u - from.u), v: baselineV };
}

/**
 * The serve's origin, extrapolated BACKWARD from its first bounce.
 *
 * A legal serve bounces on the server's own half first, so first-bounce
 * and landing are two measured points on one straight heading; running it
 * back to the server's baseline says where the serve was actually struck
 * from. The old code placed every serve at the centre of the baseline
 * regardless — on a real serve measured here, wrong by 37cm.
 */
function serveOrigin(
  firstBounce: PlacementMapPoint,
  landing: PlacementMapPoint,
  baselineV: number,
): PlacementMapPoint | null {
  const dv = landing.v - firstBounce.v;
  if (Math.abs(dv) < 1e-6) return null;
  const t = (baselineV - firstBounce.v) / dv;
  if (t >= 0 || t < -MAX_CARRY) return null;
  return { u: firstBounce.u + t * (landing.u - firstBounce.u), v: baselineV };
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
  // Where the previous shot carried the ball to — the point the next shot
  // is actually struck from. Falls back to the previous bounce whenever the
  // carry cannot be derived, which is the old bounce-to-bounce behaviour.
  let carriedFrom: PlacementMapPoint | null = null;

  shots.forEach((shot, index) => {
    const landing = eventPoint(shot.landing);
    // The ball crosses to the hitter's opposite side, so it carries on to
    // THAT baseline — where the receiver takes it.
    const receiverBaseline =
      shot.hitter_side === "near" ? FAR_BASELINE_V : NEAR_BASELINE_V;

    let from: PlacementMapPoint | null = null;
    let fromContext = false;
    if (shot.phase === "serve") {
      const firstBounce = eventPoint(shot.serve_first_bounce);
      const serverBaseline =
        hypothesis.serverSide === "near" ? NEAR_BASELINE_V : FAR_BASELINE_V;
      if (firstBounce && landing) {
        from = serveOrigin(firstBounce, landing, serverBaseline);
      }
      // No first bounce to reason from: the centre of the server's baseline
      // is still better than starting the serve from nowhere.
      if (!from && landing) {
        from = { u: 1.525 / 2, v: serverBaseline };
      }
    } else if (carriedFrom) {
      from = carriedFrom;
    } else {
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        const priorLanding = eventPoint(shots[previous].landing);
        if (!priorLanding) continue;
        from = priorLanding;
        fromContext = !visible[previous];
        break;
      }
    }

    // Carry this bounce on to the receiver, for the next shot to start from.
    carriedFrom =
      from && landing
        ? carryThrough(from, landing, receiverBaseline)
        : null;

    if (!visible[index]) return;
    if (landing === null && shot.terminal === null) return;
    segments.push({
      shotId: shot.id,
      shotNumber: index + 1,
      hitterSide: shot.hitter_side,
      phase: phases[index],
      from,
      to: landing,
      fromContext,
      carryTo: carriedFrom,
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
