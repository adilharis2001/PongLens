import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error plain JS module, no types
import {
  digestHtml,
  digestMessage,
  digestStats,
  digestSubject,
  sortFound,
} from "./notify.mjs";

interface Row {
  handle: string;
  full_name?: string | null;
  country?: string | null;
  region: string;
  payments_supported: boolean;
  entity_type?: string;
  followers?: number;
  stage?: string;
}

const coach = (over: Partial<Row> = {}): Row => ({
  handle: "someone",
  full_name: "Some One",
  country: "US",
  region: "us",
  payments_supported: true,
  entity_type: "coach",
  followers: 500,
  stage: "found",
  ...over,
});

const india = (over: Partial<Row> = {}) =>
  coach({ country: "IN", region: "other", payments_supported: false, ...over });

test("waiting counts only coaches who can be paid and have not been written to", () => {
  const stats = digestStats([
    coach({ stage: "found" }),
    coach({ stage: "ready" }),
    coach({ stage: "warming" }),
    coach({ stage: "contacted" }),
    india({ stage: "found" }),
  ]);
  assert.equal(stats.waiting, 3);
  assert.equal(stats.reachable, 4);
  assert.equal(stats.contacted, 1);
  assert.equal(stats.total, 5);
});

test("a coach who replied counts as replied at every later stage", () => {
  const stats = digestStats([
    coach({ stage: "replied" }),
    coach({ stage: "trialling" }),
    coach({ stage: "signed_up" }),
    coach({ stage: "no_reply" }),
  ]);
  assert.equal(stats.replied, 3);
});

test("unplaced coaches are counted so the enrichment gap stays visible", () => {
  const stats = digestStats([
    coach(),
    coach({ region: "unknown", country: null, payments_supported: false }),
  ]);
  assert.equal(stats.unplaced, 1);
});

test("the subject says how many of the new coaches can actually be paid", () => {
  const subject = digestSubject([coach(), coach(), india()], "succeeded");
  assert.match(subject, /3 new coaches/);
  assert.match(subject, /2 you can pay/);
});

test("a haul with nobody payable says so rather than reading as a good morning", () => {
  const subject = digestSubject([india(), india()], "succeeded");
  assert.match(subject, /none in a payable country/);
});

test("one new coach is not 1 new coaches", () => {
  assert.match(digestSubject([coach()], "succeeded"), /1 new coach,/);
});

test("nothing new and a failure read differently", () => {
  assert.match(digestSubject([], "succeeded"), /nothing new/);
  assert.match(digestSubject([coach()], "failed"), /failed/);
});

test("payable coaches sort above bigger accounts that cannot be paid", () => {
  const sorted = sortFound([
    india({ handle: "huge", followers: 200_000 }),
    coach({ handle: "small", followers: 40 }),
  ]);
  assert.equal(sorted[0].handle, "small");
});

test("the mail names the coaches and marks the ones Stripe cannot reach", () => {
  const html = digestHtml({
    found: [coach({ handle: "lilyyip" }), india({ handle: "mumbaitt" })],
    stats: digestStats([coach(), india()]),
    status: "succeeded",
    terms: "en-city-us",
    runs: [{ cost_usd: "0.3078" }],
    error: null,
  });
  assert.match(html, /@lilyyip/);
  assert.match(html, /@mumbaitt/);
  assert.match(html, /can pay/);
  assert.match(html, /Stripe unavailable/);
  assert.match(html, /\$0\.31/);
  assert.match(html, /marketing\/coach-outreach/);
});

test("a failed run leads with the error instead of a count of nothing", () => {
  const html = digestHtml({
    found: [],
    stats: digestStats([coach()]),
    status: "failed",
    terms: "en",
    runs: [],
    error: "apify 402: monthly usage exceeded",
  });
  assert.match(html, /The coach search did not finish/);
  assert.match(html, /monthly usage exceeded/);
});

test("a handle with markup in it cannot break out of the mail", () => {
  const html = digestHtml({
    found: [coach({ handle: "x", full_name: "<script>alert(1)</script>" })],
    stats: digestStats([coach()]),
    status: "succeeded",
    terms: "en",
    runs: [],
    error: null,
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("the outreach digest uses the adaptive shell and explicit plain text", () => {
  const rendered = digestMessage({
    found: [coach({ handle: "lilyyip" })],
    stats: digestStats([coach()]),
    status: "succeeded",
    terms: "en-city-us",
    runs: [{ cost_usd: "0.3078" }],
    error: null,
  });
  assert.match(rendered.html, /prefers-color-scheme:\s*dark/);
  assert.match(rendered.html, /max-width:600px/);
  assert.match(rendered.text, /@lilyyip/);
  assert.match(rendered.text, /Open the outreach list/);
  assert.equal(rendered.templateId, "ops.coach-outreach");
});
