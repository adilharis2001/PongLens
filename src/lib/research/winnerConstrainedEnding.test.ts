import assert from "node:assert/strict";
import test from "node:test";
import {
  createWinnerConstrainedEndingLabel,
  hydrateWinnerConstrainedEndingLabel,
  setServerReview,
  setEndingFamily,
  validateWinnerConstrainedEndingLabel,
} from "./winnerConstrainedEnding.ts";

test("a blank label is incomplete without leaking a default answer", () => {
  const label = createWinnerConstrainedEndingLabel();
  assert.equal(label.ending_family, null);
  assert.equal(label.server_review, null);
  assert.equal(label.corrected_server, null);
  assert.deepEqual(validateWinnerConstrainedEndingLabel(label), [
    "server_review",
    "ending_family",
    "final_hitter",
    "attempted_return",
    "confidence",
  ]);
});

test("a complete non-net answer clears stale net behavior", () => {
  const hydrated = hydrateWinnerConstrainedEndingLabel({
    schema_version: 1,
    ending_family: "net",
    contact_count: 3,
    final_hitter: "receiver",
    attempted_return: "yes",
    net_behavior: "died_stuck_lateral",
    receiving_zone: "backhand",
    confidence: "high",
    notes: "Backhand loop died in the net.",
    server_review: "correct",
  });
  const next = setEndingFamily(hydrated, "long");
  assert.equal(next.net_behavior, null);
  assert.deepEqual(validateWinnerConstrainedEndingLabel(next), []);
});

test("net answers require the observed net behavior", () => {
  const label = hydrateWinnerConstrainedEndingLabel({
    schema_version: 1,
    ending_family: "net",
    contact_count: 2,
    final_hitter: "receiver",
    attempted_return: "yes",
    net_behavior: null,
    receiving_zone: "unknown",
    confidence: "medium",
    notes: "",
    server_review: "correct",
  });
  assert.deepEqual(validateWinnerConstrainedEndingLabel(label), [
    "net_behavior",
  ]);
});

test("unknown contact count is valid but negative counts are rejected", () => {
  const valid = hydrateWinnerConstrainedEndingLabel({
    schema_version: 1,
    ending_family: "clean_winner",
    contact_count: null,
    final_hitter: "server",
    attempted_return: "no",
    net_behavior: null,
    receiving_zone: "middle",
    confidence: "low",
    notes: "",
    server_review: "correct",
  });
  assert.deepEqual(validateWinnerConstrainedEndingLabel(valid), []);
  assert.throws(
    () => hydrateWinnerConstrainedEndingLabel({ ...valid, contact_count: -1 }),
    /contact count/i,
  );
});

test("reviewer can confirm, correct, or mark the imported server unsure", () => {
  const blank = createWinnerConstrainedEndingLabel();
  const corrected = setServerReview(
    blank,
    "corrected",
    "opponent",
    "user",
  );
  assert.equal(corrected.server_review, "corrected");
  assert.equal(corrected.corrected_server, "user");

  const confirmed = setServerReview(
    corrected,
    "correct",
    "opponent",
  );
  assert.equal(confirmed.server_review, "correct");
  assert.equal(confirmed.corrected_server, null);

  const unsure = setServerReview(
    corrected,
    "unsure",
    "opponent",
  );
  assert.equal(unsure.server_review, "unsure");
  assert.equal(unsure.corrected_server, null);
});

test("a server correction must actually identify the other player", () => {
  assert.throws(
    () =>
      setServerReview(
        createWinnerConstrainedEndingLabel(),
        "corrected",
        "opponent",
        "opponent",
      ),
    /different from the imported server/i,
  );
  assert.throws(
    () =>
      hydrateWinnerConstrainedEndingLabel({
        ...createWinnerConstrainedEndingLabel(),
        server_review: "corrected",
        corrected_server: null,
      }),
    /corrected server/i,
  );
});

test("unknown stored taxonomy is rejected instead of silently rewritten", () => {
  assert.throws(
    () =>
      hydrateWinnerConstrainedEndingLabel({
        ...createWinnerConstrainedEndingLabel(),
        ending_family: "missed_table",
      }),
    /ending family/i,
  );
});
