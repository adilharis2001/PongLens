import assert from "node:assert/strict";
import test from "node:test";
import {
  createWinnerConstrainedEndingLabel,
  hydrateWinnerConstrainedEndingLabel,
  setWinnerReview,
  setServerReview,
  setEndingFamily,
  validateWinnerConstrainedEndingLabel,
} from "./winnerConstrainedEnding.ts";

test("a blank label is incomplete without leaking a default answer", () => {
  const label = createWinnerConstrainedEndingLabel();
  assert.equal(label.ending_family, null);
  assert.equal(label.server_review, null);
  assert.equal(label.corrected_server, null);
  assert.equal(label.winner_review, null);
  assert.equal(label.corrected_winner, null);
  assert.equal(label.net_behavior_note, "");
  assert.deepEqual(validateWinnerConstrainedEndingLabel(label), [
    "server_review",
    "winner_review",
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
    net_behavior_note: "It rolled toward the forehand sideline.",
    receiving_zone: "backhand",
    confidence: "high",
    notes: "Backhand loop died in the net.",
    server_review: "correct",
    winner_review: "correct",
  });
  const next = setEndingFamily(hydrated, "long");
  assert.equal(next.net_behavior, null);
  assert.equal(next.net_behavior_note, "");
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
    winner_review: "correct",
  });
  assert.deepEqual(validateWinnerConstrainedEndingLabel(label), [
    "net_behavior",
  ]);
});

test("net answers distinguish staying on the table and rolling off the side", () => {
  for (const behavior of ["stayed_on_table", "rolled_off_side"]) {
    const label = hydrateWinnerConstrainedEndingLabel({
      schema_version: 1,
      ending_family: "net",
      contact_count: 3,
      final_hitter: "receiver",
      attempted_return: "yes",
      net_behavior: behavior,
      net_behavior_note: "",
      receiving_zone: "backhand",
      confidence: "high",
      notes: "",
      server_review: "correct",
      winner_review: "correct",
    });
    assert.equal(label.net_behavior, behavior);
    assert.deepEqual(validateWinnerConstrainedEndingLabel(label), []);
  }
});

test("another net behavior requires the reviewer description", () => {
  const label = hydrateWinnerConstrainedEndingLabel({
    schema_version: 1,
    ending_family: "net",
    contact_count: 2,
    final_hitter: "receiver",
    attempted_return: "yes",
    net_behavior: "other",
    net_behavior_note: "   ",
    receiving_zone: "unknown",
    confidence: "medium",
    notes: "",
    server_review: "correct",
    winner_review: "correct",
  });
  assert.deepEqual(validateWinnerConstrainedEndingLabel(label), [
    "net_behavior_note",
  ]);

  const described = {
    ...label,
    net_behavior_note:
      "Hit the tape, stayed on the table, then rolled off the side.",
  };
  assert.deepEqual(validateWinnerConstrainedEndingLabel(described), []);
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
    winner_review: "correct",
  });
  assert.deepEqual(validateWinnerConstrainedEndingLabel(valid), []);
  assert.throws(
    () => hydrateWinnerConstrainedEndingLabel({ ...valid, contact_count: -1 }),
    /contact count/i,
  );
});

test("reviewer can confirm, correct, or mark the imported winner unsure", () => {
  const answered = hydrateWinnerConstrainedEndingLabel({
    schema_version: 1,
    server_review: "correct",
    winner_review: null,
    ending_family: "net",
    contact_count: 4,
    final_hitter: "receiver",
    attempted_return: "yes",
    net_behavior: "died_stuck_lateral",
    net_behavior_note: "Rolled laterally.",
    receiving_zone: "backhand",
    confidence: "high",
    notes: "Patrick won the point.",
  });
  const corrected = setWinnerReview(
    answered,
    "corrected",
    "user",
    "opponent",
  );

  assert.equal(corrected.winner_review, "corrected");
  assert.equal(corrected.corrected_winner, "opponent");
  assert.equal(corrected.ending_family, null);
  assert.equal(corrected.attempted_return, null);
  assert.equal(corrected.net_behavior, null);
  assert.equal(corrected.net_behavior_note, "");
  assert.equal(corrected.receiving_zone, "unknown");
  assert.equal(corrected.confidence, null);
  assert.equal(corrected.contact_count, 4);
  assert.equal(corrected.final_hitter, "receiver");
  assert.equal(corrected.notes, "Patrick won the point.");

  const confirmed = setWinnerReview(
    corrected,
    "correct",
    "user",
  );
  assert.equal(confirmed.winner_review, "correct");
  assert.equal(confirmed.corrected_winner, null);

  const unsure = setWinnerReview(
    corrected,
    "unsure",
    "user",
  );
  assert.equal(unsure.winner_review, "unsure");
  assert.equal(unsure.corrected_winner, null);
});

test("a winner correction must actually identify the other player", () => {
  assert.throws(
    () =>
      setWinnerReview(
        createWinnerConstrainedEndingLabel(),
        "corrected",
        "user",
        "user",
      ),
    /different from the imported winner/i,
  );
  assert.throws(
    () =>
      hydrateWinnerConstrainedEndingLabel({
        ...createWinnerConstrainedEndingLabel(),
        winner_review: "corrected",
        corrected_winner: null,
      }),
    /corrected winner/i,
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
