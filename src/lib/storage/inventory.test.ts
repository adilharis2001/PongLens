import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyKey,
  reelReferences,
  retiredMediaKeys,
  summarize,
  type BucketObject,
  type RetiredVersion,
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

test("a starred selection spans matches, so it is its owner's by name", () => {
  assert.deepEqual(
    classifyKey("ponglens-media", `reels/sel-${A}-0123456789abcdef0123456789abcdef.mp4`),
    { kind: "owned", owner: A, category: "reels" },
  );
  assert.equal(classifyKey("ponglens-media", "reels/sel-nobody.mp4").kind, "unknown");
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


test("a replaced cut's files count against nobody (Cut again, 2026-09-25)", () => {
  const OLD = "77777777-7777-4777-8777-777777777777";
  const LIVE = "88888888-8888-4888-8888-888888888888";
  const FAILED = "99999999-9999-4999-8999-999999999999";
  const media = (key: string, size = 10): BucketObject => ({ bucket: "ponglens-media", key, size });
  const objects: BucketObject[] = [
    media(`results/${A}/oldjob.mp4`, 500),
    media(`points/${A}/${M}/01.mp4`),
    media(`points/${A}/${M}/match.json`),
    media(`points/${A}/${M}/01-deadbeef.mp4`), // a phone's reclip of a live point
    media(`points/${A}/${M}/versions/${OLD}/03.mp4`),
    media(`points/${A}/${M}/versions/${LIVE}/01.mp4`),
    media(`results/${A}/${M}/versions/${LIVE}.mp4`, 400),
    media(`results/${A}/${M}/versions/${FAILED}.mp4`, 300),
    media(`points/${A}/${M}/versions/${FAILED}/01.mp4`),
    { bucket: "ponglens-raw", key: `${A}/${M}.mov`, size: 1000 },
  ];
  const versions: RetiredVersion[] = [
    { version_id: OLD, match_id: M, user_id: A,
      cut_path: `r2://ponglens-media/results/${A}/oldjob.mp4`, first_cut: true },
    { version_id: FAILED, match_id: M, user_id: A,
      cut_path: `r2://ponglens-media/results/${A}/${M}/versions/${FAILED}.mp4`, first_cut: false },
  ];
  const candidates = retiredMediaKeys(objects, versions);
  assert.deepEqual(new Set(candidates), new Set([
    `results/${A}/oldjob.mp4`,
    `points/${A}/${M}/01.mp4`,
    `points/${A}/${M}/match.json`,
    `points/${A}/${M}/01-deadbeef.mp4`,
    `points/${A}/${M}/versions/${OLD}/03.mp4`,
    `results/${A}/${M}/versions/${FAILED}.mp4`,
    `points/${A}/${M}/versions/${FAILED}/01.mp4`,
  ]));
  // Never the live cut, its folder or the original.
  for (const key of candidates) {
    assert.ok(!key.includes(LIVE), key);
    assert.ok(!key.endsWith(".mov"), key);
  }
  // The caller takes out what is still in use (here the phone's reclip).
  const retired = new Set(candidates.filter((k) => !k.endsWith("01-deadbeef.mp4")));
  const inv = summarize(objects, { matchOwner: new Map(), tagOwner: new Map() }, 12, retired);
  assert.equal(inv.retiredObjects, 6);
  assert.equal(inv.retiredBytes, 500 + 10 + 10 + 10 + 300 + 10);
  const owner = inv.accounts.get(A);
  assert.ok(owner);
  // Counted for the player: the live cut and clip, the phone's reclip, the original.
  assert.equal(owner.bytes, 400 + 10 + 10 + 1000);
  assert.equal(inv.totalBytes, 400 + 10 + 10 + 1000 + inv.retiredBytes);
  // Without a retired set nothing changes.
  const plain = summarize(objects, { matchOwner: new Map(), tagOwner: new Map() });
  assert.equal(plain.retiredBytes, 0);
  assert.equal(plain.accounts.get(A)?.bytes, inv.totalBytes);
});
