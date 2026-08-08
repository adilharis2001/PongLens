/**
 * Coach video, phone cut. 390x844.
 *
 * Same shot list as the desktop cut (coach.mjs), different viewport and
 * scroll distance. A phone shows far less of each page at once, so the
 * review has further to travel to bring its last section into frame.
 */

import { makeFlow, prepare as sharedPrepare, stage, cleanup } from "./coach.mjs";

export const account = "miguel-demo@example.com";
export const entry = "/coach/miguel";
export { stage, cleanup };

export const prepare = sharedPrepare;

export const flow = makeFlow({
  // Reversed from the desktop cut. A phone stacks the storefront, so the
  // top of the page is the coach and the prices are a long way below it.
  // The intro line is about getting paid, so it goes to the prices; the
  // page line is about who you are, so it goes back to the top.
  introAnchor: "Full match review",
  pageAnchor: "Miguel Santos",
  pageBlock: "start",
  reviewScroll: 900,
});
