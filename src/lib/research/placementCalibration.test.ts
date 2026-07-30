import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlacementCalibrationLabel,
  placementAnalysisLabel,
  predictionDistanceCm,
  revealPlacementComparison,
  updatePlacementCalibrationLabel,
  validatePlacementCalibrationLabel,
} from "./placementCalibration.ts";

test("landed labels require bounded coordinates and explicit certainty", () => {
  let label = createPlacementCalibrationLabel();
  label = updatePlacementCalibrationLabel(label, { result: "landed" });
  assert.deepEqual(validatePlacementCalibrationLabel(label), [
    "table_u",
    "table_v",
    "visibility",
    "confidence",
  ]);

  label = updatePlacementCalibrationLabel(label, {
    table_u: 0.75,
    table_v: 2.1,
    visibility: "estimated",
    confidence: "likely",
  });
  assert.deepEqual(validatePlacementCalibrationLabel(label), []);

  const invalid = updatePlacementCalibrationLabel(label, { table_u: 2 });
  assert.ok(validatePlacementCalibrationLabel(invalid).includes("table_u"));
});

test("non-landed answers clear stale table coordinates", () => {
  const landed = updatePlacementCalibrationLabel(
    createPlacementCalibrationLabel(),
    {
      result: "landed",
      table_u: 0.5,
      table_v: 1.8,
      visibility: "clear",
      confidence: "certain",
    },
  );
  const notVisible = updatePlacementCalibrationLabel(landed, {
    result: "not_visible",
  });

  assert.equal(notVisible.table_u, null);
  assert.equal(notVisible.table_v, null);
  assert.equal(notVisible.visibility, null);
  assert.equal(notVisible.confidence, null);
  assert.deepEqual(validatePlacementCalibrationLabel(notVisible), []);
});

test("excluded labels require a reason and clear stale coordinates", () => {
  const landed = updatePlacementCalibrationLabel(
    createPlacementCalibrationLabel(),
    {
      result: "landed",
      table_u: 0.5,
      table_v: 1.8,
      visibility: "clear",
      confidence: "certain",
    },
  );
  let excluded = updatePlacementCalibrationLabel(landed, {
    result: "excluded",
  });

  assert.deepEqual(validatePlacementCalibrationLabel(excluded), [
    "exclusion_reason",
  ]);
  assert.equal(excluded.table_u, null);
  assert.equal(excluded.table_v, null);

  excluded = updatePlacementCalibrationLabel(excluded, {
    exclusion_reason: "not_a_point",
  });
  assert.deepEqual(validatePlacementCalibrationLabel(excluded), []);

  const restored = updatePlacementCalibrationLabel(excluded, {
    result: "not_visible",
  });
  assert.equal(restored.exclusion_reason, null);
});

test("the first reveal freezes a blind snapshot and later edits are marked", () => {
  const landed = updatePlacementCalibrationLabel(
    createPlacementCalibrationLabel(),
    {
      result: "landed",
      table_u: 0.4,
      table_v: 2,
      visibility: "clear",
      confidence: "certain",
    },
  );
  const revealed = revealPlacementComparison(
    landed,
    "2026-07-30T12:00:00.000Z",
  );
  assert.equal(revealed.revealed_at, "2026-07-30T12:00:00.000Z");
  assert.equal(revealed.blind_snapshot?.table_u, 0.4);
  assert.equal(revealed.post_reveal_edited, false);

  const edited = updatePlacementCalibrationLabel(revealed, { table_u: 0.8 });
  assert.equal(edited.table_u, 0.8);
  assert.equal(edited.blind_snapshot?.table_u, 0.4);
  assert.equal(edited.post_reveal_edited, true);
});

test("analysis label uses the latest post-reveal answer", () => {
  const initial = updatePlacementCalibrationLabel(
    createPlacementCalibrationLabel(),
    {
      result: "landed",
      table_u: 0.4,
      table_v: 2,
      visibility: "clear",
      confidence: "certain",
    },
  );
  const revealed = revealPlacementComparison(
    initial,
    "2026-07-30T12:00:00.000Z",
  );
  const edited = updatePlacementCalibrationLabel(revealed, {
    table_u: 0.8,
  });

  const analysis = placementAnalysisLabel(edited);

  assert.equal(analysis.table_u, 0.8);
  assert.equal(analysis.result, "landed");
  assert.equal("blind_snapshot" in analysis, false);
});

test("comparison cannot reveal an incomplete label", () => {
  assert.throws(
    () =>
      revealPlacementComparison(
        createPlacementCalibrationLabel(),
        "2026-07-30T12:00:00.000Z",
      ),
    /incomplete/,
  );
});

test("prediction distance uses physical table meters", () => {
  assert.equal(
    predictionDistanceCm(
      { u: 0.4, v: 2 },
      { u: 0.7, v: 2.4 },
    ),
    50,
  );
  assert.equal(predictionDistanceCm(null, { u: 0.7, v: 2.4 }), null);
});
