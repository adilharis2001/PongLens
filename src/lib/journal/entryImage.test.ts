import assert from "node:assert/strict";
import test from "node:test";

import {
  entryImageDeleteRequest,
  parseOwnedEntryImage,
} from "./entryImage.ts";

test("entry image parser accepts only the caller's media prefix", () => {
  assert.deepEqual(
    parseOwnedEntryImage(
      "r2://ponglens-media/entry/user-1/image.jpg",
      "user-1",
    ),
    { bucket: "ponglens-media", key: "entry/user-1/image.jpg" },
  );
  assert.equal(
    parseOwnedEntryImage(
      "r2://ponglens-media/entry/other/image.jpg",
      "user-1",
    ),
    null,
  );
  assert.equal(
    parseOwnedEntryImage(
      "r2://ponglens-raw/entry/user-1/image.jpg",
      "user-1",
    ),
    null,
  );
});

test("entry image deletion rejects malformed and foreign paths", () => {
  assert.deepEqual(entryImageDeleteRequest(null, "user-1"), {
    ok: false,
    error: "invalid_image",
  });
  assert.deepEqual(
    entryImageDeleteRequest(
      "r2://ponglens-media/entry/other/image.jpg",
      "user-1",
    ),
    { ok: false, error: "invalid_image" },
  );
});

test("entry image deletion returns a validated caller-owned object", () => {
  assert.deepEqual(
    entryImageDeleteRequest(
      "r2://ponglens-media/entry/user-1/image.jpg",
      "user-1",
    ),
    {
      ok: true,
      imagePath: "r2://ponglens-media/entry/user-1/image.jpg",
      image: {
        bucket: "ponglens-media",
        key: "entry/user-1/image.jpg",
      },
    },
  );
});
