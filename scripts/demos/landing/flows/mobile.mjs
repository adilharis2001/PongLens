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
  journalScroll: 340,
  statsScroll: 190,
  chartNudge: 210,
  opponentPad: "Alex",
});
