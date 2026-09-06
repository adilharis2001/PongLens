import {
  account,
  blockReviewSweep,
  CONNECTED_STUDENT_ID,
  makeRun,
} from "./shared.mjs";

export { account };
export const entry = "/coaching/students";

export async function prepare(page) {
  await blockReviewSweep(page);
}

export const scenes = [
  { beat: "overview", route: "/coaching", waitFor: { text: "Coaching", tag: "h1" }, target: { text: "Coaching", tag: "h1" }, label: "Your coaching workspace" },
  { beat: "recent", target: { text: "Recent entries", tag: "h2" }, label: "Students and recent entries" },
  { beat: "students", route: "/coaching/students", waitFor: { text: "Students", tag: "h1" }, target: { text: "Students", tag: "h1" }, label: "Your full roster" },
  { beat: "new-entry", route: `/coaching/students/${CONNECTED_STUDENT_ID}`, waitFor: { text: "New entry", tag: "button" }, target: { text: "New entry", tag: "button" }, label: "Write a lesson entry" },
  { beat: "mode-switch", target: { aria: "Switch to player mode" }, label: "Playing and Coaching" },
];

export const run = makeRun(scenes);
export const flow = run;
