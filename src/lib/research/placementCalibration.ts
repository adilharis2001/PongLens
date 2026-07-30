export const TABLE_WIDTH_M = 1.525;
export const TABLE_LENGTH_M = 2.74;

export type PlacementCalibrationResult =
  | "landed"
  | "not_visible"
  | "wrong_event"
  | "no_table_bounce"
  | "excluded";

export type PlacementVisibility = "clear" | "estimated";
export type PlacementConfidence = "certain" | "likely" | "unsure";
export type PlacementServer = "user" | "opponent";
export type PlacementPredictionIncompatibilityReason =
  | "server_corrected"
  | "shot_owner_inconsistent";
export type PlacementExclusionReason =
  | "net_contact"
  | "not_a_point"
  | "wrong_clip_or_event"
  | "other";

export interface PlacementPoint {
  u: number;
  v: number;
}

export interface PlacementPrediction extends PlacementPoint {
  confidence: number | null;
  zone: string | null;
}

export interface PlacementCalibrationProposal {
  schema_version: 1;
  event_id: string;
  event_time_s: number;
  event_description: string;
  phase: "serve" | "return" | "rally";
  shot_seq: number;
  scored_server: PlacementServer;
  hitter_side: "near" | "far";
  receiver_side: "near" | "far";
  user_side: "near" | "far";
  predictions: {
    legacy_current: PlacementPrediction | null;
    canonical_current: PlacementPrediction | null;
    openai: PlacementPrediction | null;
  };
}

export interface PlacementBlindSnapshot {
  result: PlacementCalibrationResult;
  table_u: number | null;
  table_v: number | null;
  visibility: PlacementVisibility | null;
  confidence: PlacementConfidence | null;
  exclusion_reason: PlacementExclusionReason | null;
}

export interface PlacementAnalysisLabel {
  result: PlacementCalibrationResult;
  table_u: number | null;
  table_v: number | null;
  visibility: PlacementVisibility | null;
  confidence: PlacementConfidence | null;
  exclusion_reason: PlacementExclusionReason | null;
  corrected_server: PlacementServer | null;
}

export interface PlacementCalibrationHumanLabel {
  schema_version: 1;
  result: PlacementCalibrationResult | null;
  table_u: number | null;
  table_v: number | null;
  visibility: PlacementVisibility | null;
  confidence: PlacementConfidence | null;
  exclusion_reason: PlacementExclusionReason | null;
  corrected_server: PlacementServer | null;
  blind_snapshot: PlacementBlindSnapshot | null;
  revealed_at: string | null;
  post_reveal_edited: boolean;
}

type PlacementAnswerPatch = Partial<
  Pick<
    PlacementCalibrationHumanLabel,
    | "result"
    | "table_u"
    | "table_v"
    | "visibility"
    | "confidence"
    | "exclusion_reason"
  >
>;

export function createPlacementCalibrationLabel(): PlacementCalibrationHumanLabel {
  return {
    schema_version: 1,
    result: null,
    table_u: null,
    table_v: null,
    visibility: null,
    confidence: null,
    exclusion_reason: null,
    corrected_server: null,
    blind_snapshot: null,
    revealed_at: null,
    post_reveal_edited: false,
  };
}

function answerSnapshot(
  label: PlacementCalibrationHumanLabel,
): PlacementBlindSnapshot {
  if (!label.result) throw new Error("Placement label is incomplete.");
  return {
    result: label.result,
    table_u: label.table_u,
    table_v: label.table_v,
    visibility: label.visibility,
    confidence: label.confidence,
    exclusion_reason: label.exclusion_reason,
  };
}

export function updatePlacementCalibrationLabel(
  current: PlacementCalibrationHumanLabel,
  patch: PlacementAnswerPatch,
): PlacementCalibrationHumanLabel {
  let next: PlacementCalibrationHumanLabel = { ...current, ...patch };
  if (next.result && next.result !== "landed") {
    next = {
      ...next,
      table_u: null,
      table_v: null,
      visibility: null,
      confidence: null,
    };
  }
  if (next.result !== "excluded") {
    next.exclusion_reason = null;
  }
  const answerChanged =
    current.result !== next.result ||
    current.table_u !== next.table_u ||
    current.table_v !== next.table_v ||
    current.visibility !== next.visibility ||
    current.confidence !== next.confidence ||
    current.exclusion_reason !== next.exclusion_reason;
  if (current.revealed_at && answerChanged) {
    next.post_reveal_edited = true;
  }
  return next;
}

export function validatePlacementCalibrationLabel(
  label: PlacementCalibrationHumanLabel,
): string[] {
  if (!label.result) return ["result"];
  if (label.result === "excluded") {
    return label.exclusion_reason ? [] : ["exclusion_reason"];
  }
  if (label.result !== "landed") return [];

  const missing: string[] = [];
  if (
    label.table_u === null ||
    !Number.isFinite(label.table_u) ||
    label.table_u < 0 ||
    label.table_u > TABLE_WIDTH_M
  ) {
    missing.push("table_u");
  }
  if (
    label.table_v === null ||
    !Number.isFinite(label.table_v) ||
    label.table_v < 0 ||
    label.table_v > TABLE_LENGTH_M
  ) {
    missing.push("table_v");
  }
  if (!label.visibility) missing.push("visibility");
  if (!label.confidence) missing.push("confidence");
  return missing;
}

export function placementAnalysisLabel(
  label: PlacementCalibrationHumanLabel,
): PlacementAnalysisLabel {
  if (validatePlacementCalibrationLabel(label).length || !label.result) {
    throw new Error("Placement label is incomplete.");
  }
  return {
    result: label.result,
    table_u: label.table_u,
    table_v: label.table_v,
    visibility: label.visibility,
    confidence: label.confidence,
    exclusion_reason: label.exclusion_reason,
    corrected_server: label.corrected_server,
  };
}

function otherSide(side: "near" | "far"): "near" | "far" {
  return side === "near" ? "far" : "near";
}

export function placementPredictionsCompatible(
  proposal: PlacementCalibrationProposal,
  correctedServer: PlacementServer | null,
) {
  return (
    placementPredictionIncompatibilityReason(
      proposal,
      correctedServer,
    ) === null
  );
}

export function expectedPlacementHitterSide(
  proposal: PlacementCalibrationProposal,
  server: PlacementServer,
): "near" | "far" {
  const serverSide =
    server === "user"
      ? proposal.user_side
      : otherSide(proposal.user_side);
  return proposal.shot_seq % 2 === 1
    ? serverSide
    : otherSide(serverSide);
}

export function placementPredictionIncompatibilityReason(
  proposal: PlacementCalibrationProposal,
  correctedServer: PlacementServer | null,
): PlacementPredictionIncompatibilityReason | null {
  if (
    correctedServer !== null &&
    correctedServer !== proposal.scored_server
  ) {
    return "server_corrected";
  }
  return proposal.hitter_side ===
    expectedPlacementHitterSide(proposal, proposal.scored_server)
    ? null
    : "shot_owner_inconsistent";
}

export function effectivePlacementProposal(
  proposal: PlacementCalibrationProposal,
  correctedServer: PlacementServer | null,
): PlacementCalibrationProposal {
  const scoredServer = correctedServer ?? proposal.scored_server;
  const hitterSide = expectedPlacementHitterSide(
    proposal,
    scoredServer,
  );
  const compatible = placementPredictionsCompatible(
    proposal,
    correctedServer,
  );

  return {
    ...proposal,
    scored_server: scoredServer,
    hitter_side: hitterSide,
    receiver_side: otherSide(hitterSide),
    predictions: compatible
      ? proposal.predictions
      : {
          legacy_current: null,
          canonical_current: null,
          openai: null,
        },
  };
}

export function changePlacementServer(
  current: PlacementCalibrationHumanLabel,
  correctedServer: PlacementServer | null,
): PlacementCalibrationHumanLabel {
  return {
    ...createPlacementCalibrationLabel(),
    schema_version: current.schema_version,
    corrected_server: correctedServer,
  };
}

export function revealPlacementComparison(
  current: PlacementCalibrationHumanLabel,
  revealedAt: string,
): PlacementCalibrationHumanLabel {
  if (validatePlacementCalibrationLabel(current).length) {
    throw new Error("Placement label is incomplete.");
  }
  if (current.revealed_at) return current;
  return {
    ...current,
    blind_snapshot: answerSnapshot(current),
    revealed_at: revealedAt,
    post_reveal_edited: false,
  };
}

export function predictionDistanceCm(
  truth: PlacementPoint | null,
  prediction: PlacementPoint | null,
): number | null {
  if (!truth || !prediction) return null;
  return Number(
    (
      Math.hypot(prediction.u - truth.u, prediction.v - truth.v) * 100
    ).toFixed(1),
  );
}
