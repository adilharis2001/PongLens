import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  SIGNUP_DETAIL_MAX_LENGTH,
  SIGNUP_SOURCES,
  asksForDetail,
  normalizeSignupDetail,
  signupSourceLabel,
  signupSourceOption,
} from "./signupSource.ts";

/**
 * The web half of the signup-source list, checked against the same JSON the
 * phone reads. Neither side produces the table; it is the spec written down
 * once, so that comparing two ports cannot degenerate into reading the same
 * paragraph twice and making the same mistake twice.
 */
const SPEC = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../ios/Tests/fixtures/signup-sources.json", import.meta.url),
    ),
    "utf8",
  ),
);

test("the answers offered, in the order the spec gives them", () => {
  assert.equal(SIGNUP_SOURCES.length, SPEC.options.length);
  SPEC.options.forEach((expected: Record<string, string>, i: number) => {
    const got = SIGNUP_SOURCES[i];
    assert.equal(got.value, expected.value, `option ${i} value`);
    assert.equal(got.label, expected.label, `${expected.value} label`);
    assert.equal(
      got.detailLabel ?? null,
      expected.detailLabel ?? null,
      `${expected.value} detail label`,
    );
    assert.equal(
      got.detailPlaceholder ?? null,
      expected.detailPlaceholder ?? null,
      `${expected.value} detail placeholder`,
    );
  });
});

test("the answers that open a field", () => {
  const asking = SIGNUP_SOURCES.filter((o) => asksForDetail(o.value)).map(
    (o) => o.value,
  );
  assert.deepEqual(asking, ["coach", "player", "club", "other"]);
  assert.equal(asksForDetail("youtube"), false);
  assert.equal(asksForDetail(null), false);
  assert.equal(asksForDetail("not-an-answer"), false);
});

test("looking an answer up", () => {
  assert.equal(signupSourceOption("coach")?.label, "A coach");
  assert.equal(signupSourceOption("nope"), null);
  assert.equal(signupSourceOption(null), null);
});

test("an answer the list does not know shows itself rather than nothing", () => {
  assert.equal(signupSourceLabel("coach"), "A coach");
  assert.equal(signupSourceLabel("podcast"), "podcast");
  assert.equal(signupSourceLabel(null), null);
  assert.equal(signupSourceLabel(""), null);
});

test("the limit is the column's limit", () => {
  assert.equal(SIGNUP_DETAIL_MAX_LENGTH, SPEC.detailMaxLength);
});

test("tidying up what was typed", () => {
  for (const c of SPEC.detailCases) {
    assert.equal(normalizeSignupDetail(c.input), c.expected, c.name);
  }
  assert.equal(normalizeSignupDetail(null), null, "nothing typed at all");
  assert.equal(normalizeSignupDetail(undefined), null, "no field at all");
});

test("a cut answer still fits the column", () => {
  const long = "a".repeat(SIGNUP_DETAIL_MAX_LENGTH * 2);
  const cut = normalizeSignupDetail(long) ?? "";
  assert.equal(Array.from(cut).length, SIGNUP_DETAIL_MAX_LENGTH);
});
