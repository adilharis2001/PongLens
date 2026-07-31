import assert from "node:assert/strict";
import test from "node:test";
import {
  LOSS_REASONS,
  MISREAD_WHERE,
  customReasonId,
  customReasonValue,
  isCustomReason,
  lossReasonLabel,
  lossReasonsFor,
  lossReasonsSummary,
  misreadDetailApplies,
  pruneLossReasons,
  serveApplies,
} from "./scorecard.ts";

const values = (rows: { value: string }[]) => rows.map((r) => r.value);

test("the rotation decides which serve chip is offered, and leads with it", () => {
  // You served: blaming your own serve is on the table, receiving is not.
  const served = values(lossReasonsFor(true));
  assert.equal(served[0], "weak_serve");
  assert.ok(!served.includes("receive_error"));

  // They served: the mirror.
  const received = values(lossReasonsFor(false));
  assert.equal(received[0], "receive_error");
  assert.ok(!received.includes("weak_serve"));

  // Every lost point offers the same six regardless of who served.
  for (const rows of [served, received]) {
    assert.deepEqual(rows.slice(1), [
      "misread_spin",
      "out_of_position",
      "too_aggressive",
      "too_passive",
      "lost_focus",
      "their_winner",
    ]);
  }
});

test("an unknown server offers neither serve chip rather than guessing", () => {
  // first_server unset: offering the wrong mirror invites an answer that is
  // simply false, so the question stays at the six that are always true.
  const rows = values(lossReasonsFor(null));
  assert.equal(rows.length, 6);
  assert.ok(!rows.includes("weak_serve"));
  assert.ok(!rows.includes("receive_error"));
});

test("the player's own pills are offered after the built-ins", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const rows = lossReasonsFor(false, [{ id, label: "Misread the pips" }]);
  const last = rows[rows.length - 1];
  assert.equal(last.value, `custom:${id}`);
  assert.equal(last.label, "Misread the pips");
});

test("custom reason values round-trip through their stored form", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const stored = customReasonValue(id);
  assert.equal(stored, `custom:${id}`);
  assert.ok(isCustomReason(stored));
  assert.equal(customReasonId(stored), id);
  // Built-ins are never mistaken for custom ones.
  assert.equal(isCustomReason("misread_spin"), false);
  assert.equal(customReasonId("misread_spin"), null);
});

test("retired reasons still read, under the label they merged into", () => {
  // 'rushed' is never offered again but old points keep the value; it must
  // not start rendering as a raw key.
  assert.equal(lossReasonLabel("rushed"), "Went for too much");
  assert.ok(!values(lossReasonsFor(true)).includes("rushed"));
  assert.equal(lossReasonLabel("too_aggressive"), "Went for too much");
});

test("a custom reason whose label is gone says so instead of vanishing", () => {
  // points.loss_reasons has no foreign key (migration 060), so a label
  // deleted straight from SQL leaves a dangling id. The chip must still
  // report that the point carries a reason.
  const stored = customReasonValue("11111111-2222-3333-4444-555555555555");
  assert.equal(lossReasonLabel(stored, new Map()), "Removed reason");
  assert.equal(lossReasonLabel(stored), "Removed reason");
});

test("the summary resolves built-in, retired and custom reasons together", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const custom = new Map([[id, "Misread the pips"]]);
  assert.equal(
    lossReasonsSummary(
      ["receive_error", "rushed", customReasonValue(id)],
      custom,
    ),
    "Receive error · Went for too much · Misread the pips",
  );
  assert.equal(lossReasonsSummary([], custom), null);
  assert.equal(lossReasonsSummary(null, custom), null);
});

test("correcting who served drops only the mirrored chip", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const stored = ["weak_serve", "misread_spin", customReasonValue(id)];

  // Turns out they served: "weak serve" can't be true, the rest still is.
  assert.deepEqual(pruneLossReasons(stored, false), [
    "misread_spin",
    customReasonValue(id),
  ]);
  // Still your serve: nothing to drop.
  assert.deepEqual(pruneLossReasons(stored, true), stored);
  // Server became unknown: both mirrors go, core and custom survive.
  assert.deepEqual(pruneLossReasons(["receive_error", "lost_focus"], null), [
    "lost_focus",
  ]);
});

test("the serve follow-up is asked only when a serve decided the point", () => {
  assert.equal(serveApplies(["weak_serve"]), true);
  assert.equal(serveApplies(["receive_error"]), true);
  // The old gate fired on every clean winner, guessing at third-ball
  // attacks it could not detect. Ordinary rally reasons ask nothing.
  assert.equal(serveApplies(["misread_spin", "out_of_position"]), false);
  assert.equal(serveApplies([]), false);
  assert.equal(serveApplies(null), false);
});

test("where-it-went is asked only about a misread", () => {
  assert.equal(misreadDetailApplies(["misread_spin"]), true);
  assert.equal(misreadDetailApplies(["their_winner"]), false);
  assert.equal(misreadDetailApplies(null), false);
  // The three answers stay the stored confirmed_how error values, so the
  // mistakes cut in matchAnalysis keeps counting them unchanged.
  assert.deepEqual(values(MISREAD_WHERE), [
    "hit_into_net",
    "missed_long",
    "missed_wide",
  ]);
});

test("every offered reason is spelled in plain first-person language", () => {
  // These are read mid-match on a phone by someone who just lost a point.
  for (const { value, label } of LOSS_REASONS) {
    assert.ok(label.length <= 24, `${value} label too long: ${label}`);
    assert.equal(label, label[0].toUpperCase() + label.slice(1));
    assert.ok(!/[.!]$/.test(label), `${value} should not end in punctuation`);
  }
});
