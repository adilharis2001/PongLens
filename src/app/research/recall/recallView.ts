import type { RecallMatch, RecallRegion } from "./data";

/**
 * One question, four answers.
 *
 * The page used to offer five kinds of region and a grid of cause tags, and
 * it was rejected for good reason — most of its cards held more than one
 * rally, so auditing them told us nothing. The diagnosis has since narrowed
 * to a single fork: cards built on a detected serve are 0-14% junk, cards
 * built without one are 42-66% junk. So the only question worth an owner's
 * time is whether a serve was really there, and the answer decides between
 * two opposite fixes — find more serves, or make the fallback stricter.
 */
export const VERDICTS = [
  { value: "point_whole", label: "Real point, all of it here" },
  { value: "point_clipped", label: "Real point, cut short" },
  { value: "junk", label: "No point here" },
  { value: "unsure", label: "Can't tell" },
] as const;

export type Verdict = (typeof VERDICTS)[number]["value"];

/** What each kind is asking, in the reviewer's words. */
export const KINDS = [
  {
    value: "no_serve",
    label: "No serve found",
    question: "Is there a serve in this clip?",
    hint: "This card exists because ball motion was seen, not because a serve was. Two thirds of these are junk.",
    tone: "border-amber-400/50 bg-amber-500/15 text-amber-200",
  },
  {
    value: "served",
    label: "Serve found",
    question: "Does this clip hold the whole point?",
    hint: "A serve was detected here. These are almost never junk — spot checks only.",
    tone: "border-cyan-400/40 bg-cyan-500/10 text-cyan-200",
  },
  {
    value: "clipped",
    label: "Point cut short",
    question: "Which end is wrong — does it open late, or end early?",
    hint: "A real rally the cards cover too little of.",
    tone: "border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-200",
  },
  {
    value: "missing",
    label: "No card at all",
    question: "A real rally with no card. What is here?",
    hint: "The failure that matters most.",
    tone: "border-rose-400/50 bg-rose-500/15 text-rose-200",
  },
] as const;

export type Kind = (typeof KINDS)[number]["value"];

export function kindMeta(kind: string) {
  return KINDS.find((k) => k.value === kind) ?? KINDS[0];
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
  opts: { kind: string; onlyUnreviewed: boolean; done: Set<string> },
): RecallRegion[] {
  return regions.filter((r) => {
    if (opts.kind !== "all" && r.kind !== opts.kind) return false;
    if (opts.onlyUnreviewed && opts.done.has(r.id)) return false;
    return true;
  });
}

/** Junk rate over the cards a match emitted. */
export function junkRate(cards: number, junk: number): number {
  return cards > 0 ? (100 * junk) / cards : 0;
}

/**
 * Production junk rate minus the new one, in points. Positive means the new
 * pipeline shows the owner less rubbish.
 */
export function efficiencyGain(m: RecallMatch): number {
  return junkRate(m.prodCards, m.prodJunk) - junkRate(m.cards, m.junk);
}

/**
 * Only curated matches carry a real recall figure. Without curation every
 * card counts as a rally, junk included, and the percentage flatters.
 */
export function totals(matches: readonly RecallMatch[]) {
  const curated = matches.filter((m) => m.curated);
  const rallies = curated.reduce((n, m) => n + m.rallies, 0);
  const kept = curated.reduce(
    (n, m) => n + Math.round(m.recall * m.rallies),
    0,
  );
  const cards = curated.reduce((n, m) => n + m.cards, 0);
  const junk = curated.reduce((n, m) => n + m.junk, 0);
  return {
    matches: matches.length,
    curatedMatches: curated.length,
    rallies,
    kept,
    lost: rallies - kept,
    recall: rallies > 0 ? (100 * kept) / rallies : 0,
    cards,
    junk,
    junkRate: junkRate(cards, junk),
    servedCards: curated.reduce((n, m) => n + m.servedCards, 0),
    servedJunk: curated.reduce((n, m) => n + m.servedJunk, 0),
    fallbackCards: curated.reduce((n, m) => n + m.fallbackCards, 0),
    fallbackJunk: curated.reduce((n, m) => n + m.fallbackJunk, 0),
  };
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
