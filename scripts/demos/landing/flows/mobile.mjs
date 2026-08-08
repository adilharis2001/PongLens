/**
 * Landing video, phone cut. 390x844.
 *
 * The shot list lives in shared.mjs so both cuts tell the same story; this
 * file only carries what is genuinely different about a phone.
 */

import { makeFlow, prepare as sharedPrepare, ALEX } from "./shared.mjs";

export const account = "uploader-test@example.com";
export const entry = "/dashboard";
/** Keep score writes. Restore whatever it touches. */
export const guard = [ALEX];

export const prepare = sharedPrepare;

export const flow = makeFlow({
  // The mobile app bar is sticky and about 74px tall.
  headerClear: 74,
  uploadScroll: 260,
  // The deck is a snap carousel at this width, one card per screen.
  analysisSwipe: true,
  journalScroll: 340,
  // 57px sticky app bar, then the fixed "Alex · PingPod 1-1" strip to 114.
  chromeClear: 114,
  // 40, not 22: it costs nothing here (the card still clears the tab bar)
  // and it tucks the "Match analysis" heading entirely behind the match
  // strip rather than slicing it down the middle.
  deckGap: 40,
  heroSkip: 990,
  opponentPad: "Alex",
});
