/**
 * Introduction to PongLens, desktop cut. 1440x810.
 *
 * The take signs in as the PLAYER, because that is the half it opens on.
 * The coach's session is minted mid-take and followed behind the "For
 * coaches" separator — see flows/intro.mjs.
 *
 * The numbers below are lifted wholesale from desktop.mjs and
 * coach-desktop.mjs. Every one of them was measured against a real page at
 * this width rather than guessed, and the intro shows the same screens.
 */

import { makeFlow } from "./intro.mjs";
import { prepare as sharedPrepare, ALEX } from "./shared.mjs";
import { stage, cleanup } from "./coach.mjs";

export const account = "uploader-test@example.com";
export const entry = "/dashboard";
/** The scoring beat writes winners on Alex and puts them back. */
export const guard = [ALEX];
/**
 * The coach's order is rewound to `submitted` so the accept can be filmed,
 * and put back in the driver's finally. Nothing else in this take writes on
 * the coach side.
 */
export { stage, cleanup };

export const prepare = sharedPrepare;

export const flow = makeFlow({
  // ---- player half (desktop.mjs)
  headerClear: 40,
  // Both the upload card and the YouTube card are on screen at once at this
  // width, so the beat rings them in place rather than scrolling between.
  uploadScroll: 0,
  // AnalysisCards is `sm:grid sm:grid-cols-2` here — a grid, not a
  // carousel, so there is nothing to swipe.
  analysisSwipe: false,
  journalScroll: 200,
  // Where the match page's fixed chrome ends: a 65px sticky app bar with
  // the match strip pinned under it, reaching 122.
  chromeClear: 122,
  deckGap: 22,
  heroSkip: 1180,
  toolsSkip: 840,
  analysisSkip: 2795,
  placementSkip: 3819,
  // The floating score card packs the pads much smaller than the phone rail.
  padSize: { w: 70, h: 70 },
  opponentPad: "Alex",

  // ---- coach half (coach-desktop.mjs)
  coachAccount: "miguel-demo@example.com",
  pageAnchor: "Miguel Santos",
  pageGlide: "Full match review",
  pageOffset: 110,
});
