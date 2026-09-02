/**
 * The tutorial chapters, in the order they teach the product.
 *
 * Deliberately its own list rather than a field on `guides.ts`: the written
 * guides and the videos are separate ways in, and a reader who wants text
 * should not be nudged into video (or the reverse). Where a chapter has an
 * obvious written counterpart, `guide` links the two so each can offer the
 * other without merging them.
 *
 * The files live at r2://ponglens-media/tutorial/<slug>.mp4 and are served
 * through /api/tutorial-url. They are captured and rendered by
 * scripts/demos/tutorial — re-run that after a UI change and the chapter
 * re-records itself.
 */
export interface Chapter {
  n: number;
  slug: string;
  title: string;
  blurb: string;
  seconds: number;
  /** The written guide covering the same ground, when there is one. */
  guide?: string;
}

export const CHAPTERS: Chapter[] = [
  {
    n: 1,
    slug: "home",
    title: "Start here",
    blurb: "What PongLens does, and what home is showing you.",
    seconds: 34,
  },
  {
    n: 2,
    slug: "upload",
    title: "Upload a match",
    blurb: "Send a video in from your phone, or paste a YouTube link.",
    seconds: 39,
    guide: "upload-a-video",
  },
  {
    n: 3,
    slug: "viewer",
    title: "Watch it back",
    blurb: "The player, and the gestures that are not written on it.",
    seconds: 55,
    guide: "match-viewer",
  },
  {
    n: 4,
    slug: "point",
    title: "Score a point",
    blurb: "One rally at a time, with the follow-ups that feed your stats.",
    seconds: 32,
    guide: "score-points",
  },
  {
    n: 5,
    slug: "keepscore",
    title: "Score the Match",
    blurb: "Score a whole match far faster than watching it back.",
    seconds: 60,
    guide: "score-keeper",
  },
  {
    n: 6,
    slug: "analysis",
    title: "Read your match",
    blurb: "How it swung, the numbers, and where the ball landed.",
    seconds: 43,
    guide: "match-analysis",
  },
  {
    n: 7,
    slug: "export",
    title: "Export and share",
    blurb: "Stars, tags, and a video with the scoreboard burned in.",
    seconds: 41,
    guide: "export",
  },
  {
    n: 8,
    slug: "coach",
    title: "You and your coach",
    blurb: "Invite them, and let them draw on the points that matter.",
    seconds: 50,
    guide: "invite-a-coach",
  },
  {
    n: 9,
    slug: "journal",
    title: "The journal",
    blurb: "Notes, lessons, scanned pages, and Recollect.",
    seconds: 55,
    guide: "journal",
  },
];

export const TOTAL_SECONDS = CHAPTERS.reduce((s, c) => s + c.seconds, 0);

export function chapterBySlug(slug: string): Chapter | undefined {
  return CHAPTERS.find((c) => c.slug === slug);
}

/** "6 min" — the whole set, for the entry points that promise a length. */
export function totalLabel(): string {
  return `${Math.round(TOTAL_SECONDS / 60)} min`;
}
