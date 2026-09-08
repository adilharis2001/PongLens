import assert from "node:assert/strict";
import test from "node:test";
import { highlightContextLine } from "./shareData.ts";

test("a public highlight link names the reel and its players", () => {
  assert.equal(
    highlightContextLine("Adil vs Jordan"),
    "Highlights · Adil vs Jordan",
  );
  assert.equal(highlightContextLine(null), "Highlights");
});
