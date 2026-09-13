import assert from "node:assert/strict";
import test from "node:test";
import { formatProcessingEstimate } from "./processingEstimate.ts";

const now = Date.parse("2026-09-13T06:00:00Z");
const estimate = {
  state: "range", observed_at: "2026-09-13T06:00:00Z", expires_at: "2026-09-13T06:01:30Z",
  ready_earliest_at: "2026-09-13T06:22:12Z", ready_latest_at: "2026-09-13T06:43:18Z",
  start_earliest_at: "2026-09-13T06:05:10Z", start_latest_at: "2026-09-13T06:12:10Z",
  basis: "recent_baseline_20260913", reason: null,
};
const context = { now, jobStatus: "queued", serviceState: "available" };

test("ready range rounds outward and stays visibly approximate", () => {
  assert.equal(formatProcessingEstimate(estimate, context)?.summary, "Estimated ready in about 20–45 minutes.");
  assert.match(formatProcessingEstimate(estimate, context)?.detail ?? "", /rough estimate/i);
});

test("outage, unknown capacity, terminal jobs and stale data never show a clock", () => {
  for (const serviceState of ["unavailable", "maintenance", "unknown"]) {
    assert.equal(formatProcessingEstimate(estimate, { ...context, serviceState }), null);
  }
  for (const jobStatus of ["done", "failed", "cancelled", null]) {
    assert.equal(formatProcessingEstimate(estimate, { ...context, jobStatus }), null);
  }
  assert.equal(formatProcessingEstimate(estimate, { ...context, now: now + 91_000 }), null);
});

test("unknown workload reports only queue wait and does not pretend to know ready time", () => {
  const result = formatProcessingEstimate({ ...estimate, state: "queue_only", ready_earliest_at: null,
    ready_latest_at: null, reason: "metadata_unknown" }, context);
  assert.equal(result?.summary, "Estimated wait before processing: about 5–15 minutes.");
  assert.equal(result?.detail, "Processing time will be estimated after the video check.");
});

test("overrun never renews a one-minute countdown", () => {
  const result = formatProcessingEstimate({ ...estimate, ready_earliest_at: "2026-09-13T05:50:00Z",
    ready_latest_at: "2026-09-13T05:59:59Z" }, context);
  assert.equal(result?.summary, "Processing is taking longer than estimated.");
  assert.equal(formatProcessingEstimate({ ...estimate, state: "overdue" }, context)?.summary, result?.summary);
  assert.equal(formatProcessingEstimate({ ...estimate, state: "queue_only", start_earliest_at: "2026-09-13T05:58:00Z",
    start_latest_at: "2026-09-13T05:59:00Z" }, context), null);
});

test("malformed, inverted, future-observed and unknown estimates fail quietly", () => {
  for (const bad of [null, {}, { ...estimate, observed_at: "bad" },
    { ...estimate, observed_at: "2026-09-13T06:05:00Z" },
    { ...estimate, ready_earliest_at: "2026-09-13T07:00:00Z" },
    { ...estimate, ready_latest_at: null }, { ...estimate, state: "unknown" }]) {
    assert.equal(formatProcessingEstimate(bad, context), null);
  }
});
