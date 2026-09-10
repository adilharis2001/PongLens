"use client";

import { Brief, type BriefPage } from "@/components/RecordingBrief";

/**
 * The two lesson briefs: the pages only. The walk itself is the recording
 * brief's shell (Brief), so all three behave identically — no way out but
 * through, Back always there, swipe between pages, and the last page's
 * button is the exit.
 *
 * Same drawing rules as public/brief/p*.svg, exported to iOS PNGs by
 * scripts/brief/export-ios.mjs. The words are written twice, here and in
 * the Swift twin, exactly as the recording brief's are.
 *
 * AUDIO IS IPHONE-ONLY. There is no audio lesson recorder on the web, so
 * the audio pages live here for one reason: the words must be written in
 * the same file the video ones are, or the two platforms drift. Nothing on
 * the web opens LESSON_AUDIO_BRIEF_PAGES today.
 */

export const LESSON_AUDIO_BRIEF_PAGES: BriefPage[] = [
  {
    src: "/brief/a1.svg",
    alt: "A voice waveform feeding into a written journal entry: a lesson title, a theme heading, and the points under it.",
    title: "Your lesson, written up",
    body: "Record the lesson and PongLens writes it up: a short title, the themes your coach kept coming back to, and the points under each one. The full transcript is kept with it, so the exact words are there when you want them.",
  },
  {
    src: "/brief/a2.svg",
    alt: "Side view: the phone lies flat on the table beside the net, screen down, with the coach talking nearby.",
    title: "Put the phone near the net",
    body: "Screen down, near the net, with nothing covering the microphone. It only has to hear your coach talking, not the ball. Lock the phone and leave it there for the whole lesson, and pause it when the session breaks. Two hours is no problem.",
  },
  {
    src: "/brief/a3.svg",
    alt: "The review screen before saving: a Notes and Transcript switch, the written notes below it, and the Add to journal button.",
    title: "Read it before it is saved",
    body: "When you finish, the notes and the transcript come up for you to check. Fix any names or terms the microphone got wrong, then add it to your journal. The recording itself is not kept: the journal keeps the words.",
  },
];

export const LESSON_VIDEO_BRIEF_PAGES: BriefPage[] = [
  {
    src: "/brief/v1.svg",
    alt: "A long lesson recording cut down to a short recap: a video frame with the coach's words written beside it, marked as a chapter.",
    title: "A short recap of the whole lesson",
    body: "Import a lesson you filmed and PongLens turns it into a recap: the moments where you taught something, cut together into chapters, with what you said written beside each one. A ninety-minute lesson usually comes back as ten to fifteen minutes.",
    aspect: "320 / 300",
  },
  {
    src: "/brief/v2.svg",
    alt: "Seen from above: the camera stands diagonally beside the table on the coach's side, close enough to hear them, with the whole table in view.",
    title: "Film so your voice is heard",
    body: "The recap is built from what you say, so put the camera on your side of the table, angled across it, close enough to pick you up over the ball. Landscape, 1080p at 30 fps. A lesson with no sound on it cannot be made into a recap.",
  },
  {
    src: "/brief/v3.svg",
    alt: "The chapter list of a finished recap, each chapter editable, above the button that shares it with the student.",
    title: "Check it, then send it",
    body: "The recap comes back for you to read through. Rename a chapter, fix a line, take out anything that does not belong, then share it and it lands in your student's journal. Nothing reaches them until you send it.",
  },
];

export function LessonAudioBrief({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  return (
    <Brief
      open={open}
      pages={LESSON_AUDIO_BRIEF_PAGES}
      finalLabel="Start recording"
      onDone={onDone}
    />
  );
}

export function LessonVideoBrief({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  return (
    <Brief
      open={open}
      pages={LESSON_VIDEO_BRIEF_PAGES}
      finalLabel="Continue"
      onDone={onDone}
    />
  );
}
