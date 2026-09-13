import assert from "node:assert/strict";
import test from "node:test";
import { waitingProcessingServiceState } from "./waitingProcessingEstimate.ts";
import { formatProcessingEstimate } from "./processingEstimate.ts";

test("internal reclip estimates never become customer match-ready promises", () => {
  const now = Date.now();
  const estimate = { state: "range", observed_at: new Date(now).toISOString(), expires_at: new Date(now + 90_000).toISOString(),
    ready_earliest_at: new Date(now + 600_000).toISOString(), ready_latest_at: new Date(now + 1_200_000).toISOString() };
  for (const available of [true, false]) {
    const services = { main: available ? "unavailable" : "available", fast: available ? "available" : "unavailable",
      hand: "available", clip_lane: "fast", observed_at: null } as const;
    const result = formatProcessingEstimate(estimate, { now, jobStatus: "queued",
      serviceState: waitingProcessingServiceState("reclip", services) });
    assert.equal(result, null);
  }
});
