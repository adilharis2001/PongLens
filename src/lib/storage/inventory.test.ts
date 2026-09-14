import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyKey,
  reelReferences,
  summarize,
  type BucketObject,
} from "./inventory.ts";

const A = "a2e61027-2ee9-4026-a058-dc07441ee633";
const B = "e84a6675-1111-4222-8333-444455556666";
const M = "43c84360-d95e-4cd0-a89d-0ccabc136098";
const T = "0c0c0c0c-0000-4000-8000-000000000001";

test("every prefix the product writes is attributed to the account under it", () => {
  assert.deepEqual(classifyKey("ponglens-raw", `${A}/x.mov`), {
    kind: "owned", owner: A, category: "match_original",
  });
  assert.deepEqual(classifyKey("ponglens-media", `results/${A}/job.mp4`), {
    kind: "owned", owner: A, category: "match_cut",
  });
  assert.deepEqual(classifyKey("ponglens-media", `points/${A}/${M}/01.mp4`), {
    kind: "owned", owner: A, category: "match_clips",
  });
  assert.deepEqual(classifyKey("ponglens-media", `lesson-video/${A}/${M}/original.mov`), {
    kind: "owned", owner: A, category: "lesson_video",
  });
  for (const p of ["voice", "sketch", "entry"]) {
    assert.equal(classifyKey("ponglens-media", `${p}/${A}/f.bin`).kind, "owned");
    assert.equal(
      (classifyKey("ponglens-media", `${p}/${A}/f.bin`) as { category: string }).category,
      "notes_media",
    );
  }
  for (const p of ["review", "avatar", "offer"]) {
    assert.equal(
      (classifyKey("ponglens-media", `${p}/${A}/f.bin`) as { category: string }).category,
      "coach_media",
    );
  }
});

test("reels are attributed through the match or tag they were cut from", () => {
  assert.deepEqual(classifyKey("ponglens-media", `reels/${M}.mp4`), {
    kind: "match", matchId: M, category: "reels",
  });
  assert.deepEqual(classifyKey("ponglens-media", `reels/${M}-full.mp4`), {
    kind: "match", matchId: M, category: "reels",
  });
  assert.deepEqual(classifyKey("ponglens-media", `reels/${M}-highlights-0123456789abcdef.mp4`), {
    kind: "match", matchId: M, category: "reels",
  });
  assert.deepEqual(classifyKey("ponglens-media", `reels/v-${M}-story.mp4`), {
    kind: "match", matchId: M, category: "reels",
  });
  assert.deepEqual(classifyKey("ponglens-media", `reels/tag-${T}.mp4`), {
    kind: "tag", tagId: T, category: "reels",
  });
});

test("the platform's own files belong to nobody, and a strange prefix is not guessed", () => {
  assert.equal(classifyKey("ponglens-media", "research/2026/x.json").kind, "platform");
  assert.equal(classifyKey("ponglens-media", "tutorial/ch1.mp4").kind, "platform");
  assert.equal(classifyKey("ponglens-media", `qa/${A}/shot.png`).kind, "platform");
  assert.equal(classifyKey("ponglens-media", `feedback/${A}/shot.png`).kind, "platform");
  assert.equal(classifyKey("ponglens-media", "healthcheck.txt").kind, "platform");
  assert.equal(classifyKey("ponglens-media", `newthing/${A}/x.bin`).kind, "unknown");
  assert.equal(classifyKey("ponglens-media", "results/not-a-uuid/x.mp4").kind, "unknown");
  assert.equal(classifyKey("ponglens-raw", "loose-file.mp4").kind, "unknown");
});

test("summarize totals per account, with reels routed to their owner and the rest reported", () => {
  const objects: BucketObject[] = [
    { bucket: "ponglens-raw", key: `${A}/orig.mov`, size: 100 },
    { bucket: "ponglens-media", key: `results/${A}/cut.mp4`, size: 50 },
    { bucket: "ponglens-media", key: `points/${A}/${M}/01.mp4`, size: 5 },
    { bucket: "ponglens-media", key: `reels/${M}.mp4`, size: 7 },
    { bucket: "ponglens-media", key: `reels/tag-${T}.mp4`, size: 3 },
    { bucket: "ponglens-media", key: `lesson-video/${B}/${M}/original.mp4`, size: 900 },
    { bucket: "ponglens-media", key: `reels/${B}.mp4`, size: 11 },
    { bucket: "ponglens-media", key: "research/corpus.json", size: 1000 },
    { bucket: "ponglens-media", key: "mystery/thing.bin", size: 2 },
  ];
  const refs = reelReferences(objects);
  assert.deepEqual(refs.matchIds.sort(), [M, B].sort());
  assert.deepEqual(refs.tagIds, [T]);

  const inv = summarize(objects, {
    matchOwner: new Map([[M, A]]),
    tagOwner: new Map([[T, B]]),
  });
  assert.deepEqual(inv.accounts.get(A), {
    bytes: 162,
    objects: 4,
    breakdown: { match_original: 100, match_cut: 50, match_clips: 5, reels: 7 },
  });
  assert.deepEqual(inv.accounts.get(B), {
    bytes: 903,
    objects: 2,
    breakdown: { lesson_video: 900, reels: 3 },
  });
  assert.equal(inv.platformBytes, 1000);
  assert.equal(inv.platformObjects, 1);
  // The reel whose match no longer exists, and the unknown prefix.
  assert.equal(inv.unattributedObjects, 2);
  assert.equal(inv.unattributedBytes, 13);
  assert.deepEqual(
    inv.unattributed.map((u) => u.reason).sort(),
    ["orphan_reel", "unknown_prefix"],
  );
  assert.equal(inv.totalBytes, 2078);
  assert.equal(inv.totalObjects, 9);
});
