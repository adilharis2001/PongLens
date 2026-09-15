import assert from "node:assert/strict";
import test from "node:test";

import {
  MINIMUM_AGE,
  MINIMUM_AGE_EEA,
  ageInYears,
  isUnderAge,
  minimumAgeForCountry,
} from "./consent.ts";

// A fixed "now": 14 September 2026, UTC.
const NOW = new Date(Date.UTC(2026, 8, 14));

test("ageInYears counts a birthday as the first of its month", () => {
  // Born September 2013: 13 from 1 September 2026.
  assert.equal(ageInYears(2013, 9, NOW), 13);
  // Born October 2013: still 12 until October comes round.
  assert.equal(ageInYears(2013, 10, NOW), 12);
  // Born August 2013: 13, the birthday month has passed.
  assert.equal(ageInYears(2013, 8, NOW), 13);
});

test("ageInYears handles the January and December edges", () => {
  const january = new Date(Date.UTC(2026, 0, 1));
  assert.equal(ageInYears(2010, 1, january), 16);
  assert.equal(ageInYears(2010, 2, january), 15);
  const december = new Date(Date.UTC(2026, 11, 31));
  assert.equal(ageInYears(2010, 12, december), 16);
  assert.equal(ageInYears(2011, 1, december), 15);
});

test("minimumAgeForCountry is 16 in the EEA and 13 elsewhere", () => {
  assert.equal(minimumAgeForCountry("DE"), MINIMUM_AGE_EEA);
  assert.equal(minimumAgeForCountry("de"), MINIMUM_AGE_EEA);
  assert.equal(minimumAgeForCountry("GB"), MINIMUM_AGE);
  assert.equal(minimumAgeForCountry("US"), MINIMUM_AGE);
  assert.equal(minimumAgeForCountry(undefined), MINIMUM_AGE);
  assert.equal(minimumAgeForCountry(null), MINIMUM_AGE);
  assert.equal(minimumAgeForCountry(""), MINIMUM_AGE);
});

test("isUnderAge applies the country threshold to the computed age", () => {
  // 13 years and a few days old: fine in the US, under age in Germany.
  assert.equal(isUnderAge(2013, 9, "US", NOW), false);
  assert.equal(isUnderAge(2013, 9, "DE", NOW), true);
  // Exactly 16 this month clears the EEA threshold.
  assert.equal(isUnderAge(2010, 9, "DE", NOW), false);
  assert.equal(isUnderAge(2010, 10, "DE", NOW), true);
  // No country header at all falls back to 13.
  assert.equal(isUnderAge(2013, 9, undefined, NOW), false);
});
