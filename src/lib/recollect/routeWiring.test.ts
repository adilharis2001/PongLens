import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("lesson saves durably enqueue and begin Recollect after response", () => {
  const source = readFileSync(
    new URL("../../app/api/lesson/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /import \{ after \} from "next\/server"/);
  assert.match(source, /enqueueRecollectSource/);
  assert.match(source, /after\(async \(\) =>/);
});

test("the process route derives ownership from authentication", () => {
  const source = readFileSync(
    new URL("../../app/api/recollect/process/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /await supabase\.auth\.getUser\(\)/);
  assert.match(source, /processNextRecollectJob\(user\.id/);
  assert.match(source, /export const maxDuration = 60/);
  assert.doesNotMatch(source, /body\.ownerId/);
});

test("sorting an entry costs one provider call inside the route budget", () => {
  const processor = readFileSync(
    new URL("./processor.ts", import.meta.url),
    "utf8",
  );
  // Segmenting a transcript and then validating put two provider calls in
  // one request, which is what timed out on long lessons. There is one call
  // now and nothing to walk.
  assert.doesNotMatch(processor, /splitRecollectSource|requeueSegment/);
  assert.doesNotMatch(processor, /deps\.validate|deps\.extract/);
  assert.match(processor, /deps\.sort\(/);
});
