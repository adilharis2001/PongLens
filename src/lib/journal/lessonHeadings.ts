/**
 * The two lists that bracket a session's notes.
 *
 * A lesson video recap shows them as cards before the first clip and after
 * the last one; an audio session has no cards, so they arrive as two
 * ordinary headings, first and last, inside the same title-plus-headings
 * shape the journal already stores. No schema change, and both editors can
 * already correct the points inside a heading.
 *
 * The names live here because the distilling prompt and the merge prompt in
 * /api/lesson both have to name them, and a heading named twice is a heading
 * that can drift: one prompt writing "Lesson goals" and the other "Goals"
 * would quietly split a long session's list in two and leave neither in the
 * right place. The caps match MAX_GOALS and MAX_WORK_ON on the video side
 * (src/lib/lessonVideo/model.ts and worker/lesson_video.py), so the same
 * session says the same thing whichever way it was recorded.
 */

/** First heading: what the session set out to improve. */
export const GOALS_HEADING = "Lesson goals";

/** Last heading: what to practise or keep in mind afterwards. */
export const WORK_ON_HEADING = "Things to work on";

/** Most sessions state one or two goals; five is a ceiling, not a target. */
export const MAX_GOALS = 5;

/** A follow-up list worth reading has at least two lines. */
export const MIN_WORK_ON = 2;
export const MAX_WORK_ON = 6;
