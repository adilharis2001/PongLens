import {
  account,
  coachGuard,
  SHARED_MATCH_ID,
  makeRun,
  waitForMatchPreview,
} from "./shared.mjs";

export { account };
export const entry = `/match/${SHARED_MATCH_ID}?p=48`;
export const guard = coachGuard(["notes", "note_drawings"]);

export async function prepare(page) {
  await page.waitForSelector("text=Notes", { timeout: 90000 });
  await waitForMatchPreview(page);
  await page.waitForFunction(
    () => {
      const video = document.querySelector('[role="dialog"] video');
      return video && video.readyState >= 2 && video.videoWidth > 0;
    },
    undefined,
    { timeout: 30000 },
  );
  await page.waitForTimeout(600);
}

const pointSheet = { sectionOf: "Notes" };
export const scenes = [
  { beat: "open-point", target: { aria: "Close point view" }, label: "Open the exact rally" },
  { beat: "point-note", target: { sel: "textarea", within: pointSheet }, label: "Write or record a note" },
  { beat: "drawing", target: { text: "Draw", tag: "button", within: pointSheet }, label: "Draw on a paused frame" },
  { beat: "overall-notes", action: { type: "click", target: { aria: "Close point view" } }, waitFor: { text: "Overall notes", tag: "h2" }, target: { text: "Overall notes", tag: "h2" }, label: "Feedback across the match" },
  { beat: "student-view", target: { text: "Overall notes", tag: "h2" }, label: "Feedback reaches the student" },
  { beat: "context", action: { type: "click", target: { aria: "Open point 48" } }, waitFor: { text: "Notes", tag: "h3" }, target: { text: "Notes", tag: "h3" }, label: "Always tied to the footage", transition: "dialog-video" },
];

export const run = makeRun(scenes);
export const flow = run;
