import assert from "node:assert/strict";
import test from "node:test";

import {
  entryImageDeleteRequest,
  entryImageEdit,
  parseOwnedEntryImage,
} from "./entryImage.ts";

const USER = "11111111-2222-3333-4444-555555555555";

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

test("an edit that does not mention the photo leaves it alone", () => {
  assert.deepEqual(entryImageEdit({ transcript: "x" }, USER), {
    kind: "unchanged",
  });
});

test("null and empty remove the photo", () => {
  assert.deepEqual(entryImageEdit({ imagePath: null }, USER), {
    kind: "set",
    imagePath: null,
  });
  assert.deepEqual(entryImageEdit({ imagePath: "" }, USER), {
    kind: "set",
    imagePath: null,
  });
});

test("a path in the caller's own folder is accepted", () => {
  const mine = `r2://ponglens-media/entry/${USER}/a.jpg`;
  assert.deepEqual(entryImageEdit({ imagePath: mine }, USER), {
    kind: "set",
    imagePath: mine,
  });
});

test("someone else's photo, another bucket, and a walk out are all refused", () => {
  for (const path of [
    "r2://ponglens-media/entry/00000000-0000-0000-0000-000000000000/a.jpg",
    "r2://other-bucket/entry/" + USER + "/a.jpg",
    "r2://ponglens-media/note/" + USER + "/a.jpg",
    "https://example.com/a.jpg",
    42,
  ]) {
    assert.deepEqual(
      entryImageEdit({ imagePath: path }, USER),
      { kind: "invalid" },
      String(path),
    );
  }
});
