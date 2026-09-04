/** Coach workspace video, mobile cut. 390x844. */

import { makeFlow, prepare as sharedPrepare, stage, cleanup } from "./coach.mjs";

export const account = "miguel-demo@example.com";
export const entry = "/coaching/students";
export { stage, cleanup };

export const prepare = sharedPrepare;

export const flow = makeFlow({ platform: "mobile" });
