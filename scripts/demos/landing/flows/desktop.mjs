/**
 * Landing video, desktop cut. 1440x810.
 *
 * Same shot list as the phone (shared.mjs), different viewport and scroll
 * distances. A wide window shows far more of each page at once, so the
 * headings need less backing off and the pages need less scrolling — a
 * mobile scroll distance on desktop overshoots the thing it was meant to
 * bring into view.
 */

import { makeFlow, prepare as sharedPrepare, ALEX } from "./shared.mjs";

export const account = "uploader-test@example.com";
export const entry = "/dashboard";
export const guard = [ALEX];

export const prepare = sharedPrepare;

export const flow = makeFlow({
  // The desktop header is shorter and does not overlap content the same way.
  headerClear: 40,
  // Both the upload card and the YouTube card are on screen at once at this
  // width, so the beat rings them in place rather than scrolling between.
  uploadScroll: 0,
  // AnalysisCards is `sm:grid sm:grid-cols-2` — a grid, not a carousel, so
  // there is nothing here that scrolls sideways.
  analysisSwipe: false,
  journalScroll: 200,
  // Anchored at the card top, the desktop frame already holds the whole
  // Overview card. Any further scroll lands in Placement maps.
  statsScroll: 0,
  mapNudge: 60,
  chartNudge: 150,
  // The floating card packs the pads much smaller than the phone rail.
  padSize: { w: 70, h: 70 },
  opponentPad: "Alex",
});
