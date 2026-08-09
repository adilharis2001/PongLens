/**
 * Coach video, desktop cut. 1440x810.
 *
 * Desktop first for this one: building a review is a two-pane laptop
 * screen, and the phone cut is worth having but it is not where the work
 * happens. The shot list is in coach.mjs so both cuts tell one story.
 */

import { makeFlow, prepare as sharedPrepare, stage, cleanup } from "./coach.mjs";

export const account = "miguel-demo@example.com";
export const entry = "/coaching";
/**
 * The order the video accepts is rewound to `submitted` here and put back
 * in the driver's finally. No guard: nothing else in this take writes.
 */
export { stage, cleanup };

export const prepare = sharedPrepare;

export const flow = makeFlow({
  // The sticky identity rail is on screen at every scroll position here,
  // so the intro can sit at the top and still have the priced offerings
  // beside it; the page beat then has to go and find the testimonial.
  pageAnchor: "Miguel Santos",
  pageGlide: "Full match review",
  pageOffset: 110,
  // The delivered review is about 1600 tall in an 810 frame. This brings
  // "Watch these points" up into it without hitting the end of the page.
  reviewScroll: 700,
});
