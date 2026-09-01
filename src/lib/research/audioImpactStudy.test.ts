import assert from "node:assert/strict";
import test from "node:test";
import {
  isAudioImpactRoundUnlocked,
  visibleAudioImpactRounds,
} from "./audioImpactStudy.ts";

test("research phases keep Round C unavailable until a frozen model is unlocked", () => {
  assert.deepEqual(visibleAudioImpactRounds("development_a"), ["A"]);
  assert.deepEqual(visibleAudioImpactRounds("development_b"), ["A", "B"]);
  assert.deepEqual(visibleAudioImpactRounds("frozen"), ["A", "B"]);
  assert.deepEqual(visibleAudioImpactRounds("sealed_labeling"), ["A", "B", "C"]);
  assert.deepEqual(visibleAudioImpactRounds("scored"), ["A", "B", "C"]);
  assert.equal(isAudioImpactRoundUnlocked("development_b", "C"), false);
  assert.equal(isAudioImpactRoundUnlocked("sealed_labeling", "C"), true);
});
