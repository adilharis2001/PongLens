import assert from "node:assert/strict";
import test from "node:test";

import { parseOwnedEntryImage } from "./entryImage.ts";

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
