export const ENDING_FAMILIES = [
  "net",
  "long",
  "wide",
  "clean_winner",
  "missed_return",
  "edge",
  "other",
  "unsure",
] as const;

export const FINAL_HITTERS = [
  "server",
  "receiver",
  "unknown",
  "unsure",
] as const;

export const ATTEMPTED_RETURN_VALUES = [
  "yes",
  "no",
  "unknown",
  "unsure",
] as const;

export const NET_BEHAVIORS = [
  "died_stuck_lateral",
  "stayed_on_table",
  "rolled_off_side",
  "clipped_continued",
  "other",
  "unsure",
] as const;

export const RECEIVING_ZONES = [
  "forehand",
  "backhand",
  "middle",
  "unknown",
] as const;

export const ENDING_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const SERVER_REVIEW_VALUES = ["correct", "corrected", "unsure"] as const;
export const SCORED_PLAYERS = ["user", "opponent"] as const;

export type EndingFamily = (typeof ENDING_FAMILIES)[number];
export type FinalHitter = (typeof FINAL_HITTERS)[number];
export type AttemptedReturn = (typeof ATTEMPTED_RETURN_VALUES)[number];
export type NetBehavior = (typeof NET_BEHAVIORS)[number];
export type ReceivingZone = (typeof RECEIVING_ZONES)[number];
export type EndingConfidence = (typeof ENDING_CONFIDENCE_VALUES)[number];
export type ServerReview = (typeof SERVER_REVIEW_VALUES)[number];
export type WinnerReview = ServerReview;
export type ScoredPlayer = (typeof SCORED_PLAYERS)[number];

export interface WinnerConstrainedEndingHumanLabel {
  schema_version: 1;
  server_review: ServerReview | null;
  corrected_server: ScoredPlayer | null;
  winner_review: WinnerReview | null;
  corrected_winner: ScoredPlayer | null;
  ending_family: EndingFamily | null;
  contact_count: number | null;
  final_hitter: FinalHitter | null;
  attempted_return: AttemptedReturn | null;
  net_behavior: NetBehavior | null;
  net_behavior_note: string;
  receiving_zone: ReceivingZone;
  confidence: EndingConfidence | null;
  notes: string;
}

function member<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return values.includes(value as T[number]);
}

export function createWinnerConstrainedEndingLabel(): WinnerConstrainedEndingHumanLabel {
  return {
    schema_version: 1,
    server_review: null,
    corrected_server: null,
    winner_review: null,
    corrected_winner: null,
    ending_family: null,
    contact_count: null,
    final_hitter: null,
    attempted_return: null,
    net_behavior: null,
    net_behavior_note: "",
    receiving_zone: "unknown",
    confidence: null,
    notes: "",
  };
}

export function hydrateWinnerConstrainedEndingLabel(
  stored: unknown,
): WinnerConstrainedEndingHumanLabel {
  if (!stored || typeof stored !== "object") {
    return createWinnerConstrainedEndingLabel();
  }
  const input = stored as Record<string, unknown>;
  const serverReview = input.server_review ?? null;
  if (
    serverReview !== null &&
    !member(SERVER_REVIEW_VALUES, serverReview)
  ) {
    throw new Error("Unsupported server review.");
  }
  const correctedServer = input.corrected_server ?? null;
  if (
    correctedServer !== null &&
    !member(SCORED_PLAYERS, correctedServer)
  ) {
    throw new Error("Unsupported corrected server.");
  }
  if (serverReview === "corrected" && correctedServer === null) {
    throw new Error("A corrected server is required when the server is changed.");
  }
  if (serverReview !== "corrected" && correctedServer !== null) {
    throw new Error("Corrected server is only valid for a server correction.");
  }
  const winnerReview = input.winner_review ?? null;
  if (
    winnerReview !== null &&
    !member(SERVER_REVIEW_VALUES, winnerReview)
  ) {
    throw new Error("Unsupported winner review.");
  }
  const correctedWinner = input.corrected_winner ?? null;
  if (
    correctedWinner !== null &&
    !member(SCORED_PLAYERS, correctedWinner)
  ) {
    throw new Error("Unsupported corrected winner.");
  }
  if (winnerReview === "corrected" && correctedWinner === null) {
    throw new Error("A corrected winner is required when the winner is changed.");
  }
  if (winnerReview !== "corrected" && correctedWinner !== null) {
    throw new Error("Corrected winner is only valid for a winner correction.");
  }
  const endingFamily = input.ending_family ?? null;
  if (endingFamily !== null && !member(ENDING_FAMILIES, endingFamily)) {
    throw new Error("Unsupported ending family.");
  }
  const finalHitter = input.final_hitter ?? null;
  if (finalHitter !== null && !member(FINAL_HITTERS, finalHitter)) {
    throw new Error("Unsupported final hitter.");
  }
  const attemptedReturn = input.attempted_return ?? null;
  if (
    attemptedReturn !== null &&
    !member(ATTEMPTED_RETURN_VALUES, attemptedReturn)
  ) {
    throw new Error("Unsupported attempted-return value.");
  }
  const netBehavior = input.net_behavior ?? null;
  if (netBehavior !== null && !member(NET_BEHAVIORS, netBehavior)) {
    throw new Error("Unsupported net behavior.");
  }
  const receivingZone = input.receiving_zone ?? "unknown";
  if (!member(RECEIVING_ZONES, receivingZone)) {
    throw new Error("Unsupported receiving zone.");
  }
  const confidence = input.confidence ?? null;
  if (
    confidence !== null &&
    !member(ENDING_CONFIDENCE_VALUES, confidence)
  ) {
    throw new Error("Unsupported ending confidence.");
  }
  const rawCount = input.contact_count ?? null;
  const contactCount = rawCount === null ? null : Number(rawCount);
  if (
    contactCount !== null &&
    (!Number.isInteger(contactCount) || contactCount < 0)
  ) {
    throw new Error("Racket contact count must be a non-negative integer.");
  }
  return {
    schema_version: 1,
    server_review: serverReview as ServerReview | null,
    corrected_server: correctedServer as ScoredPlayer | null,
    winner_review: winnerReview as WinnerReview | null,
    corrected_winner: correctedWinner as ScoredPlayer | null,
    ending_family: endingFamily as EndingFamily | null,
    contact_count: contactCount,
    final_hitter: finalHitter as FinalHitter | null,
    attempted_return: attemptedReturn as AttemptedReturn | null,
    net_behavior:
      endingFamily === "net" ? (netBehavior as NetBehavior | null) : null,
    net_behavior_note:
      endingFamily === "net" ? String(input.net_behavior_note ?? "") : "",
    receiving_zone: receivingZone as ReceivingZone,
    confidence: confidence as EndingConfidence | null,
    notes: String(input.notes ?? ""),
  };
}

export function clearWinnerDependentAnswers(
  label: WinnerConstrainedEndingHumanLabel,
): WinnerConstrainedEndingHumanLabel {
  return {
    ...label,
    ending_family: null,
    attempted_return: null,
    net_behavior: null,
    net_behavior_note: "",
    receiving_zone: "unknown",
    confidence: null,
  };
}

export function setWinnerReview(
  label: WinnerConstrainedEndingHumanLabel,
  review: WinnerReview,
  importedWinner: ScoredPlayer,
  correctedWinner: ScoredPlayer | null = null,
): WinnerConstrainedEndingHumanLabel {
  if (!member(SERVER_REVIEW_VALUES, review)) {
    throw new Error("Unsupported winner review.");
  }
  if (!member(SCORED_PLAYERS, importedWinner)) {
    throw new Error("Unsupported imported winner.");
  }
  let nextWinner: ScoredPlayer | null = null;
  if (review === "corrected") {
    if (!correctedWinner || !member(SCORED_PLAYERS, correctedWinner)) {
      throw new Error("A corrected winner is required.");
    }
    if (correctedWinner === importedWinner) {
      throw new Error("Corrected winner must be different from the imported winner.");
    }
    nextWinner = correctedWinner;
  }
  const changed =
    label.winner_review !== review ||
    label.corrected_winner !== nextWinner;
  const next = {
    ...label,
    winner_review: review,
    corrected_winner: nextWinner,
  };
  return changed ? clearWinnerDependentAnswers(next) : next;
}

export function setServerReview(
  label: WinnerConstrainedEndingHumanLabel,
  review: ServerReview,
  importedServer: ScoredPlayer,
  correctedServer: ScoredPlayer | null = null,
): WinnerConstrainedEndingHumanLabel {
  if (!member(SERVER_REVIEW_VALUES, review)) {
    throw new Error("Unsupported server review.");
  }
  if (!member(SCORED_PLAYERS, importedServer)) {
    throw new Error("Unsupported imported server.");
  }
  if (review === "corrected") {
    if (!correctedServer || !member(SCORED_PLAYERS, correctedServer)) {
      throw new Error("A corrected server is required.");
    }
    if (correctedServer === importedServer) {
      throw new Error("Corrected server must be different from the imported server.");
    }
    return {
      ...label,
      server_review: review,
      corrected_server: correctedServer,
    };
  }
  return {
    ...label,
    server_review: review,
    corrected_server: null,
  };
}

export function setEndingFamily(
  label: WinnerConstrainedEndingHumanLabel,
  endingFamily: EndingFamily,
): WinnerConstrainedEndingHumanLabel {
  if (!member(ENDING_FAMILIES, endingFamily)) {
    throw new Error("Unsupported ending family.");
  }
  return {
    ...label,
    ending_family: endingFamily,
    net_behavior: endingFamily === "net" ? label.net_behavior : null,
    net_behavior_note:
      endingFamily === "net" ? label.net_behavior_note : "",
  };
}

export function validateWinnerConstrainedEndingLabel(
  label: WinnerConstrainedEndingHumanLabel,
): string[] {
  const missing: string[] = [];
  if (label.server_review === null) missing.push("server_review");
  if (label.winner_review === null) missing.push("winner_review");
  if (label.ending_family === null) missing.push("ending_family");
  if (label.final_hitter === null) missing.push("final_hitter");
  if (label.attempted_return === null) missing.push("attempted_return");
  if (label.confidence === null) missing.push("confidence");
  if (label.ending_family === "net" && label.net_behavior === null) {
    missing.push("net_behavior");
  }
  if (
    label.ending_family === "net" &&
    label.net_behavior === "other" &&
    !label.net_behavior_note.trim()
  ) {
    missing.push("net_behavior_note");
  }
  return missing;
}
