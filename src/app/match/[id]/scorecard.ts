import type { PointSuggestion } from "@/lib/types";

/**
 * Canonical "how did it end?" values stored in points.confirmed_how.
 *
 * RETIRED AS A QUESTION (migration 060). Asking how a point ended told the
 * player nothing they didn't just watch, and it sat in front of the
 * question they actually came for — the reason chips were gated on it, so
 * "why did you lose it" was unreachable until "how" was answered.
 *
 * This table survives for two jobs:
 *   1. LABELS for the matches that answered it, so no stored point starts
 *      rendering as a raw value;
 *   2. the three ERROR values (hit_into_net / missed_long / missed_wide),
 *      which are still written — as the follow-up to "Misread the spin",
 *      where where-the-ball-went is precisely what tells you WHICH spin you
 *      misread (net on a drive = backspin, long = topspin, wide = sidespin).
 *
 * Nothing else in here is ever offered again. See MISREAD_WHERE below for
 * the part that is.
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
 * WHERE IT WENT — the follow-up to "Misread the spin", and the only part of
 * the old ending question still asked. Same three points.confirmed_how
 * values, so the mistakes cut in matchAnalysis keeps working unchanged.
 *
 * This is a diagnosis, not bookkeeping: coaches read the miss backwards to
 * name the spin. Into the net on a drive means you read backspin as lighter
 * than it was; long means topspin; wide means sidespin you didn't account
 * for. Answering it turns "I misread it" into "I misread THAT".
 */
export const MISREAD_WHERE: { value: string; label: string }[] = [
  { value: "hit_into_net", label: "Into the net" },
  { value: "missed_long", label: "Long" },
  { value: "missed_wide", label: "Wide" },
];

/**
 * DIRECTION — where the deciding ball was placed on the opponent's side.
 * 'mid' is the crossover/elbow. Stored in the points.direction column.
 *
 * RETIRED AS A QUESTION (migration 060), kept for labels on the points that
 * answered it. It was a third-level follow-up few players ever reached, and
 * the placement maps answer the same question from the footage without
 * anyone having to tap.
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
 * Whether describing the serve teaches you anything on this point.
 *
 * Keyed on the REASON now, not on how the point ended, and the two cases
 * are exact mirrors of each other:
 *
 *   'receive_error'  they served, you flubbed the return -> describe THEIR
 *                    serve, because that is the serve that beat you;
 *   'weak_serve'     you served and blamed the serve      -> describe YOURS.
 *
 * Both chips are only offered on the matching side of the rotation (see
 * lossReasonsFor), so a reason implies its serve without any extra check.
 *
 * The old gate asked this on every clean winner too, on the theory that a
 * winner is often a third ball the serve set up — which the code's own
 * comment admitted was a guess, since third-ball attacks can't be detected.
 * That guess is gone: every serve row stored from here describes a serve
 * that demonstrably decided the point.
 */
export function serveApplies(reasons: readonly string[] | null | undefined) {
  if (!reasons?.length) return false;
  return reasons.includes("receive_error") || reasons.includes("weak_serve");
}

/** Whether the "where did it go" follow-up applies (misreads only). */
export function misreadDetailApplies(
  reasons: readonly string[] | null | undefined
): boolean {
  return !!reasons?.includes("misread_spin");
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
  { value: "too_aggressive", label: "Went for too much" },
  { value: "too_passive", label: "Too passive" },
  { value: "lost_focus", label: "Lost focus" },
  { value: "their_winner", label: "They were just better" },
  // Rotation-gated pair, mirrors of each other — see lossReasonsFor.
  { value: "weak_serve", label: "Weak serve" },
  { value: "receive_error", label: "Receive error" },
];

/**
 * Values that are still STORED and still rendered, but never offered again.
 * 'rushed' folded into "Went for too much" (migration 060): rushing it and
 * over-hitting it are the same confession in practice, and two chips for
 * one idea split the count. Old points keep their value and read under the
 * merged label — the same shown-never-offered treatment LEGACY_HOW gets.
 */
const LEGACY_LOSS_REASONS: Record<string, string> = {
  rushed: "Went for too much",
};

const LOSS_REASON_LABELS: Record<string, string> = {
  ...Object.fromEntries(LOSS_REASONS.map((r) => [r.value, r.label])),
  ...LEGACY_LOSS_REASONS,
};

/**
 * The player's own reasons live in loss_reason_labels (owner-keyed, like
 * tags) and are stored on the point as 'custom:<uuid>'. A prefix rather
 * than a join table so every consumer keeps reading point.loss_reasons as
 * the plain string[] it always was.
 */
const CUSTOM_PREFIX = "custom:";

/**
 * Character limit on a custom pill.
 *
 * These sit in the same chip row as the built-ins and, more importantly, as
 * bar labels in the analysis card and on /stats, where a long one either
 * truncates to nothing or pushes the count off the row. The longest
 * built-in is "They were just better" at 20, so 24 leaves headroom without
 * letting a sentence in — the point of a pill is that it recurs across
 * matches, and a sentence never says the same thing twice.
 */
export const MAX_CUSTOM_REASON_LEN = 24;

/**
 * Normalize a custom pill to the shape every built-in already has: sentence
 * case, single-spaced, capped.
 *
 * The built-ins are "Misread the spin", "Went for too much" — so a pill
 * typed as "MISREAD THE PIPS" or "misread the pips" would sit beside them
 * looking like a different kind of thing, in the chip row and again as a
 * bar label in the analysis card. Normalizing at SAVE time rather than at
 * render means the stored label is the clean one, so every surface that
 * ever reads it agrees without each having to remember to format.
 *
 * Lowercasing the tail does flatten an acronym — "BH error" becomes "Bh
 * error". Accepted deliberately: consistency across a chart of a dozen
 * pills is worth more than the one word a player could have spelled out.
 */
export function normalizeCustomReasonLabel(raw: string): string {
  const clean = raw.trim().replace(/\s+/g, " ").slice(0, MAX_CUSTOM_REASON_LEN);
  if (!clean) return "";
  return clean[0].toUpperCase() + clean.slice(1).toLowerCase();
}

export type CustomReasonLabels = ReadonlyMap<string, string>;

export function isCustomReason(value: string): boolean {
  return value.startsWith(CUSTOM_PREFIX);
}

export function customReasonValue(id: string): string {
  return `${CUSTOM_PREFIX}${id}`;
}

export function customReasonId(value: string): string | null {
  return isCustomReason(value) ? value.slice(CUSTOM_PREFIX.length) : null;
}

/**
 * Human label for one stored loss-reason value, built-in or custom.
 *
 * A custom reason whose label row is missing renders as "Removed reason"
 * rather than null: the array has no foreign key (see migration 060), so a
 * label deleted straight from SQL would otherwise make the chip vanish from
 * a point that genuinely carries it. Saying something is the honest option.
 */
export function lossReasonLabel(
  value: string,
  custom?: CustomReasonLabels
): string | null {
  const id = customReasonId(value);
  if (id !== null) return custom?.get(id) ?? "Removed reason";
  return LOSS_REASON_LABELS[value] ?? null;
}

/**
 * The same six on every lost point, ordered by what actually goes wrong in
 * each case rather than alphabetically or by some fixed house order. The
 * two rallies are different rallies:
 *
 *   YOU SERVED — you had the initiative and gave it away. The serve itself,
 *     then the third ball you over-hit going for the finish; those are where
 *     the server loses points. Misreading spin comes late: it is THEIR
 *     return you misread, which is a rarer way to lose your own serve.
 *
 *   THEY SERVED — you were under it from the first ball. The return, then
 *     the spin you read wrong on it; the coaching literature is unanimous
 *     that this pair is where receivers lose points, and being passive on a
 *     serve you could not attack is the next thing after it.
 *
 * Nothing is hidden by the ordering — every reason stays reachable in one
 * tap. It only decides which is under your thumb first.
 */
const CORE_WHEN_I_SERVED = [
  "too_aggressive",
  "their_winner",
  "out_of_position",
  "too_passive",
  "misread_spin",
  "lost_focus",
] as const;

const CORE_WHEN_THEY_SERVED = [
  "misread_spin",
  "too_passive",
  "too_aggressive",
  "out_of_position",
  "their_winner",
  "lost_focus",
] as const;

/**
 * The reasons to offer on a lost point, in chip order.
 *
 * Keyed on WHO SERVED, which the ITTF rotation already knows for free and
 * reliably (serving.ts), rather than on how the point ended. That swap is
 * the whole change: the reason question no longer waits behind an ending.
 *
 * The rotation adds exactly one chip, and which one is a mirror:
 *   you served   -> "Weak serve"    (the serve handed them the point)
 *   they served  -> "Receive error" (their serve beat your return)
 * Each leads, because on a point that turned on the serve it is the first
 * thing a player reaches for. When the rotation cannot name a server —
 * first_server unset, no override — neither is offered rather than guessing,
 * since offering the wrong one invites an answer that is simply false.
 *
 * 'receive_error' could not exist as a chip before migration 060: the old
 * ending list already had a receive_error value, and 032 left the chip out
 * on purpose to avoid double-counting it. Retiring the ending question is
 * what freed the slot.
 */
export function lossReasonsFor(
  iServed: boolean | null,
  custom: { id: string; label: string }[] = []
): { value: string; label: string }[] {
  const serveChip =
    iServed === null ? [] : [iServed ? "weak_serve" : "receive_error"];
  const core =
    iServed === null
      ? CORE_WHEN_THEY_SERVED
      : iServed
        ? CORE_WHEN_I_SERVED
        : CORE_WHEN_THEY_SERVED;
  return [
    ...serveChip.map((k) => ({ value: k, label: LOSS_REASON_LABELS[k] })),
    ...core.map((k) => ({ value: k, label: LOSS_REASON_LABELS[k] })),
    ...custom.map((c) => ({
      value: customReasonValue(c.id),
      label: c.label,
    })),
  ];
}

/**
 * The line under the question naming who served, so the chip set reads as
 * derived rather than arbitrary. Without it, "Weak serve" on a point you
 * did serve looks like the app guessing — the rotation knows, and saying so
 * is what turns a tailored list into an obviously tailored one.
 *
 * Returns null when the rotation cannot name a server: with nothing to say,
 * an empty line is better than "Server unknown", which invites a shrug at
 * exactly the moment you want an answer.
 */
export function serverContextLine(
  iServed: boolean | null,
  labels: { you: string; them: string },
  neutral: boolean
): string | null {
  if (iServed === null) return null;
  if (iServed) return neutral ? `${labels.you} served` : "You served";
  return `${labels.them} served`;
}

/**
 * Whether the "why did you lose it" question applies at all.
 *
 * It always does on a point the owner lost — that is the point of moving it
 * to the front. The signature stays a function rather than a constant so
 * the callers reading like a question keep reading like one.
 */
export function lossReasonsApply(): boolean {
  return true;
}

/**
 * Reasons the rotation no longer offers, dropped so a corrected server does
 * not leave "Weak serve" on a point you turned out to have received.
 *
 * Only ever prunes the mirrored pair. Core reasons and the player's own
 * pills survive every correction — nothing about who served makes "Out of
 * position" or "Misread the pips" untrue.
 */
export function pruneLossReasons(
  reasons: string[] | null | undefined,
  iServed: boolean | null
): string[] {
  if (!reasons?.length) return [];
  const drop =
    iServed === null
      ? ["weak_serve", "receive_error"]
      : iServed
        ? ["receive_error"]
        : ["weak_serve"];
  return reasons.filter((r) => !drop.includes(r));
}

/** "Went for too much · Out of position", or null when nothing is set. */
export function lossReasonsSummary(
  reasons: string[] | null | undefined,
  custom?: CustomReasonLabels
): string | null {
  if (!reasons?.length) return null;
  const labels = reasons
    .map((r) => lossReasonLabel(r, custom))
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
