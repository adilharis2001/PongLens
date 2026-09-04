import type { TutorialChapter } from "./catalogTypes.ts";

const playerChapter = (
  slug: string,
  title: string,
  blurb: string,
  seconds: number,
  guide?: string,
): TutorialChapter => ({
  slug,
  title,
  blurb,
  seconds,
  guide,
  visibility: { audiences: ["player"], platforms: ["web", "ios"] },
  mediaKey: `tutorial/player/${slug}.mp4`,
});

const coachChapter = (
  slug: string,
  title: string,
  blurb: string,
  seconds: number,
  platforms: TutorialChapter["visibility"]["platforms"],
  guide?: string,
): TutorialChapter => ({
  slug,
  title,
  blurb,
  seconds,
  guide,
  visibility: { audiences: ["coach"], platforms },
  mediaKey: `tutorial/coach/${slug}.mp4`,
});

export const tutorialChapters: TutorialChapter[] = [
  playerChapter("home", "Start here", "What PongLens does and what Home is showing you.", 34),
  playerChapter("upload", "Upload a match", "Send a video in from your phone or paste a YouTube link.", 39, "upload-a-video"),
  playerChapter("viewer", "Watch it back", "The player and the gestures that are not written on it.", 55),
  playerChapter("point", "Score a point", "One rally at a time, with the follow-ups that feed your stats.", 32),
  playerChapter("keepscore", "Score Keeper", "Score a whole match far faster than watching it back.", 60),
  playerChapter("analysis", "Read your match", "How it swung, the numbers, and where the ball landed.", 43),
  playerChapter("export", "Export and share", "Stars, tags, and a video with the scoreboard burned in.", 41),
  playerChapter("coach", "You and your coach", "Invite them and let them draw on the points that matter.", 50),
  playerChapter("journal", "The journal", "Notes, lessons, scanned pages, and Recollect.", 55),
  coachChapter("coach-start", "Start coaching", "See the coaching workspace and the roster.", 42, ["web", "ios"], "coaching-workspace"),
  coachChapter("coach-add-student", "Add a student", "Create a student and invite them when they are ready.", 44, ["web", "ios"]),
  coachChapter("coach-connect-account", "Connect an account", "Link a student account and choose match access.", 46, ["web", "ios"]),
  coachChapter("coach-lesson-entry", "Keep lesson entries", "Turn lesson notes into useful next steps.", 48, ["web", "ios"]),
  coachChapter("coach-audio-lesson", "Record an audio lesson", "Capture an audio lesson and review the notes.", 50, ["web", "ios"]),
  coachChapter("coach-share-entry", "Share an entry", "Send an entry to a student’s Journal.", 43, ["web", "ios"]),
  coachChapter("coach-review-match", "Review a match", "Use a shared match to guide a student’s review.", 51, ["web", "ios"]),
  coachChapter("coach-feedback", "Leave feedback", "Add feedback to the points that matter.", 49, ["web", "ios"]),
  coachChapter("coach-paid-review", "Complete a paid review", "Finish a paid review and deliver it to the student.", 52, ["web"]),
];
