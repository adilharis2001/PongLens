import assert from "node:assert/strict";
import test from "node:test";

import { previewPoints, previewTruncates } from "./preview.ts";

// Twin of ios/Tests/LessonPreviewTests.swift: the same cases, in the same
// order, so the two surfaces cannot disagree about which four.
const themes = [
  { name: "Stance", points: ["Stand wider.", "Stay low.", "  ", "Bend the knees."] },
  { name: "Serve", points: ["Serve long to invite a fast return.", "Keep the serve simple."] },
];

test("the first four points, across themes in order, blanks skipped", () => {
  assert.deepEqual(previewPoints(themes), [
    "Stand wider.",
    "Stay low.",
    "Bend the knees.",
    "Serve long to invite a fast return.",
  ]);
});

test("the limit is the limit", () => {
  assert.deepEqual(previewPoints(themes, 2), ["Stand wider.", "Stay low."]);
});

test("nothing in, nothing out", () => {
  assert.deepEqual(previewPoints([]), []);
});

test("fewer than the limit is fine", () => {
  assert.deepEqual(previewPoints([{ name: "One", points: ["Only this."] }]), ["Only this."]);
});

test("five points means the card says more; exactly the limit does not", () => {
  assert.equal(previewTruncates(themes), true);
  assert.equal(previewTruncates([{ name: "One", points: ["A", "B", "C", "D"] }]), false);
});
