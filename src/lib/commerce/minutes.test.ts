import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chargeMinutes,
  formatClock,
  formatGb,
  formatMinutes,
  minutesUseLine,
  processWindow,
} from "./minutes.ts";

test("chargeMinutes mirrors the SQL: ceil to the minute, minimum one", () => {
  // greatest(1, ceil((end - start) / 60.0)) in claim_processing.
  assert.equal(chargeMinutes(5), 1);
  assert.equal(chargeMinutes(59.9), 1);
  assert.equal(chargeMinutes(60), 1);
  assert.equal(chargeMinutes(60.01), 2);
  assert.equal(chargeMinutes(61), 2);
  assert.equal(chargeMinutes(600), 10);
  assert.equal(chargeMinutes(2700), 45); // the review cap default, exactly
  assert.equal(chargeMinutes(2701), 46); // one second over is one minute over
});

test("chargeMinutes refuses nonsense", () => {
  assert.equal(chargeMinutes(0), 0);
  assert.equal(chargeMinutes(-5), 0);
  assert.equal(chargeMinutes(NaN), 0);
  assert.equal(chargeMinutes(Infinity), 0);
});

test("formatMinutes and formatGb read as words", () => {
  assert.equal(formatMinutes(1), "1 minute");
  assert.equal(formatMinutes(250), "250 minutes");
  assert.equal(formatMinutes(0), "0 minutes");
  assert.equal(formatGb(10737418240), "10 GB");
  assert.equal(formatGb(1610612736), "1.5 GB");
  assert.equal(formatGb(0), "0 GB");
});

test("formatClock covers both shapes", () => {
  assert.equal(formatClock(444), "7:24");
  assert.equal(formatClock(4044), "1:07:24");
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(59.6), "1:00"); // rounds, never shows :60
});

test("processWindow draws the bar on the picture and charges on the stored length", () => {
  // 623c09c6: duration_s 729, the file 728.99. The player reads 12:08
  // (whole seconds, counted down); the bar under it must too, once the
  // player has read the file.
  const before = processWindow({ storedS: 729, videoS: null, trimStartS: 0, trimEndS: null });
  assert.equal(before.barS, 729); // the stored length until the metadata arrives
  assert.equal(before.barEndS, 729);
  const after = processWindow({ storedS: 729, videoS: 728.99, trimStartS: 0, trimEndS: null });
  assert.equal(after.barS, 728.99);
  assert.equal(after.barEndS, 728.99);
  assert.equal(formatClock(Math.floor(after.barEndS!)), "12:08");
  // Untrimmed either way: no window in the request, the stored length's charge.
  for (const w of [before, after]) {
    assert.equal(w.trimmed, false);
    assert.equal(w.requestStartS, null);
    assert.equal(w.requestEndS, null);
    assert.equal(w.charge, 13); // ceil(729 / 60), what claim_processing takes
  }
});

test("an end handle dragged back to the picture's end is still no trim", () => {
  // TrimBar clamps a drag to its own length, 728.99 here, never 729.
  const full = processWindow({ storedS: 729, videoS: 728.99, trimStartS: 0, trimEndS: 728.99 });
  assert.equal(full.trimmed, false);
  assert.equal(full.requestEndS, null);
  // A stamp a fraction short of the end is the end, as it always was.
  assert.equal(processWindow({ storedS: 729, videoS: 728.99, trimStartS: 0, trimEndS: 728.6 }).trimmed, false);
  // A start trim alone sends the end as the stored length, as before.
  const head = processWindow({ storedS: 729, videoS: 728.99, trimStartS: 60, trimEndS: null });
  assert.equal(head.trimmed, true);
  assert.equal(head.requestStartS, 60);
  assert.equal(head.requestEndS, 729);
  assert.equal(head.charge, chargeMinutes(729 - 60));
});

test("a real trim end is sent and charged as claim_processing will read it", () => {
  const cut = processWindow({ storedS: 729, videoS: 728.99, trimStartS: 30, trimEndS: 600 });
  assert.equal(cut.trimmed, true);
  assert.equal(cut.barEndS, 600);
  assert.equal(cut.requestStartS, 30);
  assert.equal(cut.requestEndS, 600);
  assert.equal(cut.charge, chargeMinutes(570));
  // A file longer than its stored length: the claim clamps the end to the
  // stored length (least(p_trim_end_s, duration_s)), and so does the quote.
  const long = processWindow({ storedS: 700, videoS: 728, trimStartS: 0, trimEndS: 720 });
  assert.equal(long.requestEndS, 700);
  assert.equal(long.charge, chargeMinutes(700));
});

test("processWindow without a stored length has nothing to quote", () => {
  const none = processWindow({ storedS: null, videoS: null, trimStartS: 0, trimEndS: null });
  assert.equal(none.barS, null);
  assert.equal(none.charge, null);
  assert.equal(none.trimmed, false);
});

test("the line under Process says what the run uses, out of the balance (Adil, 2026-09-25)", () => {
  assert.deepEqual(minutesUseLine(12, 250), { text: "Uses 12 of your 250 minutes.", short: false });
  assert.deepEqual(minutesUseLine(1, 1), { text: "Uses 1 of your 1 minute.", short: false });
  assert.deepEqual(minutesUseLine(12, 12), { text: "Uses 12 of your 12 minutes.", short: false });
  // It follows the trim: a shorter window is a smaller number.
  const whole = processWindow({ storedS: 729, videoS: 728.99, trimStartS: 0, trimEndS: null });
  const trimmed = processWindow({ storedS: 729, videoS: 728.99, trimStartS: 120, trimEndS: 600 });
  assert.equal(minutesUseLine(whole.charge, 250)?.text, "Uses 13 of your 250 minutes.");
  assert.equal(minutesUseLine(trimmed.charge, 250)?.text, "Uses 8 of your 250 minutes.");
  // No balance to read: the cost alone.
  assert.deepEqual(minutesUseLine(12, null), { text: "Uses 12 minutes.", short: false });
  assert.deepEqual(minutesUseLine(1, null), { text: "Uses 1 minute.", short: false });
  // Not enough, or refused for it: the out-of-minutes sentence, as before.
  assert.deepEqual(minutesUseLine(30, 20), { text: "Not enough minutes. You have 20 minutes.", short: true });
  assert.deepEqual(minutesUseLine(12, 250, true), { text: "Not enough minutes. You have 250 minutes.", short: true });
  // Nothing to quote yet.
  assert.equal(minutesUseLine(null, 250), null);
  for (const line of [minutesUseLine(12, 250), minutesUseLine(12, null)]) {
    assert.doesNotMatch(line!.text, /—|\bAI\b|free/i);
  }
});
