/**
 * A stable colour for any tag, including ones that do not exist yet.
 *
 * Tags are free text, so there is no fixed list to hand-assign colours
 * to. Hashing the word means "marketing" is the same colour on every
 * visit and on every device without storing anything, and a tag invented
 * next month gets a colour without a code change.
 *
 * The class strings are written out in full because Tailwind scans source
 * text: a class assembled at runtime never reaches the stylesheet.
 */

export interface TagTone {
  /** The chip a tag renders as. */
  chip: string;
  /** The bar down the side of a card, and the timeline dot. */
  dot: string;
}

const TONES: TagTone[] = [
  { chip: "border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow", dot: "bg-cyan-glow" },
  { chip: "border-magenta-glow/30 bg-magenta-glow/10 text-magenta-soft", dot: "bg-magenta-glow" },
  { chip: "border-amber-400/30 bg-amber-400/10 text-amber-300", dot: "bg-amber-400" },
  { chip: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", dot: "bg-emerald-400" },
  { chip: "border-violet-400/30 bg-violet-400/10 text-violet-300", dot: "bg-violet-400" },
  { chip: "border-sky-400/30 bg-sky-400/10 text-sky-300", dot: "bg-sky-400" },
  { chip: "border-rose-400/30 bg-rose-400/10 text-rose-300", dot: "bg-rose-400" },
  { chip: "border-lime-400/30 bg-lime-400/10 text-lime-300", dot: "bg-lime-400" },
];

const UNTAGGED: TagTone = {
  chip: "border-edge bg-ink/40 text-zinc-500",
  dot: "bg-zinc-700",
};

/**
 * The starter tags get one tone each, by hand.
 *
 * Hashing alone is fine for a long tail but careless for the handful of
 * words that carry most of the list: "design" and "marketing" happened to
 * hash two chips apart, which on a phone reads as the same colour twice.
 * Pinning the six the picker offers guarantees the common case is
 * legible, and everything else still gets a free stable colour.
 */
const PINNED: Record<string, number> = {
  dev: 0, // cyan
  marketing: 1, // magenta
  content: 4, // violet
  design: 6, // rose
  ops: 2, // amber
  research: 3, // emerald
};

export function tagTone(tag: string): TagTone {
  const key = tag.trim().toLowerCase();
  if (!key) return UNTAGGED;
  const pinned = PINNED[key];
  if (pinned !== undefined) return TONES[pinned];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return TONES[hash % TONES.length];
}
