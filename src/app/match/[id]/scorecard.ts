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
      { value: "net_cord_dribbler", label: "Clipped the net" },
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

/**
 * DIRECTION — where the deciding ball was placed on the opponent's side,
 * the core tactical dimension (serve/winner/forced-error placement). 'mid'
 * is the crossover/elbow. Stored in the points.direction column.
 */
export const DIRECTIONS: { value: "fh" | "bh" | "mid"; label: string }[] = [
  { value: "bh", label: "Backhand" },
  { value: "mid", label: "Middle" },
  { value: "fh", label: "Forehand" },
];

const DIRECTION_LABELS: Record<string, string> = Object.fromEntries(
  DIRECTIONS.map((d) => [d.value, d.label])
);

/** Human label for a stored direction value ("bh" → "Backhand"). */
export function directionLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return DIRECTION_LABELS[value] ?? null;
}

/**
 * The hows where the deciding ball's PLACEMENT is a meaningful tactical
 * signal — the winner aimed the ball somewhere and it created the point
 * (an error they forced, a clean winner, a serve). We ASK "where did it go"
 * only for these.
 *
 * Deliberately excluded: luck (edge / clipped-net — the ball wasn't placed
 * on purpose) and the "other" bucket (double bounce, serve fault, forced
 * error), where a forehand/backhand/middle answer wouldn't inform practice.
 */
export const PLACEMENT_HOWS = new Set<string>([
  "hit_into_net",
  "missed_long",
  "missed_wide",
  "receive_error",
  "clean_winner",
  "service_ace",
]);

/** Whether the placement follow-up applies to a given (canonical) how. */
export function directionApplies(how: string | null | undefined): boolean {
  return !!how && PLACEMENT_HOWS.has(how);
}

/**
 * SERVE DIAGNOSIS — asked when the point turned on the serve itself.
 *
 * Spin is a BASE plus a MODIFIER, not one flat list, because real serves
 * combine: side-under and side-top are the two serves that actually cause
 * receive errors, and neither survives a mutually exclusive
 * top/back/side/none set. Four chips cover all six cases (see migration
 * 032). Left vs right sidespin is deliberately out of scope.
 */
export const SERVE_SPINS: { value: "back" | "top" | "none"; label: string }[] =
  [
    { value: "back", label: "Backspin" },
    { value: "top", label: "Topspin" },
    { value: "none", label: "No spin" },
  ];

/** 'half' is the half-long serve that lands near the end line — the classic
 * receive killer, and genuinely distinct from both short and long. */
export const SERVE_LENGTHS: {
  value: "short" | "half" | "long";
  label: string;
}[] = [
  { value: "short", label: "Short" },
  { value: "half", label: "Half-long" },
  { value: "long", label: "Long" },
];

/**
 * The hows where describing the serve teaches you something. An ace is a
 * receive error one degree more severe, so both obviously qualify.
 *
 * Clean winners are here too, because a winner is very often a third ball
 * the serve set up. We do NOT try to detect third-ball attacks: rally length
 * would have to come from the vision, and it is absent on most matches and
 * unreliable where it exists, so a wrong guess would quietly poison the very
 * statistic this feeds. The question is simply offered on every clean winner
 * and left optional — skip it on the ones where the serve was irrelevant.
 */
export const SERVE_HOWS = new Set<string>([
  "receive_error",
  "service_ace",
  "clean_winner",
]);

/** Whether the serve follow-up applies to a given (canonical) how. */
export function serveApplies(how: string | null | undefined): boolean {
  return !!how && SERVE_HOWS.has(how);
}

/**
 * Compose the stored base + modifier back into what a player would call it:
 * back + side = "Side-under", top + side = "Side-top", none + side = plain
 * "Sidespin". Length rides along after a separator. Null when nothing is set.
 */
export function serveSpinLabel(
  spin: string | null | undefined,
  sidespin: boolean | null | undefined
): string | null {
  if (sidespin) {
    return spin === "back" ? "Side-under" : spin === "top" ? "Side-top" : "Sidespin";
  }
  if (!spin) return null;
  return SERVE_SPINS.find((s) => s.value === spin)?.label ?? null;
}

export function serveLengthLabel(length: string | null | undefined): string | null {
  return SERVE_LENGTHS.find((l) => l.value === length)?.label ?? null;
}

export function serveSummaryLabel(
  spin: string | null | undefined,
  sidespin: boolean | null | undefined,
  length: string | null | undefined
): string | null {
  const parts = [serveSpinLabel(spin, sidespin), serveLengthLabel(length)].filter(
    Boolean
  );
  return parts.length ? parts.join(" · ") : null;
}

/**
 * LOSS REASONS — multi-select, self-reported, first-person only. You cannot
 * know why your opponent lost a point, so this is never asked about points
 * you won, nor on neutral third-party matches.
 *
 * "Their winner" is load-bearing: without an honest "nothing went wrong,
 * they were just better" option, players over-attribute fault to themselves
 * and the aggregate skews. There is deliberately no "poor receive" — that is
 * already a confirmed_how, and a chip would double-count it.
 */
export const LOSS_REASONS: { value: string; label: string }[] = [
  { value: "misread_spin", label: "Misread the spin" },
  { value: "out_of_position", label: "Out of position" },
  { value: "rushed", label: "Rushed it" },
  { value: "too_passive", label: "Too passive" },
  { value: "too_aggressive", label: "Too aggressive" },
  { value: "weak_serve", label: "Weak serve" },
  { value: "lost_focus", label: "Lost focus" },
  { value: "their_winner", label: "Their winner" },
];

const LOSS_REASON_LABELS: Record<string, string> = Object.fromEntries(
  LOSS_REASONS.map((r) => [r.value, r.label])
);

/** Human label for one stored loss-reason value. */
export function lossReasonLabel(value: string): string | null {
  return LOSS_REASON_LABELS[value] ?? null;
}

/**
 * Which reasons make sense for each ENDING. You have already told us how the
 * point ended, so offering all eight afterwards invites answers that
 * contradict that: "their winner" on a ball you dumped into the net, or
 * "out of position" on a serve you faulted. The whole point of asking how it
 * ended first is that it narrows what could have gone wrong.
 *
 * Luck endings (edge, clipped net) are absent entirely — nothing went wrong,
 * so there is no question to ask.
 *
 * Reading the lists: "I missed" endings keep the execution reasons and drop
 * "their winner" (they didn't win it, you missed). "They won it" endings do
 * the reverse, keeping only the few things that were plausibly yours to
 * control. Serve fault is the narrowest of all: you faulted your own serve,
 * so spin reading and court position had nothing to do with it.
 */
const LOSS_REASONS_BY_HOW: Record<string, string[]> = {
  hit_into_net: [
    "misread_spin", "rushed", "too_passive", "too_aggressive",
    "out_of_position", "weak_serve", "lost_focus",
  ],
  missed_long: [
    "misread_spin", "rushed", "too_aggressive", "out_of_position",
    "weak_serve", "lost_focus",
  ],
  missed_wide: [
    "misread_spin", "rushed", "too_aggressive", "out_of_position",
    "weak_serve", "lost_focus",
  ],
  // They served, so no "weak serve" — and you touched the ball, so the
  // execution reasons are all live.
  receive_error: [
    "misread_spin", "rushed", "too_passive", "too_aggressive",
    "out_of_position", "lost_focus",
  ],
  clean_winner: [
    "out_of_position", "too_passive", "weak_serve", "lost_focus",
    "their_winner",
  ],
  // An ace means you never hit the ball: only reading it, watching it, or
  // simply being beaten are on the table.
  service_ace: ["misread_spin", "out_of_position", "lost_focus", "their_winner"],
  // The ball bounced twice on your side — you didn't get there.
  double_bounce: [
    "out_of_position", "too_passive", "weak_serve", "lost_focus",
    "their_winner",
  ],
  // Your own serve missed. "Weak serve" is redundant with the fault itself.
  serve_fault: ["rushed", "lost_focus"],
  forced_error: [
    "out_of_position", "too_passive", "rushed", "weak_serve", "lost_focus",
    "their_winner",
  ],
};

/** Offered only on points you actually served. */
const SERVER_ONLY_REASONS = new Set<string>(["weak_serve"]);

/**
 * The reasons to offer for an ending, in chip order. `iServed` drops the
 * serve-only reasons on points you received.
 */
export function lossReasonsFor(
  how: string | null | undefined,
  iServed: boolean
): { value: string; label: string }[] {
  const keys = how ? LOSS_REASONS_BY_HOW[how] : undefined;
  if (!keys) return [];
  return keys
    .filter((k) => iServed || !SERVER_ONLY_REASONS.has(k))
    .map((k) => ({ value: k, label: LOSS_REASON_LABELS[k] }));
}

/** Whether the "why did you lose it" follow-up applies at all. */
export function lossReasonsApply(
  how: string | null | undefined,
  iServed: boolean
): boolean {
  return lossReasonsFor(how, iServed).length > 0;
}

/** Drop stored reasons that the current ending no longer offers. */
export function pruneLossReasons(
  reasons: string[] | null | undefined,
  how: string | null | undefined,
  iServed: boolean
): string[] {
  if (!reasons?.length) return [];
  const allowed = new Set(lossReasonsFor(how, iServed).map((r) => r.value));
  return reasons.filter((r) => allowed.has(r));
}

/** "Rushed it · Out of position", or null when nothing is selected. */
export function lossReasonsSummary(
  reasons: string[] | null | undefined
): string | null {
  if (!reasons?.length) return null;
  const labels = reasons
    .map((r) => LOSS_REASON_LABELS[r])
    .filter((l): l is string => !!l);
  return labels.length ? labels.join(" · ") : null;
}

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
