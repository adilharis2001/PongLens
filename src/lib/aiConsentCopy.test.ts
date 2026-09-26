import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AI_CONSENT_COPY } from "./aiConsentCopy.ts";

// The iPhone sheet must say exactly what the web sheet says: one
// permission, one wording, whichever device asks.
test("the iPhone sheet carries the web sheet's words", () => {
  const swift = readFileSync(
    new URL(
      "../../ios/PongLens/PongLens/Components/AiConsentSheet.swift",
      import.meta.url,
    ),
    "utf8",
  );
  const block = swift.match(/static let copy = \[([\s\S]*?)\n\s*\]/);
  assert.ok(block, "AiConsentSheet.copy not found");
  const paragraphs = [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(paragraphs, [...AI_CONSENT_COPY]);
});

test("the sheet says recording and uploading need it", () => {
  assert.match(AI_CONSENT_COPY.join(" "), /Recording and uploading matches need this\./);
  assert.match(AI_CONSENT_COPY[0], /OpenAI looks at still frames from each match/);
});
