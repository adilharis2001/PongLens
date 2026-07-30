import type { RecollectSegment } from "./types.ts";

export const RECOLLECT_SEGMENT_CHARS = 24_000;
export const RECOLLECT_SEGMENT_OVERLAP = 1_200;
const BREAK_SEARCH_CHARS = 4_000;

export function splitRecollectSource(text: string): RecollectSegment[] {
  if (text.length === 0) return [];
  if (text.length <= RECOLLECT_SEGMENT_CHARS) {
    return [{ index: 0, start: 0, end: text.length, text }];
  }

  const segments: RecollectSegment[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + RECOLLECT_SEGMENT_CHARS);
    let end = hardEnd;
    if (hardEnd < text.length) {
      const searchFrom = Math.max(start + 1, hardEnd - BREAK_SEARCH_CHARS);
      const paragraph = text.lastIndexOf("\n\n", hardEnd);
      const line = text.lastIndexOf("\n", hardEnd);
      const candidate = Math.max(paragraph >= searchFrom ? paragraph + 2 : -1, line >= searchFrom ? line + 1 : -1);
      if (candidate > start) end = candidate;
    }
    segments.push({
      index: segments.length,
      start,
      end,
      text: text.slice(start, end),
    });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - RECOLLECT_SEGMENT_OVERLAP);
  }
  return segments;
}
