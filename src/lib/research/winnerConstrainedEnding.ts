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

export type EndingFamily = (typeof ENDING_FAMILIES)[number];
export type FinalHitter = (typeof FINAL_HITTERS)[number];
export type AttemptedReturn = (typeof ATTEMPTED_RETURN_VALUES)[number];
export type NetBehavior = (typeof NET_BEHAVIORS)[number];
export type ReceivingZone = (typeof RECEIVING_ZONES)[number];
export type EndingConfidence = (typeof ENDING_CONFIDENCE_VALUES)[number];

export interface WinnerConstrainedEndingHumanLabel {
  schema_version: 1;
  ending_family: EndingFamily | null;
  contact_count: number | null;
  final_hitter: FinalHitter | null;
  attempted_return: AttemptedReturn | null;
  net_behavior: NetBehavior | null;
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
    ending_family: null,
    contact_count: null,
    final_hitter: null,
    attempted_return: null,
    net_behavior: null,
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
    ending_family: endingFamily as EndingFamily | null,
    contact_count: contactCount,
    final_hitter: finalHitter as FinalHitter | null,
    attempted_return: attemptedReturn as AttemptedReturn | null,
    net_behavior:
      endingFamily === "net" ? (netBehavior as NetBehavior | null) : null,
    receiving_zone: receivingZone as ReceivingZone,
    confidence: confidence as EndingConfidence | null,
    notes: String(input.notes ?? ""),
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
  };
}

export function validateWinnerConstrainedEndingLabel(
  label: WinnerConstrainedEndingHumanLabel,
): string[] {
  const missing: string[] = [];
  if (label.ending_family === null) missing.push("ending_family");
  if (label.final_hitter === null) missing.push("final_hitter");
  if (label.attempted_return === null) missing.push("attempted_return");
  if (label.confidence === null) missing.push("confidence");
  if (label.ending_family === "net" && label.net_behavior === null) {
    missing.push("net_behavior");
  }
  return missing;
}
