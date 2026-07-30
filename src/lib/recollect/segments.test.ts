import assert from "node:assert/strict";
import test from "node:test";
import { splitRecollectSource } from "./segments.ts";

test("short Recollect sources stay in one segment", () => {
  const text = "Keep the racket high.";
  assert.deepEqual(splitRecollectSource(text), [
    { index: 0, start: 0, end: text.length, text },
  ]);
});

test("long Recollect sources cover all text with bounded overlap", () => {
  const text = `${"A".repeat(23_500)}\n\n${"B".repeat(23_500)}`;
  const parts = splitRecollectSource(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.text.length <= 24_000));
  assert.equal(parts[0]?.start, 0);
  assert.equal(parts.at(-1)?.end, text.length);
  assert.ok((parts[0]?.end ?? 0) > (parts[1]?.start ?? Infinity));
});

test("segmentation always makes progress through unbroken text", () => {
  const text = "x".repeat(100_000);
  const parts = splitRecollectSource(text);
  assert.ok(parts.length >= 5);
  for (let i = 1; i < parts.length; i += 1) {
    assert.ok((parts[i]?.start ?? 0) > (parts[i - 1]?.start ?? 0));
  }
});
