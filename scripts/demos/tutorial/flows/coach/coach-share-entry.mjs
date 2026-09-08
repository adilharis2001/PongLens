import { account, coachGuard, CONNECTED_STUDENT_ID, OFFLINE_STUDENT_ID, makeRun } from "./shared.mjs";

export { account };
export const entry = `/coaching/students/${CONNECTED_STUDENT_ID}`;
export const guard = coachGuard(["coach_entries", "coach_entry_links"]);

export const scenes = [
  { beat: "private-entry", target: { text: "Journal", tag: "h3" }, label: "Private coaching record" },
  { beat: "share-with", target: { text: "Shared", tag: "span" }, label: "Shared with the student" },
  { beat: "updates", action: { type: "click", target: { text: "Backhand block and first change", tag: "button" } }, waitFor: { text: "Shared with", tag: "p" }, target: { text: "Shared with", tag: "p" }, label: "Live edits stay in sync" },
  { beat: "stop-sharing", target: { text: "Stop sharing", tag: "button" }, label: "Stop sharing at any time" },
  { beat: "public-link", route: `/coaching/students/${OFFLINE_STUDENT_ID}`, waitFor: { text: "Serve variation", tag: "button" }, action: { type: "click", target: { text: "Serve variation", tag: "button" } }, target: { text: "Copy link", tag: "button" }, label: "One public entry link" },
  { beat: "link-privacy", target: { text: "Copy link", tag: "button" }, label: "Only this entry" },
];

export const run = makeRun(scenes);
export const flow = run;
