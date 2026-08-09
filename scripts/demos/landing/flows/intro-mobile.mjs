/**
 * Introduction to PongLens, phone cut. 390x844.
 *
 * Same shot list as the desktop cut (intro.mjs); this file carries only
 * what is genuinely different about a phone, and every number in it comes
 * from mobile.mjs and coach-mobile.mjs rather than from a fresh guess.
 */

import { makeFlow, stage } from "./intro.mjs";
import { prepare as sharedPrepare, ALEX } from "./shared.mjs";
import { cleanup } from "./coach.mjs";

export const account = "uploader-test@example.com";
export const entry = "/dashboard";
/** The scoring beat writes winners on Alex and puts them back. */
export const guard = [ALEX];
export { stage, cleanup };

export const prepare = sharedPrepare;

export const flow = makeFlow({
  // ---- player half (mobile.mjs)
  // The mobile app bar is sticky and about 74px tall.
  headerClear: 74,
  uploadScroll: 260,
  // The deck is a snap carousel at this width, one card per screen.
  analysisSwipe: true,
  journalScroll: 340,
  // 57px sticky app bar, then the fixed match strip to 114.
  chromeClear: 114,
  // 40, not 22: it costs nothing here and it tucks the "Match analysis"
  // heading entirely behind the match strip rather than slicing it in half.
  deckGap: 40,
  heroSkip: 990,
  toolsSkip: 395,
  analysisSkip: 2646,
  placementSkip: 3314,
  opponentPad: "Alex",

  // ---- coach half (coach-mobile.mjs)
  coachAccount: "miguel-demo@example.com",
  // A phone stacks the storefront, so the top of the page is the coach and
  // the prices are a long way below it.
  pageAnchor: "Miguel Santos",
  pageGlide: "From their players",
  pageOffset: 90,
});
