import { account, CONNECTED_STUDENT_ID, SHARED_MATCH_ID, makeRun } from "./shared.mjs";
import {
  playerGuard,
  stagePlayerMatch,
} from "../../fixtures/player-match.mjs";

export { account };
export const entry = `/coaching/students/${CONNECTED_STUDENT_ID}`;
export const guard = playerGuard;
export const stage = stagePlayerMatch;

export const scenes = [
  { beat: "shared-matches", target: { text: "Matches", tag: "h3" }, label: "Matches beside lesson entries" },
  { beat: "open-match", route: `/match/${SHARED_MATCH_ID}`, waitFor: { text: "Original", tag: "button" }, target: { text: "Original", tag: "button" }, label: "Cut or original video" },
  { beat: "point-by-point", action: { type: "click", target: { aria: "Play the full video" } }, waitFor: { aria: "Next point" }, target: { aria: "Next point" }, label: "Move point by point" },
  { beat: "analysis-maps", route: `/match/${SHARED_MATCH_ID}`, waitFor: { text: "Serve placement", tag: "h2" }, target: { text: "Match analysis", tag: "h2" }, secondaryTarget: { text: "Serve placement", tag: "h2" }, primaryLabel: "Match analysis", secondaryLabel: "Serve placement" },
  { beat: "read-only", target: { text: "Match analysis", tag: "h2" }, label: "The student's match stays read-only" },
  { beat: "access-update", route: `/coaching/students/${CONNECTED_STUDENT_ID}`, waitFor: { text: "Matches", tag: "h3" }, target: { text: "Matches", tag: "h3" }, label: "The list follows their access" },
];

export const run = makeRun(scenes);
export const flow = run;
