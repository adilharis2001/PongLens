import assert from "node:assert/strict";
import test from "node:test";

import { shouldPersistTranscription } from "./transcription.ts";

test("transcription persists unless the caller explicitly disables it", () => {
  assert.equal(shouldPersistTranscription(null), true);
  assert.equal(shouldPersistTranscription("true"), true);
  assert.equal(shouldPersistTranscription("false"), false);
});
