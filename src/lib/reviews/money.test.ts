import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coachShareCents,
  formatUsd,
  parseUsd,
  platformFeeCents,
} from "./money.ts";

test("percent fee rounds like the SQL", () => {
  assert.equal(
    platformFeeCents(3000, { mode: "percent", percent: 15, fixedCents: 500 }),
    450,
  );
  // round() at the half: 2550 * 15% = 382.5 -> 383 (SQL round() ties away)
  assert.equal(
    platformFeeCents(2550, { mode: "percent", percent: 15, fixedCents: 500 }),
    383,
  );
});

test("fixed fee never exceeds the price", () => {
  assert.equal(
    platformFeeCents(500, { mode: "fixed", percent: 15, fixedCents: 500 }),
    500,
  );
  assert.equal(
    coachShareCents(500, { mode: "fixed", percent: 15, fixedCents: 500 }),
    0,
  );
  assert.equal(
    platformFeeCents(2000, { mode: "fixed", percent: 15, fixedCents: 500 }),
    500,
  );
});

test("share plus fee equals price", () => {
  for (const price of [500, 999, 2500, 50000]) {
    for (const cfg of [
      { mode: "percent" as const, percent: 15, fixedCents: 500 },
      { mode: "fixed" as const, percent: 15, fixedCents: 500 },
    ]) {
      assert.equal(
        platformFeeCents(price, cfg) + coachShareCents(price, cfg),
        price,
      );
    }
  }
});

test("formatUsd drops cents on whole dollars", () => {
  assert.equal(formatUsd(2500), "$25");
  assert.equal(formatUsd(2550), "$25.50");
});

test("parseUsd accepts dollars, rejects junk", () => {
  assert.equal(parseUsd("25"), 2500);
  assert.equal(parseUsd("$25.50"), 2550);
  assert.equal(parseUsd("25.5"), 2550);
  assert.equal(parseUsd(""), null);
  assert.equal(parseUsd("abc"), null);
  assert.equal(parseUsd("25.555"), null);
});
