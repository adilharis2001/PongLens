/**
 * The coach walkthrough's narration as text, and its runtime.
 *
 * Typed by hand from scripts/demos/landing/chapters/coach.json rather than
 * generated, because that cut has no caption pipeline behind it; the coach
 * page's test compares these lines against the script so the two cannot
 * drift apart quietly. Same three readers as the player transcript: a
 * person who would rather skim than watch, a screen reader, and a crawler.
 *
 * The runtime is checked against the file, not against memory:
 *
 *   ffprobe -v error -show_entries format=duration \
 *     -of default=nw=1:nk=1 public/demo/coach-desktop.mp4
 */
export const COACH_WALKTHROUGH = {
  /** Human readable, for the play button. */
  length: "1:16",
  /** ISO 8601, for schema.org VideoObject. */
  duration: "PT1M16S",
  /** Whole seconds. A video sitemap wants a number, not a duration string. */
  durationSeconds: 76,
  /** The date the current cut was rendered. */
  uploaded: "2026-09-04",
  /** Every spoken line, in order. */
  lines: [
    "PongLens is a complete coaching workspace for lessons, students and remote reviews.",
    "Build a coach profile that presents your experience, your approach and the reviews you offer.",
    "Keep every student's lessons, journal entries, shared materials and matches together, so the whole coaching relationship stays visible.",
    "Record lessons as audio or video, and turn each session into a clear journal entry.",
    "Share the entries each student needs, so your feedback stays with them between sessions.",
    "When players send review requests, their matches and questions arrive together.",
    "Choose which orders to accept and keep every active review visible in one place.",
    "Review the match point by point, and connect written, drawn or spoken feedback to the rallies that show it.",
    "Deliver the finished review through PongLens, with payment and payouts handled for you.",
    "PongLens. A complete coaching workspace.",
  ],
} as const;

/** The whole narration as one paragraph, for VideoObject.transcript. */
export const COACH_TRANSCRIPT = COACH_WALKTHROUGH.lines.join(" ");
