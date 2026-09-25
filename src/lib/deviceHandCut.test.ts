import assert from "node:assert/strict";
import test from "node:test";
import {
  clipIndex,
  clipName,
  deviceCutKeys,
  isPhoneJob,
  isWritableKey,
  manifestClipKeys,
} from "./deviceHandCut.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const JOB = "33333333-3333-4333-8333-333333333333";
const MATCH = "22222222-2222-4222-8222-222222222222";
const keys = deviceCutKeys(USER, JOB, MATCH);

test("the keys are the ones claim_device_hand_cut hands the phone", () => {
  assert.deepEqual(keys, {
    cut: `results/${USER}/${JOB}.mp4`,
    manifest: `results/${USER}/${JOB}.manifest.json`,
    clipPrefix: `points/${USER}/${MATCH}`,
  });
  assert.equal(clipName(1), "01.mp4");
  assert.equal(clipName(100), "100.mp4");
});

test("only this cut's own clips and manifest can be signed", () => {
  assert.equal(clipIndex(`${keys.clipPrefix}/01.mp4`, keys, 20), 1);
  assert.equal(clipIndex(`${keys.clipPrefix}/20.mp4`, keys, 20), 20);
  assert.equal(clipIndex(`${keys.clipPrefix}/21.mp4`, keys, 20), null);
  assert.equal(clipIndex(`${keys.clipPrefix}/1.mp4`, keys, 20), null);
  assert.equal(clipIndex(`${keys.clipPrefix}/001.mp4`, keys, 20), null);
  assert.equal(clipIndex(`${keys.clipPrefix}/00.mp4`, keys, 20), null);
  assert.equal(clipIndex(`${keys.clipPrefix}/01-abcdef12.mp4`, keys, 20), null);
  assert.equal(clipIndex(`${keys.clipPrefix}/../x/01.mp4`, keys, 20), null);
  assert.equal(clipIndex(`${keys.clipPrefix}/100.mp4`, keys, 105), 100);
  assert.equal(clipIndex(`points/${USER}/other/01.mp4`, keys, 20), null);
  assert.ok(isWritableKey(keys.manifest, keys, 20));
  assert.ok(!isWritableKey(keys.cut, keys, 20), "the cut goes through multipart");
  assert.ok(!isWritableKey(`${keys.clipPrefix}/match.json`, keys, 20));
  assert.ok(!isWritableKey(`${keys.clipPrefix}/thumb-${JOB}.webp`, keys, 20));
});

test("only a job the phone still holds takes uploads", () => {
  const options = { cutter: "device", phase: "device" };
  assert.ok(isPhoneJob({ status: "processing", options }));
  assert.ok(!isPhoneJob({ status: "queued", options: { cutter: "device", phase: "verify" } }));
  assert.ok(!isPhoneJob({ status: "queued", options: { cutter: "mac", phase: "mac" } }));
  assert.ok(!isPhoneJob({ status: "processing", options: {} }));
  assert.ok(!isPhoneJob({ status: "processing", options: null }));
});

test("a manifest names only this cut's clips", () => {
  const manifest = {
    points: [
      { idx: 1, clip: "01.mp4" },
      { idx: 2, clip: null },
      { idx: 3, clip: "03.mp4" },
    ],
  };
  assert.deepEqual(manifestClipKeys(manifest, keys, 3), {
    keys: [`${keys.clipPrefix}/01.mp4`, `${keys.clipPrefix}/03.mp4`],
  });
  assert.ok("error" in manifestClipKeys({ points: [{ clip: "../01.mp4" }] }, keys, 3));
  assert.ok("error" in manifestClipKeys({ points: [{ clip: "04.mp4" }] }, keys, 3));
  assert.ok("error" in manifestClipKeys({ points: [] }, keys, 3));
  assert.ok("error" in manifestClipKeys([], keys, 3));
  assert.ok("error" in manifestClipKeys({ points: new Array(4).fill({ clip: null }) }, keys, 3));
});
