export type InferredBounceTimeMethod =
  | "weak_reversal"
  | "subthreshold_curvature"
  | "occlusion_bridge"
  | "serve_flight_order";

export type InferredBounceContext =
  | "serve_first_bounce"
  | "mid_rally"
  | "unknown";

export type InferredBounceConfidenceTier =
  | "high"
  | "medium"
  | "diagnostic";

export type InferredBouncePreferredHypothesis =
  | "latent_bounce"
  | "continuous_airborne"
  | "indeterminate";

export type InferredBounceMissReason =
  | "below_reversal_threshold"
  | "below_motion_threshold"
  | "track_gap_at_event"
  | "candidate_not_offered"
  | "masked_for_evaluation"
  | "unknown";

export interface InferredBounceDiagnosticItem {
  kind: string;
  strength: number;
  detail?: string;
  [measurement: string]: string | number | undefined;
}
export interface InferredBounceTablePosition {
  u_m: number;
  v_m: number;
  uncertainty_radius_m: number;
  method: "observed_contact_frame" | "two_sided_track_fit";
}

export interface InferredBounceCandidate {
  id: string;
  time: {
    estimate_s: number;
    interval_s: [number, number];
    method: InferredBounceTimeMethod;
  };
  table_position: InferredBounceTablePosition | null;
  context: InferredBounceContext;
  confidence: {
    score: number;
    tier: InferredBounceConfidenceTier;
  };
  hypothesis_comparison: {
    preferred: InferredBouncePreferredHypothesis;
    continuous_airborne_cost: number;
    latent_bounce_cost: number;
    margin: number;
  };
  support: InferredBounceDiagnosticItem[];
  vetoes: InferredBounceDiagnosticItem[];
  normal_detector_miss: {
    reason: InferredBounceMissReason;
    detail: string;
  };
  trajectory_constraint: {
    safe_to_constrain_z0: boolean;
    mode: "hard_z0" | "display_only";
    reason: string;
  };
}

export interface InferredBounceEvidence {
  schema_version: 1;
  detector_version: string;
  clock: "source_seconds";
  candidates: InferredBounceCandidate[];
}

const TIME_METHODS = new Set<InferredBounceTimeMethod>([
  "weak_reversal",
  "subthreshold_curvature",
  "occlusion_bridge",
  "serve_flight_order",
]);
const POSITION_METHODS = new Set<InferredBounceTablePosition["method"]>([
  "observed_contact_frame",
  "two_sided_track_fit",
]);
const CONTEXTS = new Set<InferredBounceContext>([
  "serve_first_bounce",
  "mid_rally",
  "unknown",
]);
const TIERS = new Set<InferredBounceConfidenceTier>([
  "high",
  "medium",
  "diagnostic",
]);
const HYPOTHESES = new Set<InferredBouncePreferredHypothesis>([
  "latent_bounce",
  "continuous_airborne",
  "indeterminate",
]);
const MISS_REASONS = new Set<InferredBounceMissReason>([
  "below_reversal_threshold",
  "below_motion_threshold",
  "track_gap_at_event",
  "candidate_not_offered",
  "masked_for_evaluation",
  "unknown",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalized(value: unknown): value is number {
  return finiteNumber(value) && value >= 0 && value <= 1;
}

function oneOf<T extends string>(value: unknown, choices: Set<T>): value is T {
  return typeof value === "string" && choices.has(value as T);
}

function hasExactly(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function validDiagnosticItems(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((raw) => {
    if (!isRecord(raw) || typeof raw.kind !== "string" || !raw.kind ||
        !normalized(raw.strength)) {
      return false;
    }
    return Object.entries(raw).every(([key, item]) => {
      if (key === "kind") return typeof item === "string" && item.length > 0;
      if (key === "detail") return typeof item === "string";
      return finiteNumber(item);
    });
  });
}

function validTime(value: unknown): boolean {
  if (!isRecord(value) || !finiteNumber(value.estimate_s) ||
      !Array.isArray(value.interval_s) || value.interval_s.length !== 2 ||
      !finiteNumber(value.interval_s[0]) ||
      !finiteNumber(value.interval_s[1]) ||
      !oneOf(value.method, TIME_METHODS)) {
    return false;
  }
  return value.interval_s[0] <= value.estimate_s &&
    value.estimate_s <= value.interval_s[1];
}

function validTablePosition(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || !hasExactly(value, [
    "u_m", "v_m", "uncertainty_radius_m", "method",
  ])) {
    return false;
  }
  return finiteNumber(value.u_m) && finiteNumber(value.v_m) &&
    finiteNumber(value.uncertainty_radius_m) &&
    value.uncertainty_radius_m >= 0 &&
    oneOf(value.method, POSITION_METHODS);
}

function validConfidence(value: unknown): boolean {
  return isRecord(value) && normalized(value.score) &&
    oneOf(value.tier, TIERS);
}

function validComparison(value: unknown): boolean {
  return isRecord(value) && oneOf(value.preferred, HYPOTHESES) &&
    finiteNumber(value.continuous_airborne_cost) &&
    finiteNumber(value.latent_bounce_cost) && finiteNumber(value.margin);
}

function validMiss(value: unknown): boolean {
  return isRecord(value) && oneOf(value.reason, MISS_REASONS) &&
    typeof value.detail === "string";
}

function validConstraint(value: unknown): boolean {
  if (!isRecord(value) || typeof value.safe_to_constrain_z0 !== "boolean" ||
      (value.mode !== "hard_z0" && value.mode !== "display_only") ||
      typeof value.reason !== "string") {
    return false;
  }
  return value.safe_to_constrain_z0 === (value.mode === "hard_z0");
}

function validCandidate(value: unknown): value is InferredBounceCandidate {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 &&
    validTime(value.time) && validTablePosition(value.table_position) &&
    oneOf(value.context, CONTEXTS) && validConfidence(value.confidence) &&
    validComparison(value.hypothesis_comparison) &&
    validDiagnosticItems(value.support) && validDiagnosticItems(value.vetoes) &&
    validMiss(value.normal_detector_miss) &&
    validConstraint(value.trajectory_constraint);
}

/**
 * Read the worker's additive schema without inventing missing values.
 * Invalid or unknown payloads are absent evidence, never partial evidence.
 */
export function readInferredBounceEvidence(
  value: unknown
): InferredBounceEvidence | null {
  if (!isRecord(value) || value.schema_version !== 1 ||
      typeof value.detector_version !== "string" ||
      value.detector_version.length === 0 || value.clock !== "source_seconds" ||
      !Array.isArray(value.candidates) ||
      !value.candidates.every(validCandidate)) {
    return null;
  }
  return value as unknown as InferredBounceEvidence;
}
