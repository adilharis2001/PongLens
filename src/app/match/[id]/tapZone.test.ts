import assert from "node:assert/strict";
import test from "node:test";

import { tapZone } from "./tapZone.ts";

// No test covered the double-tap split before this, on either platform,
// which is how a boundary can move without anyone noticing until it is in
// somebody's hands. The boundaries are the whole behaviour, so they are
// what gets asserted.

test("the outer thirds keep the meaning halves gave them", () => {
  assert.equal(tapZone(0, 300), "prev");
  assert.equal(tapZone(50, 300), "prev");
  assert.equal(tapZone(99, 300), "prev");
  assert.equal(tapZone(201, 300), "next");
  assert.equal(tapZone(299, 300), "next");
  assert.equal(tapZone(300, 300), "next");
});

test("the middle third replays", () => {
  assert.equal(tapZone(101, 300), "replay");
  assert.equal(tapZone(150, 300), "replay");
  assert.equal(tapZone(199, 300), "replay");
});

test("the boundaries sit exactly on the thirds", () => {
  // Dead on a boundary belongs to the middle: a tap the person could not
  // have aimed precisely should do the reversible thing.
  assert.equal(tapZone(100, 300), "replay");
  assert.equal(tapZone(200, 300), "replay");
});

test("an unmeasured surface answers replay rather than guessing", () => {
  assert.equal(tapZone(40, 0), "replay");
  assert.equal(tapZone(40, -1), "replay");
  assert.equal(tapZone(0, Number.NaN), "replay");
});

test("the split holds at any width", () => {
  for (const width of [1, 7, 320, 1024, 3840]) {
    assert.equal(tapZone(width * 0.1, width), "prev", `w=${width}`);
    assert.equal(tapZone(width * 0.5, width), "replay", `w=${width}`);
    assert.equal(tapZone(width * 0.9, width), "next", `w=${width}`);
  }
});
