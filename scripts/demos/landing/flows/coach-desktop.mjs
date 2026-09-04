/** Coach workspace video, desktop cut. 1440x810. */

import { makeFlow, prepare as sharedPrepare, stage, cleanup } from "./coach.mjs";

export const account = "miguel-demo@example.com";
export const entry = "/coaching/students";
/**
 * The order the video accepts is rewound to `submitted` here and put back
 * in the driver's finally. No guard: nothing else in this take writes.
 */
export { stage, cleanup };

export const prepare = sharedPrepare;

export const flow = makeFlow({
  studentShot: "coach-student-t",
});
