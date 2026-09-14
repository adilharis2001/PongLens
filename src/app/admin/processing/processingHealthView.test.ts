import assert from "node:assert/strict";
import test from "node:test";
import { outcomeLabel, reasonLabel, monitorLabel, type ProcessingHealth } from "./processingHealthView.ts";

test("fallback and expected refusal are not success", () => {
  assert.equal(outcomeLabel("degraded"), "Processing problem");
  assert.equal(outcomeLabel("refused"), "Bodies declined");
  assert.equal(outcomeLabel("used"), "Bodies used");
  assert.equal(outcomeLabel("unknown"), "Outcome unknown");
  assert.equal(outcomeLabel("new_status"), "new_status");
});
test("unknown reasons stay visible rather than disappearing", () => {
  assert.equal(reasonLabel("pose_exception"), "Reading the players failed.");
  assert.equal(reasonLabel("new_reason"), "new_reason");
});
test("monitor silence is unknown before first reporting and stale afterwards", () => {
  const doc = { control: { expected_after: null, monitor_at: null }} as ProcessingHealth;
  assert.equal(monitorLabel(doc, new Date()), "Not activated yet");
  doc.control.expected_after = "2026-09-11T12:00:00Z";
  assert.equal(monitorLabel(doc, new Date()), "Monitor status unknown");
  doc.control.monitor_at = "2026-09-11T12:00:00Z";
  assert.equal(monitorLabel(doc, new Date("2026-09-11T12:05:00Z")), "Monitor has stopped reporting");
  assert.equal(monitorLabel(doc, new Date("2026-09-11T12:01:00Z")), "Monitoring");
});
