import {
  RECOLLECT_TOPIC_KEYS,
  type RecollectThemeInput,
  type RecollectTopicKey,
  type SortedPoint,
} from "./types.ts";

const KEYS = new Set<string>(RECOLLECT_TOPIC_KEYS);

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function bounded(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Compare two points the way a reader would: ignoring case, punctuation
 *  and spacing, so "Keep the racket high." and "keep the racket high"
 *  are one point. */
export function normalizePointText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read the model's sort. Everything here is a rejection rule: a point that
 * does not name a topic on the list, or whose text did not come from the
 * source, is dropped rather than repaired.
 */
export function parseSortedPoints(
  raw: unknown,
  allowedText: string[],
): SortedPoint[] {
  const rows = object(raw).points;
  if (!Array.isArray(rows)) return [];

  // The model is told to copy text verbatim. Holding it to that is what
  // keeps Recollect unable to invent advice: anything it rephrased or made
  // up simply will not match, and is dropped.
  const permitted = new Map<string, string>();
  for (const text of allowedText) {
    const key = normalizePointText(text);
    if (key) permitted.set(key, text);
  }

  const seen = new Set<string>();
  const sorted: SortedPoint[] = [];
  for (const rawRow of rows.slice(0, 60)) {
    const row = object(rawRow);
    const topicKey = bounded(row.topic_key, 40);
    const text = bounded(row.text, 400);
    const normalized = normalizePointText(text);
    if (!KEYS.has(topicKey) || !normalized || seen.has(normalized)) continue;

    const source = permitted.get(normalized);
    // A short raw note has no pre-split source text to match against, so
    // `allowedText` is empty and the model's own split is taken as given.
    if (permitted.size > 0 && !source) continue;

    seen.add(normalized);
    sorted.push({
      topicKey: topicKey as RecollectTopicKey,
      text: source ?? text,
      themeName: bounded(row.theme_name, 120) || null,
      duplicate: row.duplicate === true,
    });
  }
  return sorted;
}

/** Flatten an entry's themes into the lines the model is allowed to keep. */
export function themePoints(themes: RecollectThemeInput[]): string[] {
  return themes.flatMap((theme) =>
    theme.points.map((point) => point.trim()).filter(Boolean),
  );
}
