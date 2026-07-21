import type { PointSuggestion } from "@/lib/types";

/** Canonical "how did it end?" values stored in points.confirmed_how. */
export const HOW_OPTIONS: { value: string; label: string }[] = [
  { value: "net", label: "Net" },
  { value: "missed_table", label: "Missed the table" },
  { value: "double_bounce", label: "Double bounce" },
  { value: "clean_winner", label: "Clean winner" },
  { value: "edge_net_cord", label: "Edge or net cord" },
  { value: "serve_fault", label: "Serve fault" },
  { value: "let", label: "Let" },
];

export function howLabel(value: string | null): string | null {
  if (!value) return null;
  return HOW_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/**
 * Map the worker's free-text suggestion.how (e.g. "hit into net",
 * "missed table (long/wide)", "double bounce / no return",
 * "edge/net-cord lucky ball", "clean winner") onto a canonical value.
 */
export function suggestionHowValue(s: PointSuggestion | null): string | null {
  const how = s?.how?.toLowerCase() ?? "";
  if (!how) return null;
  if (how.includes("edge")) return "edge_net_cord";
  if (how.includes("net")) return "net";
  if (how.includes("missed table")) return "missed_table";
  if (how.includes("double bounce")) return "double_bounce";
  if (how.includes("clean winner")) return "clean_winner";
  if (how.includes("serve fault") || how.includes("fault")) return "serve_fault";
  if (how.includes("let")) return "let";
  return null;
}
