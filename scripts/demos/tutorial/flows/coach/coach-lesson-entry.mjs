import {
  account,
  coachGuard,
  CONNECTED_STUDENT_ID,
  makeRun,
  SHARED_MATCH_ID,
} from "./shared.mjs";

export { account };
export const entry = `/coaching/students/${CONNECTED_STUDENT_ID}`;
export const guard = coachGuard(["coach_entries", "coach_entry_lessons", "coach_entry_photos"]);

const composer = { text: "Improve with AI", tag: "span" };
export const scenes = [
  { beat: "new-entry", action: { type: "click", target: { text: "New entry", tag: "button" } }, waitFor: { aria: "Entry text" }, target: { aria: "Entry text" }, label: "A new lesson entry" },
  { beat: "entry-text", action: { type: "fill", target: { aria: "Entry text" }, value: "Keep the first backhand block short, then change direction." }, target: { aria: "Entry text" }, label: "Type, paste or dictate" },
  { beat: "attachments", target: { text: "Add photo", tag: "button" }, label: "Add a photo or link" },
  { beat: "improve", target: composer, label: "Improve with AI" },
  { beat: "edit", target: { text: "Your rough notes become", tag: "span" }, label: "Review and edit the result" },
  { beat: "link-match", action: { type: "select", target: { aria: "Link a match" }, value: SHARED_MATCH_ID }, target: { aria: "Link a match" }, label: "Keep the match beside the entry" },
  { beat: "private", target: { text: "Save entry", tag: "button" }, label: "Private until you share" },
];

export const run = makeRun(scenes);
export const flow = run;
