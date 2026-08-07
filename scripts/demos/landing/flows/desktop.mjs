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
export const entry = `/match/efff9208-abf2-4a20-a498-18cc5a5130b3`;
export const guard = [ALEX];

export const prepare = sharedPrepare;

export const flow = makeFlow({
  // The desktop header is shorter and does not overlap content the same way.
  headerClear: 40,
  uploadScroll: 120,
  journalScroll: 200,
  statsScroll: 240,
  opponentPad: "Alex",
});
