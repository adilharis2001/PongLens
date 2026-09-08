/**
 * The first few points of an entry, for a card that is a doorway.
 *
 * In the Coaching feed a written or spoken entry is a preview: the title
 * and the first four points across the themes in order, then the whole
 * card opens the Journal on that entry. The Journal keeps the full card.
 * This is the one rule for "which four"; its twin on the phone is
 * previewPoints in Core/LessonPreview.swift, with the same cases in its
 * test. Callers hand it the visible themes, so a recap's link theme is
 * already gone before it is counted.
 */
export function previewPoints(
  themes: { name: string; points: string[] }[],
  limit = 4,
): string[] {
  const out: string[] = [];
  for (const theme of themes) {
    for (const point of theme.points) {
      const text = point.trim();
      if (!text) continue;
      out.push(text);
      if (out.length === limit) return out;
    }
  }
  return out;
}

/** Whether the preview left anything out, so the card can say "More". */
export function previewTruncates(
  themes: { name: string; points: string[] }[],
  limit = 4,
): boolean {
  let seen = 0;
  for (const theme of themes) {
    for (const point of theme.points) {
      if (!point.trim()) continue;
      seen += 1;
      if (seen > limit) return true;
    }
  }
  return false;
}
