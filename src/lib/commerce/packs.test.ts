import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_MINUTE_PACKS,
  DEFAULT_SPONSORED_PACKS,
  DEFAULT_STORAGE_PACKS,
  parseMinutePacks,
  parseSponsoredPacks,
  parseStoragePacks,
} from "./packs.ts";

test("defaults round-trip through their own parser", () => {
  // If a default fails its parser, the fallback path would show nothing.
  const m = parseMinutePacks(
    DEFAULT_MINUTE_PACKS.map((p) => ({
      key: p.key,
      minutes: p.minutes,
      price_cents: p.priceCents,
    })),
  );
  assert.deepEqual(m, DEFAULT_MINUTE_PACKS);
  const s = parseStoragePacks(
    DEFAULT_STORAGE_PACKS.map((p) => ({
      key: p.key,
      gb: p.gb,
      months: p.months,
      price_cents: p.priceCents,
    })),
  );
  assert.deepEqual(s, DEFAULT_STORAGE_PACKS);
  const sp = parseSponsoredPacks(
    DEFAULT_SPONSORED_PACKS.map((p) => ({
      key: p.key,
      credits: p.credits,
      price_cents: p.priceCents,
    })),
  );
  assert.deepEqual(sp, DEFAULT_SPONSORED_PACKS);
});

test("bad entries are dropped, good ones kept", () => {
  const parsed = parseMinutePacks([
    { key: "ok", minutes: 60, price_cents: 500 },
    { key: "free", minutes: 60, price_cents: 0 }, // below Stripe minimum
    { key: "silly", minutes: 60, price_cents: 5000000 }, // above sanity cap
    { key: "notint", minutes: 6.5, price_cents: 500 },
    { key: "UPPER CASE", minutes: 60, price_cents: 500 }, // bad key
    "not an object",
    null,
  ]);
  assert.deepEqual(parsed, [{ key: "ok", minutes: 60, priceCents: 500 }]);
});

test("non-arrays parse to empty, never throw", () => {
  for (const raw of [null, undefined, "[]", 42, { key: "x" }]) {
    assert.deepEqual(parseMinutePacks(raw), []);
    assert.deepEqual(parseStoragePacks(raw), []);
    assert.deepEqual(parseSponsoredPacks(raw), []);
  }
});

test("storage months defaults to 12 when absent", () => {
  const parsed = parseStoragePacks([{ key: "s1", gb: 100, price_cents: 2500 }]);
  assert.equal(parsed[0]?.months, 12);
});
