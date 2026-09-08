import { account, coachGuard, CONNECTED_STUDENT_ID, OFFLINE_STUDENT_ID, makeRun } from "./shared.mjs";

export { account };
export const entry = `/coaching/students/${OFFLINE_STUDENT_ID}`;
export const guard = coachGuard(["coach_students", "coach_student_invites"]);

export const scenes = [
  { beat: "invite", action: { type: "click", target: { text: "Invite Maya Chen", tag: "button" } }, waitFor: { text: "Copy link", tag: "button" }, target: { text: "Copy link", tag: "button" }, label: "Send the invite link" },
  { beat: "connect", target: { text: "Opening this link", tag: "p" }, label: "Connect to the existing row" },
  { beat: "match-access", target: { text: "Opening this link", tag: "p" }, label: "All matches or selected matches" },
  { beat: "privacy", route: `/coaching/students/${CONNECTED_STUDENT_ID}`, waitFor: { text: "On PongLens", tag: "p" }, target: { text: "Matches", tag: "h3" }, label: "Only shared matches" },
  { beat: "merge", action: { type: "click", target: { text: "Same as an existing student", tag: "button" } }, waitFor: { text: "Which student are they?", tag: "p" }, target: { text: "Which student are they?", tag: "p" }, label: "Merge the duplicate" },
];

export const run = makeRun(scenes);
export const flow = run;
