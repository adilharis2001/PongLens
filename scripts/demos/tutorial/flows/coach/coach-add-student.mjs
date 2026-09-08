import { account, coachGuard, CONNECTED_STUDENT_ID, makeRun } from "./shared.mjs";

export { account };
export const entry = "/coaching/students";
export const guard = coachGuard(["coach_students"]);

export const scenes = [
  { beat: "students", target: { text: "Students", tag: "h1" }, label: "Students do not need an account" },
  { beat: "add-student", action: { type: "click", target: { text: "Add a student", tag: "button" } }, waitFor: { text: "They don't need the app", tag: "p" }, target: { sel: 'input[placeholder="Their name"]', within: { text: "They don't need the app", tag: "div" } }, label: "Enter their name" },
  { beat: "private-journal", route: "/coaching/students/0a5e0004-0000-4000-8000-000000000002", waitFor: { text: "Journal", tag: "h3" }, target: { text: "Journal", tag: "h3" }, label: "Their private journal" },
  { beat: "shared-matches", route: `/coaching/students/${CONNECTED_STUDENT_ID}`, waitFor: { text: "Matches", tag: "h3" }, target: { text: "Matches", tag: "h3" }, label: "Matches they share" },
  { beat: "student-actions", target: { text: "Manage", tag: "h3" }, label: "Rename, merge or remove" },
];

export const run = makeRun(scenes);
export const flow = run;
