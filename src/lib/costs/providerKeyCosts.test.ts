import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchOpenAIKeyCosts,
  parseKeyCosts,
} from "./providerKeyCosts.ts";

const bucket = (startTime: number, results: unknown[]) => ({
  start_time: startTime,
  results,
});

test("a bucket becomes one row per key, dated by the bucket's day", () => {
  const rows = parseKeyCosts([
    {
      data: [
        bucket(Date.UTC(2026, 8, 11) / 1000, [
          { api_key_id: "key_a", amount: { value: 1.25 } },
          { api_key_id: "key_b", amount: { value: 0.5 } },
        ]),
      ],
    },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.key_id, r.day, r.cost_usd]),
    [
      ["key_a", "2026-09-11", 1.25],
      ["key_b", "2026-09-11", 0.5],
    ],
  );
  assert.ok(rows.every((r) => r.provider === "OpenAI"));
});

test("a result with no key id is dropped rather than stored as noise", () => {
  // Spend with no credential behind it cannot be attributed to a purpose,
  // and inventing a bucket for it would put a guess in the ledger.
  const rows = parseKeyCosts([
    {
      data: [
        bucket(Date.UTC(2026, 8, 11) / 1000, [
          { amount: { value: 9.99 } },
          { api_key_id: "", amount: { value: 1 } },
          { api_key_id: "key_a", amount: { value: 2 } },
        ]),
      ],
    },
  ]);
  assert.deepEqual(rows.map((r) => r.key_id), ["key_a"]);
});

test("zero and malformed amounts are dropped", () => {
  const rows = parseKeyCosts([
    {
      data: [
        bucket(Date.UTC(2026, 8, 11) / 1000, [
          { api_key_id: "zero", amount: { value: 0 } },
          { api_key_id: "nan", amount: { value: "oops" } },
          { api_key_id: "missing" },
          { api_key_id: "real", amount: { value: 0.01 } },
        ]),
      ],
    },
  ]);
  assert.deepEqual(rows.map((r) => r.key_id), ["real"]);
});

test("a malformed payload yields nothing instead of throwing", () => {
  assert.deepEqual(parseKeyCosts([null, {}, { data: "nope" }]), []);
  assert.deepEqual(
    parseKeyCosts([{ data: [{ start_time: "x", results: [] }] }]),
    [],
  );
});

test("pagination is followed and every page contributes", async () => {
  const pages = [
    { data: [bucket(Date.UTC(2026, 8, 10) / 1000, [{ api_key_id: "k1", amount: { value: 1 } }])], has_more: true, next_page: "p2" },
    { data: [bucket(Date.UTC(2026, 8, 11) / 1000, [{ api_key_id: "k2", amount: { value: 2 } }])], has_more: false },
  ];
  const urls: string[] = [];
  const rows = await fetchOpenAIKeyCosts({
    adminKey: "sk-admin-x",
    startTime: 1_700_000_000,
    fetchImpl: (async (url: string) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => pages.shift() };
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(rows.map((r) => r.key_id), ["k1", "k2"]);
  assert.ok(urls[0].includes("group_by=api_key_id"));
  assert.ok(urls[1].includes("page=p2"));
});

test("pagination is bounded, so a provider that always says has_more cannot loop forever", async () => {
  let calls = 0;
  await fetchOpenAIKeyCosts({
    adminKey: "sk-admin-x",
    startTime: 1_700_000_000,
    fetchImpl: (async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [], has_more: true, next_page: "again" }),
      };
    }) as unknown as typeof fetch,
  });
  assert.ok(calls <= 10, `expected a bounded loop, made ${calls} calls`);
});

test("a failed request throws rather than recording an empty day", async () => {
  // Writing zero rows for a day that actually had spend would look like a
  // quiet day rather than a failed fetch.
  await assert.rejects(
    fetchOpenAIKeyCosts({
      adminKey: "sk-admin-x",
      startTime: 1_700_000_000,
      fetchImpl: (async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch,
    }),
    /403/,
  );
});
