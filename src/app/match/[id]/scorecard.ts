import type { PointSuggestion } from "@/lib/types";

/**
 * Canonical "how did it end?" values stored in points.confirmed_how.
 * Grouped so the select stays two taps: open, pick.
 *
 * confirmed_how partitions by OUTCOME: these winner-hows apply only when
 * a point has a confirmed_winner. Skipped points (is_let = true) use the
 * separate SKIP_REASONS set below — 'let' is a skip reason, not a way to
 * win a point.
 */
export const HOW_GROUPS: {
  id: "miss" | "won" | "other";
  label: string;
  options: { value: string; label: string }[];
}[] = [
  {
    id: "miss",
    label: "They missed",
    options: [
      { value: "hit_into_net", label: "Hit into net" },
      { value: "missed_long", label: "Missed long" },
      { value: "missed_wide", label: "Missed wide" },
      { value: "receive_error", label: "Receive error" },
    ],
  },
  {
    id: "won",
    label: "You/They won it",
    options: [
      { value: "clean_winner", label: "Clean winner" },
      { value: "service_ace", label: "Service ace" },
      { value: "edge_ball", label: "Edge ball" },
      { value: "net_cord_dribbler", label: "Net cord dribbler" },
    ],
  },
  {
    id: "other",
    label: "Other",
    options: [
      { value: "double_bounce", label: "Double bounce" },
      { value: "serve_fault", label: "Serve fault" },
      { value: "forced_error", label: "Forced error" },
    ],
  },
];

/**
 * Optional reasons for the SKIPPED outcome (is_let = true), stored in the
 * same confirmed_how column. Skipped points never score and never advance
 * the serve rotation.
 */
export const SKIP_REASONS: { value: string; label: string }[] = [
  { value: "let", label: "Let serve" },
  { value: "misrecorded", label: "Wrong recording" },
  { value: "other", label: "Other" },
];

const SKIP_LABELS: Record<string, string> = Object.fromEntries(
  SKIP_REASONS.map((r) => [r.value, r.label])
);

/** Normalize a stored confirmed_how to a selectable skip reason. */
export function canonicalSkipReason(value: string | null): string {
  if (!value) return "";
  return SKIP_LABELS[value] ? value : "";
}

/**
 * Chip label for a skipped point: the reason when it says something
 * ("Let", "Wrong recording"), the generic "Skipped" otherwise.
 */
export function skipChipLabel(how: string | null): string {
  if (how === "let") return "Let";
  if (how === "misrecorded") return "Wrong recording";
  return "Skipped";
}

const HOW_LABELS: Record<string, string> = Object.fromEntries(
  HOW_GROUPS.flatMap((g) => g.options.map((o) => [o.value, o.label]))
);

/** Values stored before the grouped list existed. Shown, never offered. */
const LEGACY_HOW: Record<string, string> = {
  net: "Hit into net",
  missed_table: "Missed the table",
  edge_net_cord: "Edge or net cord",
};

/** Map an old stored value onto the closest new canonical value. */
const LEGACY_TO_CANONICAL: Record<string, string> = {
  net: "hit_into_net",
  missed_table: "missed_long",
  edge_net_cord: "edge_ball",
};

/** Normalize a stored confirmed_how (old or new) to a selectable value. */
export function canonicalHow(value: string | null): string {
  if (!value) return "";
  if (HOW_LABELS[value]) return value;
  return LEGACY_TO_CANONICAL[value] ?? "";
}

export function howLabel(value: string | null): string | null {
  if (!value) return null;
  return HOW_LABELS[value] ?? SKIP_LABELS[value] ?? LEGACY_HOW[value] ?? value;
}

/**
 * Map the worker's free-text suggestion.how (e.g. "hit into net",
 * "missed table (long/wide)", "double bounce / no return",
 * "edge/net-cord lucky ball", "clean winner") onto a canonical value.
 */
export function suggestionHowValue(s: PointSuggestion | null): string | null {
  const how = s?.how?.toLowerCase() ?? "";
  if (!how) return null;
  if (how.includes("edge")) return "edge_ball";
  if (how.includes("net cord") || how.includes("net-cord"))
    return "net_cord_dribbler";
  if (how.includes("serve fault") || how.includes("fault"))
    return "serve_fault";
  if (how.includes("net")) return "hit_into_net";
  if (how.includes("wide")) return "missed_wide";
  if (how.includes("missed table") || how.includes("long"))
    return "missed_long";
  if (how.includes("double bounce")) return "double_bounce";
  if (how.includes("clean winner")) return "clean_winner";
  if (how.includes("ace")) return "service_ace";
  // "let" intentionally unmapped: a let is a SKIP reason now, never a
  // winner-how prefill.
  return null;
}
