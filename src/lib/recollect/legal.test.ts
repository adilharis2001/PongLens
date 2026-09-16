import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const privacy = readFileSync(
  new URL("../../app/privacy/page.tsx", import.meta.url),
  "utf8",
);
const terms = readFileSync(
  new URL("../../app/terms/page.tsx", import.meta.url),
  "utf8",
);

test("privacy disclosure explains the switch, the provider and opt-out deletion", () => {
  assert.match(privacy, /Recollect/);
  // Off for everyone (2026-09-14); the sentence names the state rather
  // than promising a default that is not in force.
  assert.match(privacy, /currently switched off/i);
  assert.match(privacy, /OpenAI/);
  assert.match(privacy, /turn Recollect off/i);
  assert.match(privacy, /original[\s\S]*notes[\s\S]*remain/i);
  assert.match(privacy, /generated[\s\S]*deleted/i);
});

test("terms describe Recollect as an automated fallible training aid", () => {
  assert.match(terms, /Recollect/);
  assert.match(terms, /OpenAI/);
  assert.match(terms, /automated/i);
  assert.match(terms, /may.*errors/i);
  assert.match(terms, /switched off/i);
});
