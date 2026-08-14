import type { RecallMatch, RecallRegion } from "./data";

/**
 * The verdicts. Not "was the mark right" like the serve detector — that page
 * judges a timestamp. This one judges whether a stretch of video holds a
 * point you could actually score, so the middle answers matter as much as
 * the ends: a card that opens after the serve is a point you cannot score,
 * and counting it as a success is how the old harness reported 100%.
 */
export const VERDICTS = [
  { value: "rally_whole", label: "Real rally, all of it here" },
  { value: "rally_clipped", label: "Real rally, but cut short" },
  { value: "rally_multi", label: "More than one rally here" },
  { value: "junk", label: "No rally — junk" },
  { value: "unsure", label: "Can't tell" },
] as const;

export type Verdict = (typeof VERDICTS)[number]["value"];

export const CAUSE_GROUPS = [
  {
    group: "The ball could not be seen",
    causes: [
      { value: "ball_hidden", label: "Hidden by a player, hand or bat" },
      { value: "ball_too_small", label: "Too far, dark or low contrast" },
      { value: "motion_blur", label: "Smeared by motion blur" },
      { value: "ball_lost", label: "Nothing found while it is obvious" },
    ],
  },
  {
    group: "It looked in the wrong place",
    causes: [
      { value: "tracker_other_table", label: "Another table's ball" },
      { value: "table_wrong", label: "Wrong table region" },
      { value: "no_calibration", label: "No table found on this match" },
    ],
  },
  {
    group: "The point is an awkward shape",
    causes: [
      { value: "very_short_point", label: "Serve error or quick winner" },
      { value: "serve_off_camera", label: "Serve happens off camera" },
      { value: "two_points_fused", label: "Two rallies in one card" },
    ],
  },
  {
    group: "The edges are wrong",
    causes: [
      { value: "opens_late", label: "Opens after the serve" },
      { value: "ends_early", label: "Ends before the point is decided" },
      { value: "other", label: "Something else, see the note" },
    ],
  },
] as const;

export const ALL_CAUSES = CAUSE_GROUPS.flatMap((g) =>
  g.causes.map((c) => c.value),
);

export function causeLabel(value: string): string {
  for (const group of CAUSE_GROUPS) {
    for (const cause of group.causes) {
      if (cause.value === value) return cause.label;
    }
  }
  return value;
}

/**
 * What each kind of region is asking. Written as the question rather than a
 * label, because a reviewer answering the wrong question produces confident
 * data pointing the wrong way.
 */
export const KINDS = [
  {
    value: "extra",
    label: "Only the lab has a card",
    question: "Is there a real rally here that has no point card today?",
    tone: "cyan",
  },
  {
    value: "drop",
    label: "Production dropped it",
    question: "Production built a window here and deleted it. Was it right?",
    tone: "magenta",
  },
  {
    value: "fused",
    label: "Two rallies in one card",
    question: "Should this card be split into separate points?",
    tone: "amber",
  },
  {
    value: "gap",
    label: "Nobody claims it",
    question: "Is a rally hiding in here that both systems missed?",
    tone: "zinc",
  },
  {
    value: "card",
    label: "Both agree",
    question: "Does this clip hold the whole point, serve to finish?",
    tone: "emerald",
  },
] as const;

export type Kind = (typeof KINDS)[number]["value"];

export function kindMeta(kind: string) {
  return KINDS.find((k) => k.value === kind) ?? KINDS[KINDS.length - 1];
}

/** Run-length string ("1:4,0:12") back to the booleans it packs. */
export function decodeLane(rle: string): boolean[] {
  if (!rle) return [];
  const out: boolean[] = [];
  for (const chunk of rle.split(",")) {
    const [value, count] = chunk.split(":");
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) continue;
    for (let i = 0; i < n; i += 1) out.push(value === "1");
  }
  return out;
}

export const LANES = [
  { key: "motion", label: "Players moving", colour: "rgb(129,140,248)" },
  { key: "ball", label: "Ball seen", colour: "rgb(161,161,170)" },
  { key: "dense", label: "Rally-strength ball", colour: "rgb(34,211,238)" },
  { key: "cross", label: "Crossed the net", colour: "rgb(52,211,153)" },
  { key: "motif", label: "Serve pattern", colour: "rgb(244,114,182)" },
] as const;

export function filterRegions(
  regions: readonly RecallRegion[],
  opts: { kinds: readonly string[]; onlyUnreviewed: boolean; done: Set<string> },
): RecallRegion[] {
  return regions.filter((r) => {
    if (opts.kinds.length > 0 && !opts.kinds.includes(r.kind)) return false;
    if (opts.onlyUnreviewed && opts.done.has(r.id)) return false;
    return true;
  });
}

/**
 * The estimate the page exists to show. Every game of table tennis ends at
 * 11 with two clear; when a card is missing the score comes up short and the
 * owner has to pin the game shut by hand. Counting those pins gives a miss
 * rate with no labelling at all — and it is a LOWER bound, because a point
 * whose absence the final score absorbs leaves no trace.
 */
export function missRate(missing: number, points: number): number {
  const real = points + missing;
  return real > 0 ? (100 * missing) / real : 0;
}

export function recallFromMiss(missing: number, points: number): number {
  return 100 - missRate(missing, points);
}

export function totals(matches: readonly RecallMatch[]) {
  const rallies = matches.reduce((n, m) => n + m.rallies, 0);
  const kept = matches.reduce((n, m) => n + Math.round(m.labRecall * m.rallies), 0);
  return {
    matches: matches.length,
    rallies,
    kept,
    recall: rallies > 0 ? (100 * kept) / rallies : 0,
    labCards: matches.reduce((n, m) => n + m.labCards, 0),
    productionCards: matches.reduce((n, m) => n + m.productionCards, 0),
    labBarren: matches.reduce((n, m) => n + m.labBarren, 0),
    productionBarren: matches.reduce((n, m) => n + m.productionBarren, 0),
    regions: matches.reduce((n, m) => n + m.regions.length, 0),
  };
}

/**
 * A run of N rallies with none lost does not prove a rate. The 95% lower
 * bound on recall after n successes and no failures is 0.05^(1/n), which is
 * the honest way to report "100% so far" — at 172 rallies it is 98.3%, not
 * 99.5%.
 */
export function lowerBound95(successes: number, failures: number): number {
  if (successes <= 0) return 0;
  if (failures > 0) return (100 * successes) / (successes + failures);
  return 100 * Math.pow(0.05, 1 / successes);
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
