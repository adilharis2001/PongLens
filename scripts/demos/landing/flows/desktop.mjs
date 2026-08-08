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
import { stage as stageReview, cleanup as clearReview } from "./review.mjs";

export const account = "uploader-test@example.com";
export const entry = "/dashboard";
export const guard = [ALEX];
/** The paid review is created for the shoot and removed after it. */
export const stage = stageReview;
export const cleanup = clearReview;

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
  // Where the match page's fixed chrome ends: a 65px sticky app bar with the
  // "Alex · PingPod 1-1" strip pinned under it, reaching 122. Measured, not
  // guessed — both beats that get anchored against it were shot with their
  // tops behind it.
  chromeClear: 122,
  // 22px below the chrome puts the deck fully clear and leaves the section
  // heading hidden above it. The one thing left in the band is the "score
  // the points to fill this in" subtitle, which no offset can rescue: it
  // sits between the app bar and the match strip at every scroll position
  // that also clears the cards.
  deckGap: 22,
  // How far down to land on the match page, past the hero the signed URL
  // keeps black for a second or two. Measured to the Points heading, so the
  // first frame that paints is already the shot the beat wants.
  heroSkip: 1180,
  // The tools card, measured the same way: land where the beat wants to be
  // rather than scrolling there once the line has started.
  toolsSkip: 840,
  // The floating card packs the pads much smaller than the phone rail.
  padSize: { w: 70, h: 70 },
  opponentPad: "Alex",
});
