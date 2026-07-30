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

test("a successful segment resets provider retries for long transcripts", () => {
  const source = readFileSync(
    new URL("./repository.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /requeueSegment[\s\S]*attempt_count: 0[\s\S]*candidate_buffer/,
  );
});
