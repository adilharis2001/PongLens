export {
  tutorialTotalSeconds,
  visibleChapters,
} from "../catalog.ts";
export type { NumberedTutorialChapter as Chapter } from "../catalogTypes.ts";

import { tutorialTotalSeconds, visibleChapters } from "../catalog.ts";

/** @deprecated Use visibleChapters with an explicit audience and platform. */
export const CHAPTERS = visibleChapters("player", "web");
/** @deprecated Use tutorialTotalSeconds with an explicit audience and platform. */
export const TOTAL_SECONDS = tutorialTotalSeconds("player", "web");

/** @deprecated Use visibleChapters with an explicit audience and platform. */
export function chapterBySlug(slug: string) {
  return CHAPTERS.find((chapter) => chapter.slug === slug);
}

/** "6 min" — the whole set, for the entry points that promise a length. */
export function totalLabel(): string {
  return `${Math.round(TOTAL_SECONDS / 60)} min`;
}
