import assert from "node:assert/strict";
import test from "node:test";

import {
  GOALS_HEADING,
  MAX_GOALS,
  MAX_WORK_ON,
  MIN_WORK_ON,
  WORK_ON_HEADING,
} from "./lessonHeadings.ts";

// The prompts interpolate these, the video recap prints the same two names
// on its cards, and nothing checks a heading at read time: a renamed one
// would simply stop being first and last and nobody would see why. So the
// names are pinned here, exactly as they are written.
test("the two reserved heading names are fixed", () => {
  assert.equal(GOALS_HEADING, "Lesson goals");
  assert.equal(WORK_ON_HEADING, "Things to work on");
});

test("the caps match the lesson video recap", () => {
  assert.equal(MAX_GOALS, 5);
  assert.equal(MIN_WORK_ON, 2);
  assert.equal(MAX_WORK_ON, 6);
});
