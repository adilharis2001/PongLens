"use client";

import { Brief, type BriefPage } from "@/components/RecordingBrief";

/**
 * The lesson briefs: the pages only. The walk itself is the recording
 * brief's shell (Brief), so they all behave identically: no way out but
 * through, Back always there, swipe between pages, and the last page's
 * button is the exit.
 *
 * Same drawing rules as public/brief/p*.svg, exported to iOS PNGs by
 * scripts/brief/export-ios.mjs. The words are written twice, here and in
 * the Swift twin, exactly as the recording brief's are.
 *
 * FOUR BRIEFS, BECAUSE THERE ARE FOUR DOORS. Both features can be opened
 * by a player or by a coach, and the two are not doing the same thing. A
 * player records the lesson they are being given and keeps it; a coach
 * records the one they are giving and files it under a student. Writing
 * one brief for both leaves half the readers being addressed as somebody
 * they are not, which is exactly what shipped on 2026-09-10: the coach's
 * own recorder told them the notes would capture "what your coach kept
 * coming back to".
 *
 * Most of the drawings are true for either reader and are shared. Only
 * the ENDING differs enough to need its own picture, because that is the
 * one thing the two doors genuinely do differently.
 *
 * AUDIO IS IPHONE-ONLY. There is no audio lesson recorder on the web, so
 * the audio pages live here for one reason: the words must be written in
 * the same file the video ones are, or the two platforms drift. Nothing on
 * the web opens the audio page sets today.
 */

/** The player's own recorder: the lesson they are being given. */
export const LESSON_AUDIO_PLAYER_BRIEF_PAGES: BriefPage[] = [
  {
    src: "/brief/a1.svg",
    alt: "A voice waveform feeding into a written journal entry: a lesson title, a theme heading, and the points under it.",
    title: "Your lesson, written up",
    body: "Record the lesson and PongLens writes it up for you. You get a short title, the things your coach kept coming back to, and the points under each one. The full transcript is saved with it, so you can go back to the exact words later.",
  },
  {
    src: "/brief/a2.svg",
    alt: "Side view: the phone lies flat on the table beside the net, screen down, with the coach talking nearby.",
    title: "Put the phone near the net",
    body: "Rest it near the net with the screen down and nothing covering the microphone. It only has to hear your coach talking, not the ball. You can lock the phone and leave it there for the whole lesson, and pause it when you take a break. A two-hour lesson is fine.",
  },
  {
    src: "/brief/a3.svg",
    alt: "The review screen before saving: a Notes and Transcript switch, the written notes below it, and the Add to journal button.",
    title: "Read it before it is saved",
    body: "When you finish, the notes and the transcript come up for you to read. Fix any names or terms the microphone got wrong, then add it to your journal. The recording is deleted once you save, and only the written notes and transcript stay in your journal.",
  },
];

/**
 * The coach's recorder: the lesson they are giving. Same three ideas, but
 * the person talking is the reader, and it is filed under a student
 * instead of landing in the reader's own journal.
 */
export const LESSON_AUDIO_COACH_BRIEF_PAGES: BriefPage[] = [
  {
    src: "/brief/a1.svg",
    alt: "A voice waveform feeding into a written lesson entry: a lesson title, a theme heading, and the points under it.",
    title: "Your lesson, written up",
    body: "Record the lesson and PongLens writes it up for you. You get a short title, the things you kept coming back to, and the points under each one. The full transcript is saved with it, so you can go back to the exact words later.",
  },
  {
    src: "/brief/a2.svg",
    alt: "Side view: the phone lies flat on the table beside the net, screen down, with someone talking nearby.",
    title: "Put the phone near the net",
    body: "Rest it near the net with the screen down and nothing covering the microphone. It only has to hear you talking, not the ball. You can lock the phone and leave it there for the whole lesson, and pause it when you take a break. A two-hour lesson is fine.",
  },
  {
    src: "/brief/a3c.svg",
    alt: "The review screen before saving: a Notes and Transcript switch, the written notes below it, and the Save to student button.",
    title: "You see it before your student does",
    body: "When you finish, the notes and the transcript come up for you to read. Fix any names or terms the microphone got wrong, then save it to your student. It waits in their file until you send it, and the recording itself is deleted once you save.",
  },
];

/** The coach importing a lesson they gave, to send back to a student. */
export const LESSON_VIDEO_COACH_BRIEF_PAGES: BriefPage[] = [
  {
    src: "/brief/v1.svg",
    alt: "A long lesson recording cut down to a short recap: a video frame with the spoken words written beside it, marked as a chapter.",
    title: "A short recap of the whole lesson",
    body: "Import a lesson you filmed and PongLens turns it into a short recap. It finds the moments where you taught something and cuts them together into chapters, with what you said written beside each one. A ninety-minute lesson usually comes back as ten to fifteen minutes.",
    aspect: "320 / 300",
  },
  {
    src: "/brief/v2.svg",
    alt: "Seen from above: the camera stands diagonally beside the table on the coach's side, close enough to hear them, with the whole table in view.",
    title: "Film so your voice is heard",
    body: "The recap is built from what you say, so put the camera on your side of the table, angled across it and close enough to pick you up over the ball. Film landscape at 1080p and 30 fps. If the video has no sound on it, there is nothing to build a recap from.",
  },
  {
    src: "/brief/v3.svg",
    alt: "The chapter list of a finished recap, each chapter editable, above the button that shares it with the student.",
    title: "Check it, then send it",
    body: "The recap comes back for you to read through first. Rename a chapter, fix a line, or take out anything that does not belong. When you share it, it lands in your student's journal, and nothing reaches them until you do.",
  },
];

/**
 * The player importing a lesson they were given. Two things genuinely
 * differ from the coach's: the camera has to hear the OTHER person, and
 * there is no sending at the end. A player's recap publishes itself,
 * privately, the first time they open it (Adil, 2026-09-07), so the last
 * page teaches where it went rather than what to press.
 */
export const LESSON_VIDEO_PLAYER_BRIEF_PAGES: BriefPage[] = [
  {
    src: "/brief/v1.svg",
    alt: "A long lesson recording cut down to a short recap: a video frame with the spoken words written beside it, marked as a chapter.",
    title: "A short recap of your lesson",
    body: "Import a lesson you filmed and PongLens turns it into a short recap. It finds the moments where your coach was teaching you something and cuts them together into chapters, with what they said written beside each one. A ninety-minute lesson usually comes back as ten to fifteen minutes.",
    aspect: "320 / 300",
  },
  {
    src: "/brief/v2.svg",
    alt: "Seen from above: the camera stands diagonally beside the table on the coach's side, close enough to hear them, with the whole table in view.",
    title: "Film so your coach is heard",
    body: "The recap is built from what your coach says, so put the camera on their side of the table, angled across it and close enough to pick them up over the ball. Film landscape at 1080p and 30 fps. If the video has no sound on it, there is nothing to build a recap from.",
  },
  {
    src: "/brief/v3p.svg",
    alt: "The chapter list of a finished recap, above a line saying it is saved to your journal and an unticked box for sharing it with your coach.",
    title: "It saves itself to your journal",
    body: "Before you choose the video, you say who taught the lesson. The recap goes into your journal under that coach as soon as it is ready, and only you can see it. If you want your coach to have it, there is a box to tick on the recap.",
  },
];

export function LessonAudioPlayerBrief({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  return (
    <Brief
      open={open}
      pages={LESSON_AUDIO_PLAYER_BRIEF_PAGES}
      finalLabel="Start recording"
      onDone={onDone}
    />
  );
}

export function LessonAudioCoachBrief({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  return (
    <Brief
      open={open}
      pages={LESSON_AUDIO_COACH_BRIEF_PAGES}
      finalLabel="Start recording"
      onDone={onDone}
    />
  );
}

export function LessonVideoCoachBrief({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  return (
    <Brief
      open={open}
      pages={LESSON_VIDEO_COACH_BRIEF_PAGES}
      finalLabel="Continue"
      onDone={onDone}
    />
  );
}

export function LessonVideoPlayerBrief({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  return (
    <Brief
      open={open}
      pages={LESSON_VIDEO_PLAYER_BRIEF_PAGES}
      finalLabel="Continue"
      onDone={onDone}
    />
  );
}
